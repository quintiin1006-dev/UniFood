package com.santotofood.application.port.out;

/** Whether SERVICE_FEE_ENABLED is on (docs/modelo-de-negocio.md). Off: every new order has 0. */
public interface ServiceFeeFlag {
  boolean enabled();
}
