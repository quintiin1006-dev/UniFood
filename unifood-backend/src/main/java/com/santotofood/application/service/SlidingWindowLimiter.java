package com.santotofood.application.service;

import com.santotofood.domain.port.out.TimeProvider;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * In-memory per-key limit: at most {@code max} events in any {@code window}. Each backend instance
 * keeps its own counts (docs/notificaciones-push.md, «Varias instancias»).
 */
public final class SlidingWindowLimiter {
  private static final int CLEANUP_EVERY = 256;
  private final int max;
  private final Duration window;
  private final TimeProvider clock;
  private final Map<Object, ArrayDeque<Instant>> events = new ConcurrentHashMap<>();
  private final AtomicInteger calls = new AtomicInteger();

  public SlidingWindowLimiter(int max, Duration window, TimeProvider clock) {
    if (max < 1 || window.isNegative() || window.isZero())
      throw new IllegalArgumentException("Invalid limit");
    this.max = max;
    this.window = window;
    this.clock = clock;
  }

  /** Records the event and answers whether it is within the limit. */
  public boolean tryAcquire(Object key) {
    Instant now = clock.now();
    Instant oldest = now.minus(window);
    boolean[] allowed = {false};
    events.compute(
        key,
        (ignored, queue) -> {
          ArrayDeque<Instant> times = queue == null ? new ArrayDeque<>() : queue;
          while (!times.isEmpty() && !times.peekFirst().isAfter(oldest)) times.pollFirst();
          if (times.size() < max) {
            times.addLast(now);
            allowed[0] = true;
          }
          return times;
        });
    if (calls.incrementAndGet() % CLEANUP_EVERY == 0) cleanup(oldest);
    return allowed[0];
  }

  private void cleanup(Instant oldest) {
    for (var key : events.keySet())
      events.computeIfPresent(
          key,
          (ignored, times) -> {
            var last = times.peekLast();
            return last == null || !last.isAfter(oldest) ? null : times;
          });
  }
}
