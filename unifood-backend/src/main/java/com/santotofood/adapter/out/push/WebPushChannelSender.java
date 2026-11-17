package com.santotofood.adapter.out.push;

import com.santotofood.application.model.PushRecipient;
import com.santotofood.application.service.PushEndpointPolicy;
import com.zerodeplibs.webpush.PushSubscription;
import com.zerodeplibs.webpush.header.Urgency;
import com.zerodeplibs.webpush.httpclient.StandardHttpClientRequestPreparer;
import java.io.IOException;
import java.io.InputStream;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Web Push (RFC 8030) with aes128gcm payload encryption (RFC 8291) and VAPID (RFC 8292), built by
 * zerodep-web-push-java on the JDK HttpClient. Redirects are never followed: the push service
 * answers directly or the delivery fails.
 */
public final class WebPushChannelSender implements PushChannelSender {
  public static final String CHANNEL = "WEB_PUSH";
  private static final Logger LOG = LoggerFactory.getLogger(WebPushChannelSender.class);

  /** Largest part of a refusal body that is read: enough for the JSON reason, nothing more. */
  static final int MAX_REASON_BYTES = 512;

  /** The reason Apple returns as {"reason":"BadJwtToken"}: letters only, 1 to 40 of them. */
  /** Apple's reason for a subscription whose VAPID key differs from ours. */
  static final String VAPID_KEY_MISMATCH = "VapidPkHashMismatch";

  private static final Pattern REASON = Pattern.compile("\"reason\"\\s*:\\s*\"([A-Za-z]{1,40})\"");

  /** The HTTP exchange, replaceable in tests by a simulated push service. */
  @FunctionalInterface
  public interface Transport {
    int send(HttpRequest request) throws IOException, InterruptedException;

    /**
     * The status plus the first bytes of the body when the status is 4xx. The default reads no
     * body, so a lambda transport only needs {@link #send}.
     */
    default Reply exchange(HttpRequest request) throws IOException, InterruptedException {
      return new Reply(send(request), new byte[0]);
    }
  }

  /** A status and, for 4xx, at most {@link #MAX_REASON_BYTES} bytes of the body. */
  public record Reply(int status, byte[] head) {}

  private final VapidKeys keys;
  private final PushSettings settings;
  private final Transport transport;

  public WebPushChannelSender(VapidKeys keys, PushSettings settings) {
    this(keys, settings, jdkTransport(settings));
  }

  /**
   * The reason token in a refusal body, or null when the body is empty, has no "reason" or the
   * value does not match {@link #REASON}. Never returns any other part of the body.
   */
  static String reasonOf(byte[] head) {
    if (head == null || head.length == 0) return null;
    var matcher = REASON.matcher(new String(head, StandardCharsets.UTF_8));
    return matcher.find() ? matcher.group(1) : null;
  }

  public WebPushChannelSender(VapidKeys keys, PushSettings settings, Transport transport) {
    this.keys = keys;
    this.settings = settings;
    this.transport = transport;
  }

  @Override
  public String channel() {
    return CHANNEL;
  }

  @Override
  public Result send(PushRecipient recipient, PushMessage message) {
    return deliver(recipient, message).result();
  }

