package com.santotofood.application.service;

import com.santotofood.application.exception.ClientCatalogException;
import com.santotofood.application.exception.ClientProfileNotFoundException;
import com.santotofood.application.model.ClientCatalogFacts;
import com.santotofood.application.model.ClientContext;
import com.santotofood.application.model.ClientMenu;
import com.santotofood.application.port.in.GetClientContextUseCase;
import com.santotofood.application.port.in.GetClientMenuUseCase;
import com.santotofood.application.port.out.ClientCatalogQueryPort;
import com.santotofood.application.port.out.ClientCatalogQueryPort.CafeteriaRow;
import com.santotofood.domain.model.BusinessDate;
import com.santotofood.domain.model.CatalogCategory;
import com.santotofood.domain.port.out.TimeProvider;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

/** Client context and menu (docs/decisiones.md §5, §6 and §11), scoped to the institution. */
@Service
public class ClientCatalogService implements GetClientContextUseCase, GetClientMenuUseCase {
  /** Home filters order in §6: Del día, Desayunos, Corriente, Ejecutivo, Especial, Bebidas. */
  static final List<CatalogCategory> CATEGORY_ORDER =
      List.of(
          CatalogCategory.DEL_DIA,
          CatalogCategory.DESAYUNO,
          CatalogCategory.CORRIENTE,
          CatalogCategory.EJECUTIVO,
          CatalogCategory.ESPECIAL,
          CatalogCategory.BEBIDA);

  private final ClientCatalogQueryPort catalog;
  private final TimeProvider clock;

  public ClientCatalogService(ClientCatalogQueryPort catalog, TimeProvider clock) {
    this.catalog = catalog;
    this.clock = clock;
  }

  @Override
  @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ, timeout = 15)
  public ClientContext getClientContext(UUID authenticatedUserId) {
    ClientCatalogFacts client = client(authenticatedUserId);
    var date = BusinessDate.from(clock.now()).value();
    var sites = new LinkedHashMap<UUID, SiteBuilder>();
    for (CafeteriaRow row : catalog.findActiveCafeterias(client.institutionId(), date))
      sites
          .computeIfAbsent(row.siteId(), id -> new SiteBuilder(id, row.siteName()))
          .cafeterias
          .add(new ClientContext.Cafeteria(row.cafeteriaId(), row.cafeteriaName(), row.open()));
    return new ClientContext(
        client.fullName(),
        client.clientType(),
        new ClientContext.Institution(client.institutionId(), client.institutionName()),
        sites.values().stream()
            .map(site -> new ClientContext.Site(site.id, site.name, List.copyOf(site.cafeterias)))
            .toList(),
        catalog.findActiveOrder(client.clientId()).orElse(null));
  }

  @Override
  @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ, timeout = 15)
  public ClientMenu getClientMenu(UUID authenticatedUserId, UUID cafeteriaId) {
    ClientCatalogFacts client = client(authenticatedUserId);
    var date = BusinessDate.from(clock.now()).value();
    // Missing and foreign cafeterias are the same 404: existence is never revealed.
    var cafeteria =
        catalog
            .findCafeteria(client.institutionId(), cafeteriaId, date)
            .orElseThrow(ClientCatalogException::cafeteriaNotFound);
    if (!cafeteria.active()) throw ClientCatalogException.cafeteriaNotSubscribed();

    var byCategory = new LinkedHashMap<CatalogCategory, List<ClientMenu.Product>>();
    CATEGORY_ORDER.forEach(category -> byCategory.put(category, new ArrayList<>()));
    for (var item : catalog.findMenuItems(cafeteria.id(), date)) {
      var products = byCategory.get(item.category());
      if (products == null) continue;
      // Closed today: still listed, never orderable.
      products.add(
          new ClientMenu.Product(
              item.id(),
              item.name(),
              item.description(),
              item.price(),
              cafeteria.open() && item.available()));
    }
    var categories =
        byCategory.entrySet().stream()
            .filter(entry -> !entry.getValue().isEmpty())
            .map(
                entry ->
                    new ClientMenu.Category(entry.getKey().name(), List.copyOf(entry.getValue())))
            .toList();
    return new ClientMenu(
        new ClientMenu.Cafeteria(cafeteria.id(), cafeteria.name(), cafeteria.open()),
        date,
        categories);
  }

  private ClientCatalogFacts client(UUID authenticatedUserId) {
    return catalog.findClient(authenticatedUserId).orElseThrow(ClientProfileNotFoundException::new);
  }

  private static final class SiteBuilder {
    final UUID id;
    final String name;
    final List<ClientContext.Cafeteria> cafeterias = new ArrayList<>();

    SiteBuilder(UUID id, String name) {
      this.id = id;
      this.name = name;
    }
  }
}
