package com.santotofood.application.port.out;

import java.util.UUID;

/** The fee in force for a cafeteria: its own value, or the general one when it has none (033). */
public interface ServiceFeeQueryPort {

  /** Plain read, for the menu the client sees before confirming. */
  int effectiveFee(UUID cafeteriaId);

  /**
   * Same value, read with {@code FOR SHARE} on the general row inside the order's transaction, so a
   * change of the general fee waits for the order (or the order waits for the change).
   */
  int lockEffectiveFee(UUID cafeteriaId);
}
