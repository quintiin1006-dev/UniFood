package com.santotofood.adapter.out.push;

import java.time.Duration;
import java.util.Locale;

/**
 * Delivery settings, all from the environment (application.properties, push.*).
 *
 * @param urgentTtl TTL of READY, CALLED, reminders and new orders: a late notice is useless
 * @param defaultTtl TTL of the other notices
 * @param urgentUrgency Web Push Urgency header of the urgent notices (very-low|low|normal|high)
 * @param defaultUrgency Urgency of the other notices
 * @param connectTimeout connection timeout to the push service
 * @param operationTimeout whole-request timeout to the push service
 * @param maxRetries retries after a RETRYABLE result, 0 to 3
 * @param retryBackoff wait before the first retry; doubled on each next one
 * @param perUserLimit notices per user within {@code perUserWindow}
 */
public record PushSettings(
    Duration urgentTtl,
    Duration defaultTtl,
    String urgentUrgency,
    String defaultUrgency,
    Duration connectTimeout,
    Duration operationTimeout,
    int maxRetries,
    Duration retryBackoff,
    int perUserLimit,
    Duration perUserWindow) {

  public static final Duration DEDUPLICATION_WINDOW = Duration.ofHours(6);

  public PushSettings {
    requireRange("push.urgent-ttl-seconds", urgentTtl, 60, 3600);
    requireRange("push.default-ttl-seconds", defaultTtl, 60, 86400);
    urgentUrgency = urgency("push.urgent-urgency", urgentUrgency);
    defaultUrgency = urgency("push.default-urgency", defaultUrgency);
    requireRange("push.connect-timeout-seconds", connectTimeout, 1, 30);
    requireRange("push.operation-timeout-seconds", operationTimeout, 1, 60);
    if (maxRetries < 0 || maxRetries > 3)
      throw new IllegalArgumentException("push.max-retries must be between 0 and 3");
    if (retryBackoff.isNegative() || retryBackoff.compareTo(Duration.ofSeconds(30)) > 0)
      throw new IllegalArgumentException("push.retry-backoff-ms must be between 0 and 30000");
    if (perUserLimit < 1) throw new IllegalArgumentException("push.per-user-limit must be >= 1");
  }

  public static PushSettings defaults() {
    return new PushSettings(
        Duration.ofMinutes(15),
        Duration.ofHours(1),
        "high",
        "normal",
        Duration.ofSeconds(5),
        Duration.ofSeconds(10),
        2,
        Duration.ofSeconds(1),
        20,
        Duration.ofMinutes(10));
  }

  private static void requireRange(String name, Duration value, long min, long max) {
    if (value == null || value.toSeconds() < min || value.toSeconds() > max)
      throw new IllegalArgumentException(name + " must be between " + min + " and " + max);
  }

  private static String urgency(String name, String value) {
    String clean = value == null ? "" : value.strip().toLowerCase(Locale.ROOT);
    return switch (clean) {
      case "very-low", "low", "normal", "high" -> clean;
      default ->
          throw new IllegalArgumentException(name + " must be very-low, low, normal or high");
    };
  }
}
