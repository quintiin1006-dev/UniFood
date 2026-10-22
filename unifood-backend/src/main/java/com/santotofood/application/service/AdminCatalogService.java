package com.santotofood.application.service;

import com.santotofood.application.exception.AdminCatalogForbiddenException;
import com.santotofood.application.model.AdminCatalogProduct;
import com.santotofood.application.port.in.GetAdminCatalogUseCase;
import com.santotofood.application.port.out.AdminCatalogQueryPort;
import com.santotofood.application.port.out.AuthorizationQueryPort;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AdminCatalogService implements GetAdminCatalogUseCase {
  private final AuthorizationQueryPort authorization;
  private final AdminCatalogQueryPort catalog;

  public AdminCatalogService(AuthorizationQueryPort authorization, AdminCatalogQueryPort catalog) {
    this.authorization = authorization;
    this.catalog = catalog;
  }

  @Override
  @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ, timeout = 15)
  public List<AdminCatalogProduct> getAdminCatalog(UUID authenticatedUserId) {
    Objects.requireNonNull(authenticatedUserId);
    // Same admission facts as ADMIN Profile, independent of operational order policy.
    // Authorization and catalog share a snapshot; inactive cafeterias remain readable.
    var user =
        authorization
            .findUserAuthorization(authenticatedUserId)
            .filter(
                facts ->
                    facts.active()
                        && facts.roles().equals(Set.of("ADMIN"))
                        && facts.cafeteriaIds().size() == 1)
            .orElseThrow(AdminCatalogForbiddenException::new);
    return List.copyOf(
        catalog
            .findByCafeteria(user.cafeteriaIds().getFirst())
            .orElseThrow(AdminCatalogForbiddenException::new));
  }
}
