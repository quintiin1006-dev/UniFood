package com.santotofood.adapter.in.web.dto;

import com.santotofood.application.model.SuperAdminInstitution;
import java.util.List;
import java.util.UUID;

public record SuperAdminCafeteriasResponse(List<Institution> institutions) {
  public record Institution(UUID id, String name, boolean active, List<Site> sites) {}

  public record Site(
      UUID id, String name, String city, boolean active, List<Cafeteria> cafeterias) {}

  public record Cafeteria(UUID id, String name, boolean subscribed, boolean hasActiveAdmin) {}

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
                                            .map(
                                                cafeteria ->
                                                    new Cafeteria(
                                                        cafeteria.id(),
                                                        cafeteria.name(),
                                                        cafeteria.subscribed(),
                                                        cafeteria.hasActiveAdmin()))
                                            .toList()))
                            .toList()))
            .toList());
  }
}
