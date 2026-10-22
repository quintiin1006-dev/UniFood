package com.santotofood.application.port.in;

import com.santotofood.application.model.AdminCatalogProduct;
import java.util.List;
import java.util.UUID;

public interface GetAdminCatalogUseCase {
  List<AdminCatalogProduct> getAdminCatalog(UUID authenticatedUserId);
}
