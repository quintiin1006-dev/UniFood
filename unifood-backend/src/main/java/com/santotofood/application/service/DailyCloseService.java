package com.santotofood.application.service;

import com.santotofood.application.port.in.CloseStaleOrdersUseCase;
import com.santotofood.application.port.out.StaleOrderClosePort;
import com.santotofood.domain.model.BusinessDate;
import com.santotofood.domain.port.out.TimeProvider;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * B19: the same rule as scripts/supabase/close-stale-orders.sql, run by Spring.
 *
 * <p>It does not go through the {@link com.santotofood.domain.model.Order} aggregate: like the
 * script, it skips the worker's rules for NOT_COLLECTED (CALLED with three reminders), because a
 * forgotten order from an earlier day must close whatever its state. A row a worker holds right now
 * is skipped and closed on the next run; two instances never close the same row twice.
 */
@Service
public class DailyCloseService implements CloseStaleOrdersUseCase {
  private static final Logger LOGGER = LoggerFactory.getLogger(DailyCloseService.class);

  private final StaleOrderClosePort orders;
  private final TimeProvider clock;
  private final TransactionTemplate write;

  public DailyCloseService(
      StaleOrderClosePort orders, TimeProvider clock, PlatformTransactionManager manager) {
    this.orders = orders;
    this.clock = clock;
    this.write = new TransactionTemplate(manager);
    write.setIsolationLevel(TransactionDefinition.ISOLATION_READ_COMMITTED);
    write.setTimeout(15);
  }

  @Override
  public ClosedOrders closeStaleOrders() {
    var now = clock.now();
    var dayStart = BusinessDate.from(now).dayStartInstant();
    var closed =
        write.execute(
            status ->
                new ClosedOrders(
                    orders.cancelStalePending(dayStart, now),
                    orders.markStaleNotCollected(dayStart, now)));
    // Counts only: never ids, names or codes.
    LOGGER.info(
        "Cierre diario: {} pedidos PENDING cancelados por el sistema, {} marcados NOT_COLLECTED",
        closed.cancelled(),
        closed.notCollected());
    return closed;
  }
}
