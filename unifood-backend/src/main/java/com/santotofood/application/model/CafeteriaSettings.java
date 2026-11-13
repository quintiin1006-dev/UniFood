package com.santotofood.application.model;

import java.util.Objects;

/** Current, locked settings of one cafeteria: visibility (is_active) and billing agreement. */
public record CafeteriaSettings(
    boolean visible, boolean hasActiveAdmin, CafeteriaBilling billing, int billingVersion) {
  public CafeteriaSettings {
    Objects.requireNonNull(billing);
    if (billingVersion < 0) throw new IllegalStateException("Negative billing version");
  }
}
