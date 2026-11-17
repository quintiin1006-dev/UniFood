package com.santotofood.adapter.out.push;

import com.santotofood.application.model.PushRecipient;
import com.santotofood.application.service.PushEndpointPolicy;
import com.zerodeplibs.webpush.PushSubscription;
import com.zerodeplibs.webpush.header.Urgency;
import com.zerodeplibs.webpush.httpclient.StandardHttpClientRequestPreparer;
import java.io.IOException;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.util.Locale;
import java.util.concurrent.TimeUnit;
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

  /** The HTTP exchange, replaceable in tests by a simulated push service. */
  @FunctionalInterface
  public interface Transport {
    int send(HttpRequest request) throws IOException, InterruptedException;
  }

  private final VapidKeys keys;
  private final PushSettings settings;
  private final Transport transport;

  public WebPushChannelSender(VapidKeys keys, PushSettings settings) {
    this(keys, settings, jdkTransport(settings));
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
    if (!PushEndpointPolicy.allowedEndpoint(recipient.endpoint())) return Result.REJECTED;
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
      return Result.REJECTED;
    }
    try {
      int status = transport.send(request);
      return classify(status);
    } catch (HttpTimeoutException timeout) {
      return Result.RETRYABLE;
    } catch (IOException network) {
      return Result.RETRYABLE;
    } catch (InterruptedException interrupted) {
      Thread.currentThread().interrupt();
      return Result.RETRYABLE;
    } catch (RuntimeException unexpected) {
      LOG.warn(
          "Web Push delivery failed for {} ({})",
          PushEndpointPolicy.redact(recipient.endpoint()),
          unexpected.getClass().getSimpleName());
      return Result.REJECTED;
    }
  }

  static Result classify(int status) {
    if (status >= 200 && status < 300) return Result.DELIVERED;
    if (status == 404 || status == 410) return Result.GONE;
    if (status == 429 || status >= 500) return Result.RETRYABLE;
    return Result.REJECTED;
  }

  private static Urgency.UrgencyOption urgency(String value) {
    return Urgency.UrgencyOption.valueOf(value.replace('-', '_').toUpperCase(Locale.ROOT));
  }

  private static Transport jdkTransport(PushSettings settings) {
    HttpClient client =
        HttpClient.newBuilder()
            .connectTimeout(settings.connectTimeout())
            .followRedirects(HttpClient.Redirect.NEVER)
            .build();
    return request -> client.send(request, HttpResponse.BodyHandlers.discarding()).statusCode();
  }
}
