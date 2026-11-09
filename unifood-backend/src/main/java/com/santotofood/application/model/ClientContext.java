package com.santotofood.application.model;

import java.util.List;
import java.util.UUID;

/** What a client may order from: active cafeterias of its own institution, by site. */
public record ClientContext(
    String fullName,
    String clientType,
    Institution institution,
    List<Site> sites,
    UUID activeOrderId) {

  public record Institution(UUID id, String name) {}

  public record Site(UUID id, String name, List<Cafeteria> cafeterias) {}

  public record Cafeteria(UUID id, String name, boolean open) {}
}
