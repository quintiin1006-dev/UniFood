package com.santotofood.application.model;

import java.util.List;
import java.util.Objects;
import java.util.UUID;

/** Read-only SUPER_ADMIN view: institutions, their sites and each site's cafeterias. */
public record SuperAdminInstitution(UUID id, String name, boolean active, List<Site> sites) {
  public SuperAdminInstitution {
    Objects.requireNonNull(id);
    requireName(name);
    sites = List.copyOf(sites);
  }

  public record Site(
      UUID id, String name, String city, boolean active, List<Cafeteria> cafeterias) {
    public Site {
      Objects.requireNonNull(id);
      requireName(name);
      requireName(city);
      cafeterias = List.copyOf(cafeterias);
    }
  }

  /**
   * {@code visible} is {@code cafeterias.is_active}: visible to clients and accepting new orders
   * (decisiones §5). The billing agreement is independent of it (022).
   */
  public record Cafeteria(
      UUID id,
      String name,
      boolean visible,
      boolean hasActiveAdmin,
      CafeteriaBilling billing,
      int billingVersion) {
    public Cafeteria {
      Objects.requireNonNull(id);
      requireName(name);
      Objects.requireNonNull(billing);
    }
  }

  private static void requireName(String name) {
    if (name == null || name.isBlank())
      throw new IllegalStateException("Incomplete super admin cafeteria tree");
  }
}
