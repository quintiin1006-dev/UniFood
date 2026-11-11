package com.santotofood.application.port.out;

import java.time.Instant;

/**
 * The close's two writes, each one statement with {@code FOR UPDATE SKIP LOCKED}. They run in the
 * caller's transaction and return how many rows changed.
 */
public interface StaleOrderClosePort {

  /** PENDING created before {@code dayStart} becomes CANCELLED by SYSTEM at {@code closedAt}. */
  int cancelStalePending(Instant dayStart, Instant closedAt);

  /** PREPARING, READY and CALLED created before {@code dayStart} become NOT_COLLECTED. */
  int markStaleNotCollected(Instant dayStart, Instant closedAt);
}
