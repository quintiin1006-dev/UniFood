package com.santotofood.application.model;

/** Minimal business projection; personal identity remains outside the WORKER profile. */
public record WorkerProfileDetails(
    String cafeteriaName, boolean cafeteriaActive, String siteName, String institutionName) {
  public WorkerProfileDetails {
    requireName(cafeteriaName);
    requireName(siteName);
    requireName(institutionName);
  }

  private static void requireName(String name) {
    if (name == null || name.isBlank())
      throw new IllegalStateException("Incomplete worker profile context");
  }
}
