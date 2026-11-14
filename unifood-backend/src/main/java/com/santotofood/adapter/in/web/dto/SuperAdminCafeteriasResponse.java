package com.santotofood.adapter.in.web.dto;

import com.santotofood.application.model.SuperAdminInstitution;
import java.util.List;
import java.util.UUID;

public record SuperAdminCafeteriasResponse(List<Institution> institutions) {
  public record Institution(UUID id, String name, boolean active, List<Site> sites) {}

  public record Site(
      UUID id, String name, String city, boolean active, List<Cafeteria> cafeterias) {}

  /** {@code visible} replaces the former {@code subscribed} (022): same value, is_active. */
  public record Cafeteria(
      UUID id, String name, boolean visible, boolean hasActiveAdmin, Billing billing) {}

  /** Recorded agreement only; nothing is charged. Amounts in whole pesos, or null. */
  public record Billing(
      String model, Integer perOrderFeeCop, Integer subscriptionFeeCop, int version) {}

  public static Cafeteria cafeteria(SuperAdminInstitution.Cafeteria cafeteria) {
    var billing = cafeteria.billing();
    return new Cafeteria(
        cafeteria.id(),
        cafeteria.name(),
        cafeteria.visible(),
        cafeteria.hasActiveAdmin(),
        new Billing(
            billing.model().name(),
            billing.perOrderFeeCop(),
            billing.subscriptionFeeCop(),
            cafeteria.billingVersion()));
  }

  public static SuperAdminCafeteriasResponse from(List<SuperAdminInstitution> institutions) {
    return new SuperAdminCafeteriasResponse(
        institutions.stream()
            .map(
                institution ->
                    new Institution(
                        institution.id(),
                        institution.name(),
                        institution.active(),
                        institution.sites().stream()
                            .map(
                                site ->
                                    new Site(
                                        site.id(),
                                        site.name(),
                                        site.city(),
                                        site.active(),
                                        site.cafeterias().stream()
                                            .map(SuperAdminCafeteriasResponse::cafeteria)
                                            .toList()))
                            .toList()))
            .toList());
  }
}
