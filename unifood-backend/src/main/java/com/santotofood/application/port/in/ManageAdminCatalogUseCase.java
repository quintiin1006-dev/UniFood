package com.santotofood.application.port.in;

import com.santotofood.application.model.AdminCatalogProduct;
import com.santotofood.application.model.CatalogForm;
import java.util.UUID;

public interface ManageAdminCatalogUseCase {
  AdminCatalogProduct create(UUID subject, CatalogForm form);

  AdminCatalogProduct edit(UUID subject, UUID productId, long expectedVersion, CatalogForm form);

  AdminCatalogProduct status(UUID subject, UUID productId, long expectedVersion, boolean active);
}
