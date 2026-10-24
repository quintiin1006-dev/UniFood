package com.santotofood.application.model;

import java.time.Instant;
import java.util.UUID;

public final class CatalogImage {
  private CatalogImage() {}

  public record Content(byte[] bytes, String contentType, int width, int height, String sha256) {}

  public record Asset(
      UUID id,
      UUID cafeteriaId,
      UUID productId,
      String bucket,
      String objectKey,
      String contentType,
      int byteSize,
      int width,
      int height,
      String sha256,
      String state) {}

  public record Operation(
      UUID id,
      UUID actorId,
      UUID cafeteriaId,
      UUID productId,
      UUID key,
      String kind,
      long expectedVersion,
      String fingerprint,
      UUID assetId,
      String state,
      Long appliedVersion,
      Integer failureStatus,
      String failureCode,
      Instant leaseUntil) {}

  public record Result(Operation operation, AdminCatalogProduct product) {}

  public static String source(UUID product, UUID asset, String legacy) {
    return asset == null ? legacy : "/api/admin/catalog/" + product + "/image/" + asset;
  }
}
