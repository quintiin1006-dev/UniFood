package com.santotofood.application.port.out;

/** Whether AVISOS_BANDEJA_ENABLED is on: off, no notice is written and the inbox answers 404. */
public interface OrderNoticesFlag {
  boolean enabled();
}