  @Override
  public Delivery deliver(PushRecipient recipient, PushMessage message) {
    if (!PushEndpointPolicy.allowedEndpoint(recipient.endpoint()))
      return new Delivery(Result.REJECTED, null);
    final HttpRequest request;
    try {
      var subscription = new PushSubscription();
      subscription.setEndpoint(recipient.endpoint());
      var subscriptionKeys = new PushSubscription.Keys();
      subscriptionKeys.setP256dh(recipient.p256dh());
      subscriptionKeys.setAuth(recipient.auth());
      subscription.setKeys(subscriptionKeys);
      var ttl = message.urgent() ? settings.urgentTtl() : settings.defaultTtl();
      var urgency = message.urgent() ? settings.urgentUrgency() : settings.defaultUrgency();
      request =
          StandardHttpClientRequestPreparer.getBuilder()
              .pushSubscription(subscription)
              .vapidJWTExpiresAfter(12, TimeUnit.HOURS)
              .vapidJWTSubject(keys.subject())
              .pushMessage(message.json())
              .ttl(ttl.toSeconds(), TimeUnit.SECONDS)
              .urgency(urgency(urgency))
              .topic(message.topic())
              .build(keys.pair())
              .toRequestBuilder()
              .timeout(settings.operationTimeout())
              .build();
    } catch (RuntimeException invalid) {
      // Broken keys in the stored row: retrying cannot help. Only the exception type is logged.
      LOG.warn(
          "Web Push message not built for {} ({})",
          PushEndpointPolicy.redact(recipient.endpoint()),
          invalid.getClass().getSimpleName());
      return new Delivery(Result.REJECTED, null);
    }
    try {
      var reply = transport.exchange(request);
      var reason = reasonOf(reply.head());
      return new Delivery(classify(reply.status(), reason), reply.status(), reason);
    } catch (HttpTimeoutException timeout) {
      return new Delivery(Result.RETRYABLE, null);
    } catch (IOException network) {
      return new Delivery(Result.RETRYABLE, null);
    } catch (InterruptedException interrupted) {
      Thread.currentThread().interrupt();
      return new Delivery(Result.RETRYABLE, null);
    } catch (RuntimeException unexpected) {
      LOG.warn(
          "Web Push delivery failed for {} ({})",
          PushEndpointPolicy.redact(recipient.endpoint()),
          unexpected.getClass().getSimpleName());
      return new Delivery(Result.REJECTED, null);
    }
  }

  /**
   * 400 with reason VapidPkHashMismatch means the subscription was created with another VAPID key:
   * it can never be delivered with ours again, so it counts as gone. Any other 400 is a refusal.
   */
  static Result classify(int status, String reason) {
    if (status >= 200 && status < 300) return Result.DELIVERED;
    if (status == 404 || status == 410) return Result.GONE;
    if (status == 400 && VAPID_KEY_MISMATCH.equals(reason)) return Result.GONE;
    if (status == 429 || status >= 500) return Result.RETRYABLE;
    return Result.REJECTED;
  }

  private static Urgency.UrgencyOption urgency(String value) {
    return Urgency.UrgencyOption.valueOf(value.replace('-', '_').toUpperCase(Locale.ROOT));
  }

  /**
   * JDK transport. The status comes from the response headers, under the request timeout. For a 4xx
   * the first bytes of the body are read on a separate thread that is abandoned at the operation
   * timeout: a slow body never holds the sending thread, and the stream is always closed.
   */
  static Transport jdkTransport(PushSettings settings) {
    HttpClient client =
        HttpClient.newBuilder()
            .connectTimeout(settings.connectTimeout())
            .followRedirects(HttpClient.Redirect.NEVER)
            .build();
    ExecutorService bodyReader = Executors.newVirtualThreadPerTaskExecutor();
    return new Transport() {
      @Override
      public int send(HttpRequest request) throws IOException, InterruptedException {
        return exchange(request).status();
      }

      @Override
      public Reply exchange(HttpRequest request) throws IOException, InterruptedException {
        HttpResponse<InputStream> response =
            client.send(request, HttpResponse.BodyHandlers.ofInputStream());
        int status = response.statusCode();
        InputStream body = response.body();
        if (status < 400 || status >= 500) {
          body.close();
          return new Reply(status, new byte[0]);
        }
        return new Reply(status, readHead(body));
      }

      /** Reads the head on another thread; any failure or timeout yields no reason. */
      private byte[] readHead(InputStream body) {
        Future<byte[]> head = bodyReader.submit(() -> body.readNBytes(MAX_REASON_BYTES));
        try {
          return head.get(settings.operationTimeout().toMillis(), TimeUnit.MILLISECONDS);
        } catch (InterruptedException interrupted) {
          Thread.currentThread().interrupt();
          return new byte[0];
        } catch (ExecutionException | TimeoutException unreadable) {
          return new byte[0];
        } finally {
          head.cancel(true);
          closeQuietly(body);
        }
      }

      private void closeQuietly(InputStream body) {
        try {
          body.close();
        } catch (IOException ignored) {
          // Nothing else to release; the status is already known.
        }
      }
    };
  }
}
