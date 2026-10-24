package com.santotofood.application.exception;

/** Sanitized image errors; provider messages are never part of the public contract. */
public class CatalogImageException extends RuntimeException {
  private final int status;
  private final String code;

  public CatalogImageException(int status, String code) {
    super(code);
    this.status = status;
    this.code = code;
  }

  public int status() {
    return status;
  }

  public String code() {
    return code;
  }

  public static CatalogImageException invalid() {
    return new CatalogImageException(400, "ADMIN_CATALOG_IMAGE_INVALID_REQUEST");
  }

  public static CatalogImageException unavailable() {
    return new CatalogImageException(503, "ADMIN_CATALOG_IMAGE_TEMPORARILY_UNAVAILABLE");
  }
}
