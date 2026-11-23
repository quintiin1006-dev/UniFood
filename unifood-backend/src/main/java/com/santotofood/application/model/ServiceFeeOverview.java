package com.santotofood.application.model;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** The general fee and every cafeteria's own value (null = uses the general one), 033. */
public record ServiceFeeOverview(General general, List<Cafeteria> cafeterias) {

  public ServiceFeeOverview {
    cafeterias = List.copyOf(cafeterias);
  }

  public record General(int feeCop, int version, Instant updatedAt) {}

  /** {@code effectiveFeeCop} is what a new order of this cafeteria pays right now. */
  public record Cafeteria(
      UUID id,
      String name,
      String siteName,
      boolean visible,
      Integer ownFeeCop,
      int effectiveFeeCop,
      int version) {}
}
