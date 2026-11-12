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
      // The next run retries; the type is enough and carries no order data.
      LOGGER.warn("Cierre diario no completado: {}", failure.getClass().getSimpleName());
    }
  }
}
