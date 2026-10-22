package com.santotofood.application.model;

/** Minimal business projection; personal identity remains outside the ADMIN profile. */
public record AdminProfileDetails(
    String cafeteriaName, boolean cafeteriaActive, String siteName, String institutionName) {
  public AdminProfileDetails {
    requireName(cafeteriaName);
    requireName(siteName);
    requireName(institutionName);
  }

  private static void requireName(String name) {
    if (name == null || name.isBlank())
      throw new IllegalStateException("Incomplete admin profile context");
  }
}
