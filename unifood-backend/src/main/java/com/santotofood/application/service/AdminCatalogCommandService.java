package com.santotofood.application.service;

import static com.santotofood.application.exception.AdminCatalogCommandException.Reason.*;

import com.santotofood.application.exception.AdminCatalogCommandException;
import com.santotofood.application.exception.AdminCatalogForbiddenException;
import com.santotofood.application.model.AdminCatalogProduct;
import com.santotofood.application.model.CatalogForm;
import com.santotofood.application.port.in.ManageAdminCatalogUseCase;
import com.santotofood.application.port.out.AdminCatalogCommandPort;
import com.santotofood.application.port.out.AuthorizationQueryPort;
import com.santotofood.domain.model.BusinessDate;
import com.santotofood.domain.port.out.TimeProvider;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional(isolation = Isolation.READ_COMMITTED, timeout = 15)
public class AdminCatalogCommandService implements ManageAdminCatalogUseCase {
  private final AuthorizationQueryPort authorization;
  private final AdminCatalogCommandPort catalog;
  private final TimeProvider time;

  public AdminCatalogCommandService(
      AuthorizationQueryPort authorization, AdminCatalogCommandPort catalog, TimeProvider time) {
    this.authorization = authorization;
    this.catalog = catalog;
    this.time = time;
  }

  private UUID authorize(UUID subject) {
    // Provisioning takes UPDATE on this guard BEFORE its user/cafeteria locks.
    // Shared locks admit independent catalog writers but serialize revocations.
    catalog.lockAuthorizationGuard();
    var facts =
        authorization
            .findUserAuthorization(subject)
            .filter(
                u ->
                    u.active() && u.roles().equals(Set.of("ADMIN")) && u.cafeteriaIds().size() == 1)
            .orElseThrow(AdminCatalogForbiddenException::new);
    UUID cafeteria = facts.cafeteriaIds().getFirst();
    if (!catalog.lockActiveCafeteria(cafeteria))
      throw new AdminCatalogCommandException(CAFETERIA_INACTIVE);
    return cafeteria;
  }

  private AdminCatalogProduct current(UUID cafe, UUID id, long version) {
    if (version < 0) throw new AdminCatalogCommandException(INVALID_REQUEST);
    var product =
        catalog
            .lockProduct(cafe, id)
            .orElseThrow(() -> new AdminCatalogCommandException(NOT_FOUND));
    if (product.version() != version) throw new AdminCatalogCommandException(STALE_VERSION);
    return product;
  }

  @Override
  public AdminCatalogProduct create(UUID subject, CatalogForm form) {
    return catalog.create(authorize(subject), form);
  }

  @Override
  public AdminCatalogProduct edit(UUID subject, UUID id, long version, CatalogForm form) {
    UUID cafe = authorize(subject);
    current(cafe, id, version);
    return catalog
        .edit(cafe, id, version, form)
        .orElseThrow(() -> new AdminCatalogCommandException(STALE_VERSION));
  }

  @Override
  public AdminCatalogProduct status(UUID subject, UUID id, long version, boolean active) {
    UUID cafe = authorize(subject);
    var previous = current(cafe, id, version);
    var result =
        catalog
            .status(cafe, id, version, active)
            .orElseThrow(() -> new AdminCatalogCommandException(STALE_VERSION));
    if (active && !previous.active()) {
      // WORKER locks cafeteria SHARE -> product SHARE -> daily row. Our UPDATE product
      // lock excludes its UPSERT until this reset commits; only a subsequent explicit
      // WORKER enable may make the reactivated item available. Past days stay intact.
      catalog.disableDailyAvailability(cafe, id, BusinessDate.from(time.now()).value());
    }
    return result;
  }
}
