package com.santotofood.config;

import com.santotofood.adapter.out.push.PushChannelSender;
import com.santotofood.adapter.out.push.PushNotificationDispatcher;
import com.santotofood.adapter.out.push.PushSettings;
import com.santotofood.adapter.out.push.VapidKeys;
import com.santotofood.adapter.out.push.WebPushChannelSender;
import com.santotofood.application.port.out.PushSubscriptionPort;
import com.santotofood.domain.port.out.PushNotificationPort;
import com.santotofood.domain.port.out.TimeProvider;
import java.time.Duration;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Push notifications (docs/notificaciones-push.md). Without a complete and valid VAPID identity the
 * module is disabled: one clear WARN line at startup, publish() does nothing, the public-key
 * endpoint answers 503 and the in-app notice keeps working as the only channel.
 */
@Configuration
public class PushConfiguration {
  private static final Logger LOG = LoggerFactory.getLogger(PushConfiguration.class);
  private static final int QUEUE_CAPACITY = 500;

  /** The server's VAPID identity, when the environment provides a valid one. */
  public record PushIdentity(Optional<VapidKeys> keys) {
    public Optional<String> publicKey() {
      return keys.map(VapidKeys::publicKey);
    }
  }

  @Bean
  PushIdentity pushIdentity(
      @Value("${push.vapid.public-key:}") String publicKey,
      @Value("${push.vapid.private-key:}") String privateKey,
      @Value("${push.vapid.subject:}") String subject) {
    var loaded = VapidKeys.load(publicKey, privateKey, subject);
    loaded
        .problem()
        .ifPresent(
            problem ->
                LOG.warn(
                    "Push notifications disabled: VAPID configuration {}. Set VAPID_PUBLIC_KEY,"
                        + " VAPID_PRIVATE_KEY and VAPID_SUBJECT (docs/notificaciones-push.md)."
                        + " In-app notices keep working.",
                    problem));
    loaded.keys().ifPresent(keys -> LOG.info("Push notifications enabled (Web Push)"));
    return new PushIdentity(loaded.keys());
  }

  @Bean
  PushSettings pushSettings(
      @Value("${push.urgent-ttl-seconds:900}") long urgentTtl,
      @Value("${push.default-ttl-seconds:3600}") long defaultTtl,
      @Value("${push.urgent-urgency:high}") String urgentUrgency,
      @Value("${push.default-urgency:normal}") String defaultUrgency,
      @Value("${push.connect-timeout-seconds:5}") long connectTimeout,
      @Value("${push.operation-timeout-seconds:10}") long operationTimeout,
      @Value("${push.max-retries:2}") int maxRetries,
      @Value("${push.retry-backoff-ms:1000}") long retryBackoff,
      @Value("${push.per-user-limit:20}") int perUserLimit,
      @Value("${push.per-user-window-minutes:10}") long perUserWindow) {
    return new PushSettings(
        Duration.ofSeconds(urgentTtl),
        Duration.ofSeconds(defaultTtl),
        urgentUrgency,
        defaultUrgency,
        Duration.ofSeconds(connectTimeout),
        Duration.ofSeconds(operationTimeout),
        maxRetries,
        Duration.ofMillis(retryBackoff),
        perUserLimit,
        Duration.ofMinutes(perUserWindow));
  }

  /** Two daemon threads and a bounded queue: push can never exhaust the request threads. */
  @Bean(destroyMethod = "shutdownNow")
  ThreadPoolExecutor pushExecutor() {
    var counter = new AtomicInteger();
    var executor =
        new ThreadPoolExecutor(
            2,
            2,
            60,
            TimeUnit.SECONDS,
            new ArrayBlockingQueue<>(QUEUE_CAPACITY),
            runnable -> {
              var thread = new Thread(runnable, "push-" + counter.incrementAndGet());
              thread.setDaemon(true);
              return thread;
            },
            new ThreadPoolExecutor.AbortPolicy());
    executor.allowCoreThreadTimeOut(true);
    return executor;
  }

  @Bean
  PushNotificationPort pushNotificationPort(
      PushIdentity identity,
      PushSettings settings,
      PushSubscriptionPort subscriptions,
      ThreadPoolExecutor pushExecutor,
      TimeProvider clock) {
    List<PushChannelSender> senders =
        identity
            .keys()
            .<List<PushChannelSender>>map(keys -> List.of(new WebPushChannelSender(keys, settings)))
            .orElse(List.of());
    return new PushNotificationDispatcher(
        subscriptions,
        senders,
        pushExecutor,
        settings,
        clock,
        duration -> Thread.sleep(duration.toMillis()));
  }
}
