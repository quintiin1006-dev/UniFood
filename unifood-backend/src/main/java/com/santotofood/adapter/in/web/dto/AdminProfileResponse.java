package com.santotofood.adapter.in.web.dto;

import com.santotofood.application.model.AdminProfileDetails;

public record AdminProfileResponse(
    String role, Cafeteria cafeteria, Place site, Place institution) {
  public record Cafeteria(String name, boolean active) {}

  public record Place(String name) {}

  public static AdminProfileResponse from(AdminProfileDetails details) {
    return new AdminProfileResponse(
        "ADMIN",
        new Cafeteria(details.cafeteriaName(), details.cafeteriaActive()),
        new Place(details.siteName()),
        new Place(details.institutionName()));
  }
}
