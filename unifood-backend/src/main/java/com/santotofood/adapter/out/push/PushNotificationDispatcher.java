package com.santotofood.adapter.out.push;

import com.santotofood.application.model.PushRecipient;
import com.santotofood.application.port.out.PushSubscriptionPort;
import com.santotofood.application.service.PushEndpointPolicy;
import com.santotofood.application.service.SlidingWindowLimiter;
import com.santotofood.domain.model.OrderPushEvent;
import com.santotofood.domain.port.out.PushNotificationPort;
import com.santotofood.domain.port.out.TimeProvider;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executor;
import java.util.concurrent.RejectedExecutionException;
import java.util.function.Function;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * PushNotificationPort over the channel senders.
 *
 * <ol>
 *   <li>{@link #publish} only registers the event: inside a transaction it runs after the commit (a
 *       rollback sends nothing); it never throws and never touches the network.
 *   <li>The bounded executor resolves the recipients from the database and delivers. A full queue
 *       drops the notice with a log line; the in-app notice still covers it.
 *   <li>Anti-spam: one notice per (order, kind, reminder number) within six hours, and at most
 *       {@link PushSettings#perUserLimit()} notices per user and window. Both live in this
 *       instance's memory (docs/notificaciones-push.md, «Varias instancias»).
 *   <li>404/410 revokes the subscription; timeouts, 429 and 5xx retry a limited number of times.
 * </ol>
 */
public final class PushNotificationDispatcher implements PushNotificationPort {
  private static final Logger LOG = LoggerFactory.getLogger(PushNotificationDispatcher.class);

  /** Waits between retries; replaceable so tests never sleep. */
  @FunctionalInterface
  public interface Sleeper {
    void sleep(Duration duration) throws InterruptedException;
  }

  private final PushSubscriptionPort subscriptions;
  private final Map<String, PushChannelSender> senders;
  private final Executor executor;
  private final PushSettings settings;
  private final Sleeper sleeper;
  private final SlidingWindowLimiter deduplication;
  private final SlidingWindowLimiter perUser;

  public PushNotificationDispatcher(
      PushSubscriptionPort subscriptions,
      List<PushChannelSender> senders,
      Executor executor,
      PushSettings settings,
      TimeProvider clock,
      Sleeper sleeper) {
    this.subscriptions = subscriptions;
    this.senders =
        senders.stream().collect(Collectors.toMap(PushChannelSender::channel, Function.identity()));
    this.executor = executor;
    this.settings = settings;
    this.sleeper = sleeper;
    this.deduplication = new SlidingWindowLimiter(1, PushSettings.DEDUPLICATION_WINDOW, clock);
    this.perUser =
        new SlidingWindowLimiter(settings.perUserLimit(), settings.perUserWindow(), clock);
  }

  @Override
  public void publish(OrderPushEvent event) {
    try {
      if (event == null || senders.isEmpty()) return;
      if (TransactionSynchronizationManager.isSynchronizationActive()) {
        TransactionSynchronizationManager.registerSynchronization(
            new TransactionSynchronization() {
              @Override
              public void afterCommit() {
                enqueue(event);
              }
            });
      } else {
        enqueue(event);
      }
    } catch (RuntimeException failure) {
      // The order transition must never depend on push.
      LOG.warn(
          "Push notice not scheduled for {} ({})",
          event == null ? null : event.kind(),
          failure.getClass().getSimpleName());
    }
  }

  private void enqueue(OrderPushEvent event) {
    try {
      executor.execute(() -> deliver(event));
    } catch (RejectedExecutionException full) {
      LOG.warn("Push queue full; notice {} dropped", event.kind());
    } catch (RuntimeException failure) {
      LOG.warn("Push notice {} not queued ({})", event.kind(), failure.getClass().getSimpleName());
    }
  }

  /** Runs on the push executor, after the commit. Never throws. */
  void deliver(OrderPushEvent event) {
    try {
      if (!deduplication.tryAcquire(event.deduplicationKey())) {
        LOG.debug("Duplicate push notice {} skipped", event.kind());
        return;
      }
      List<PushRecipient> recipients =
          subscriptions.findRecipients(event.orderId(), event.kind().audience());
      if (recipients.isEmpty()) return;
      PushMessage message = PushMessage.of(event);
      for (PushRecipient recipient : recipients) deliverTo(recipient, message, event);
    } catch (RuntimeException failure) {
      LOG.warn("Push notice {} failed ({})", event.kind(), failure.getClass().getSimpleName());
    }
  }

  private void deliverTo(PushRecipient recipient, PushMessage message, OrderPushEvent event) {
    PushChannelSender sender = senders.get(recipient.channel());
    if (sender == null) return; // A channel this instance does not implement (FCM, today).
    if (!perUser.tryAcquire(recipient.userId())) {
      LOG.info("Push rate limit reached for one user; notice {} skipped", event.kind());
      return;
    }
    String target = PushEndpointPolicy.redact(recipient.endpoint());
    Duration wait = settings.retryBackoff();
    for (int attempt = 0; ; attempt++) {
      PushChannelSender.Delivery delivery;
      try {
        delivery = sender.deliver(recipient, message);
      } catch (RuntimeException failure) {
        delivery = new PushChannelSender.Delivery(PushChannelSender.Result.REJECTED, null);
      }
      switch (delivery.result()) {
        case DELIVERED -> {
          return;
        }
        case GONE -> {
          subscriptions.markGone(recipient.subscriptionId());
          LOG.info("Push subscription at {} is gone; revoked", target);
          return;
        }
        case REJECTED -> {
          // Only the HTTP status and the redacted endpoint: never keys, auth or the body.
          LOG.warn(
              "Push notice {} refused ({}) by {}",
              event.kind(),
              refusal(delivery.httpStatus(), delivery.reason()),
              target);
          return;
        }
        case RETRYABLE -> {
          if (attempt >= settings.maxRetries()) {
            LOG.warn(
                "Push notice {} to {} failed after {} attempts", event.kind(), target, attempt + 1);
            return;
          }
          try {
            if (!wait.isZero()) sleeper.sleep(wait);
          } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            return;
          }
          wait = wait.multipliedBy(2);
        }
      }
    }
  }

  /** «HTTP 403», or «no HTTP response» when the refusal happened before or without one. */
  static String refusal(Integer httpStatus) {
    return refusal(httpStatus, null);
  }

  /**
   * «HTTP 400, reason=VapidPkHashMismatch» when the push service gave a valid reason token, else
   * the same text as {@link #refusal(Integer)}. The token is checked again here: only letters.
   */
  static String refusal(Integer httpStatus, String reason) {
    if (httpStatus == null) return "no HTTP response";
    if (reason == null || !REASON_TOKEN.matcher(reason).matches()) return "HTTP " + httpStatus;
    return "HTTP " + httpStatus + ", reason=" + reason;
  }

  private static final Pattern REASON_TOKEN = Pattern.compile("[A-Za-z]{1,40}");
}
