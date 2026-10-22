package com.santotofood.application.port.out;

import com.santotofood.application.model.AdminCatalogProduct;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface AdminCatalogQueryPort {
  /** Empty Optional means the authorized cafeteria does not exist; an empty list is valid. */
  Optional<List<AdminCatalogProduct>> findByCafeteria(UUID authorizedCafeteriaId);
}
