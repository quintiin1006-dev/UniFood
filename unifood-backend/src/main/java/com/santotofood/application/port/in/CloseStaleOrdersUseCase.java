package com.santotofood.application.port.in;

/**
 * B19 daily close (docs/decisiones.md §6 and §11): active orders created before today's business
 * day in America/Bogota are closed. Idempotent; locked rows are left for the next run.
 */
public interface CloseStaleOrdersUseCase {

  ClosedOrders closeStaleOrders();

  /** How many orders each rule closed; no ids or personal data. */
  record ClosedOrders(int cancelled, int notCollected) {}
}
