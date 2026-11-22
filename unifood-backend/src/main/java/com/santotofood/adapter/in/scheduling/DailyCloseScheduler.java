package com.santotofood.adapter.in.scheduling;

import com.santotofood.application.port.in.CloseStaleOrdersUseCase;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Runs the daily close at startup and then every {@code orders.daily-close.interval} (PT1H by
 * default), because in the demo the backend is off at night. {@code
 * orders.daily-close.enabled=false} (DAILY_CLOSE_ENABLED) does not register it at all.
 */
@Component
@ConditionalOnProperty(
    prefix = "orders.daily-close",
    name = "enabled",
    havingValue = "true",
    matchIfMissing = true)
public class DailyCloseScheduler {
  private static final Logger LOGGER = LoggerFactory.getLogger(DailyCloseScheduler.class);
  private final CloseStaleOrdersUseCase close;

  public DailyCloseScheduler(CloseStaleOrdersUseCase close) {
    this.close = close;
  }

  @Scheduled(initialDelayString = "PT0S", fixedDelayString = "${orders.daily-close.interval:PT1H}")
  public void run() {
    try {
      close.closeStaleOrders();
    } catch (RuntimeException failure) {
      // The next run retries. The type and a count only: never order ids, names or codes.
      String type = failure.getClass().getSimpleName();
      Integer left = staleLeft();
      if (left == null)
        LOGGER.warn("Cierre diario no completado: {}; no se pudo contar lo pendiente", type);
      else LOGGER.warn("Cierre diario no completado: {}; {} pedidos sin cerrar", type, left);
    }
  }

  /** How many stale orders the failed run left open, or null if they cannot be counted now. */
  private Integer staleLeft() {
    try {
      return close.countStaleOrders();
    } catch (RuntimeException countFailure) {
      return null;
    }
  }
}
