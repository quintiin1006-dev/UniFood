package com.santotofood.application.port.out;

import com.santotofood.application.model.AdminCatalogProduct;
import com.santotofood.application.model.CatalogForm;
import java.time.LocalDate;
import java.util.Optional;
import java.util.UUID;

public interface AdminCatalogCommandPort {
  void lockAuthorizationGuard();

  boolean lockActiveCafeteria(UUID cafeteriaId);

  Optional<AdminCatalogProduct> lockProduct(UUID cafeteriaId, UUID productId);

  AdminCatalogProduct create(UUID cafeteriaId, CatalogForm form);

  Optional<AdminCatalogProduct> edit(
      UUID cafeteriaId, UUID id, long expectedVersion, CatalogForm form);

  Optional<AdminCatalogProduct> status(
      UUID cafeteriaId, UUID id, long expectedVersion, boolean active);

  void disableDailyAvailability(UUID cafeteriaId, UUID id, LocalDate businessDate);
}
