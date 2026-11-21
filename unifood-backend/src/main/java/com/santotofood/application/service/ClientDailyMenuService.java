package com.santotofood.application.service;

import com.santotofood.application.exception.ClientCatalogException;
import com.santotofood.application.exception.ClientProfileNotFoundException;
import com.santotofood.application.exception.DailyMenuException;
import com.santotofood.application.model.ClientDailyMenu;
import com.santotofood.application.model.ClientMenu;
import com.santotofood.application.port.in.GetClientDailyMenuUseCase;
import com.santotofood.application.port.out.ClientCatalogQueryPort;
import com.santotofood.application.port.out.DailyMenuFlag;
import com.santotofood.domain.model.BusinessDate;
import com.santotofood.domain.port.out.DailyMenuReadRepository;
import com.santotofood.domain.port.out.DailyMenuReadRepository.Kind;
import com.santotofood.domain.port.out.TimeProvider;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Client read of today's daily menu (docs/propuesta-menu-dinamico.md, section 3.2). Checks run in
 * this order: flag, cafeteria visibility (the same rules as the catalog), then the menu.
 */
@Service
public class ClientDailyMenuService implements GetClientDailyMenuUseCase {
  private final DailyMenuFlag flag;
  private final ClientCatalogQueryPort catalog;
  private final DailyMenuReadRepository menus;
  private final TimeProvider clock;

  public ClientDailyMenuService(
      DailyMenuFlag flag,
      ClientCatalogQueryPort catalog,
      DailyMenuReadRepository menus,
      TimeProvider clock) {
    this.flag = flag;
    this.catalog = catalog;
    this.menus = menus;
    this.clock = clock;
  }

  @Override
  @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ, timeout = 15)
  public ClientDailyMenu getClientDailyMenu(UUID authenticatedUserId, UUID cafeteriaId) {
    if (!flag.enabled()) throw DailyMenuException.disabled();
    var client =
        catalog.findClient(authenticatedUserId).orElseThrow(ClientProfileNotFoundException::new);
    var date = BusinessDate.from(clock.now()).value();
    // Same visibility as GET /api/me/menu: missing or foreign is 404, inactive is 403.
    var cafeteria =
        catalog
            .findCafeteria(client.institutionId(), cafeteriaId, date)
            .orElseThrow(ClientCatalogException::cafeteriaNotFound);
    if (!cafeteria.active()) throw ClientCatalogException.cafeteriaNotSubscribed();

    var servable =
        DailyMenuRules.servable(menus, cafeteria.id(), date)
            .orElseThrow(DailyMenuException::notPublished);
    var categories = new ArrayList<ClientDailyMenu.Category>();
    for (var category : servable.categories()) {
      if (category.kind() == Kind.SINGLE) {
        var options =
            servable.options().stream()
                .filter(option -> option.categoryId().equals(category.id()))
                .map(option -> new ClientDailyMenu.Option(option.id(), option.label()))
                .toList();
        categories.add(
            new ClientDailyMenu.Category(
                category.id(), category.label(), "SINGLE", category.canSkip(), options, null));
        continue;
      }
      // At most one ADDITIONS category per cafeteria (031); without additions on, it is omitted.
      var additions =
          menus.findAvailableAdditions(cafeteria.id(), date).stream()
              .map(
                  addition ->
                      new ClientDailyMenu.Addition(
                          addition.id(), addition.name(), addition.extraPrice()))
              .toList();
      if (!additions.isEmpty())
        categories.add(
            new ClientDailyMenu.Category(
                category.id(), category.label(), "ADDITIONS", true, null, additions));
    }
    return new ClientDailyMenu(
        new ClientMenu.Cafeteria(cafeteria.id(), cafeteria.name(), cafeteria.open()),
        date,
        servable.day().title(),
        servable.day().price(),
        List.copyOf(categories));
  }
}
