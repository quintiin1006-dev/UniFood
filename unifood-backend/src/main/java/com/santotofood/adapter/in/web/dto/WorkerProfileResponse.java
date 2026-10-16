package com.santotofood.adapter.in.web.dto;

import com.santotofood.application.model.WorkerProfileDetails;

public record WorkerProfileResponse(
    String role, Cafeteria cafeteria, Place site, Place institution) {
  public record Cafeteria(String name, boolean active) {}

  public record Place(String name) {}

  public static WorkerProfileResponse from(WorkerProfileDetails details) {
    return new WorkerProfileResponse(
        "WORKER",
        new Cafeteria(details.cafeteriaName(), details.cafeteriaActive()),
        new Place(details.siteName()),
        new Place(details.institutionName()));
  }
}
