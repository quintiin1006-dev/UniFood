package com.santotofood.application.port.out;

import com.santotofood.application.model.ClientCatalogFacts;
import com.santotofood.domain.model.CatalogCategory;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** Read-only catalog facts for one client. Every lookup is scoped to its institution. */
public interface ClientCatalogQueryPort {
  Optional<ClientCatalogFacts> findClient(UUID authenticatedUserId);

  /** Active cafeterias of active sites of the institution, with today's open state. */
  List<CafeteriaRow> findActiveCafeterias(UUID institutionId, LocalDate businessDate);

  Optional<UUID> findActiveOrder(UUID clientId);

  /** Empty when the cafeteria does not exist or belongs to another institution. */
  Optional<MenuCafeteria> findCafeteria(
      UUID institutionId, UUID cafeteriaId, LocalDate businessDate);

  /** Active products of the cafeteria with today's availability. */
  List<MenuItem> findMenuItems(UUID cafeteriaId, LocalDate businessDate);

  record CafeteriaRow(
      UUID siteId, String siteName, UUID cafeteriaId, String cafeteriaName, boolean open) {}

  record MenuCafeteria(UUID id, String name, boolean active, boolean open) {}

  record MenuItem(
      UUID id,
      String name,
      String description,
      BigDecimal price,
      CatalogCategory category,
      boolean available) {}
}
