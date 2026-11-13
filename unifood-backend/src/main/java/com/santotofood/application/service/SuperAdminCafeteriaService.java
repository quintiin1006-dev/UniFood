package com.santotofood.application.service;

import com.santotofood.application.exception.SuperAdminForbiddenException;
import com.santotofood.application.model.CafeteriaBilling;
import com.santotofood.application.model.SuperAdminCafeteriaRow;
import com.santotofood.application.model.SuperAdminInstitution;
import com.santotofood.application.port.in.ListSuperAdminCafeteriasUseCase;
import com.santotofood.application.port.out.SuperAdminCafeteriaQueryPort;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SuperAdminCafeteriaService implements ListSuperAdminCafeteriasUseCase {
  private final OrderAuthorizationService authorization;
  private final SuperAdminCafeteriaQueryPort cafeterias;

  public SuperAdminCafeteriaService(
      OrderAuthorizationService authorization, SuperAdminCafeteriaQueryPort cafeterias) {
    this.authorization = authorization;
    this.cafeterias = cafeterias;
  }

  @Override
  @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ, timeout = 15)
  public List<SuperAdminInstitution> listCafeterias(UUID authenticatedUserId) {
    Objects.requireNonNull(authenticatedUserId);
    // The guard already ran; repeating it here keeps the decision and the tree in one snapshot.
    if (!authorization.superAdmin(authenticatedUserId)) throw new SuperAdminForbiddenException();
    return tree(cafeterias.findCafeteriaTree());
  }

  static List<SuperAdminInstitution> tree(List<SuperAdminCafeteriaRow> rows) {
    Map<UUID, InstitutionBuilder> institutions = new LinkedHashMap<>();
    for (var row : rows) {
      var institution =
          institutions.computeIfAbsent(
              row.institutionId(),
              id -> new InstitutionBuilder(id, row.institutionName(), row.institutionActive()));
      if (row.siteId() == null) continue;
      var site =
          institution.sites.computeIfAbsent(
              row.siteId(),
              id ->
                  new SiteBuilder(
                      id,
                      row.siteName(),
                      row.siteCity(),
                      Objects.requireNonNull(row.siteActive(), "Site without state")));
      if (row.cafeteriaId() == null) continue;
      site.cafeterias.add(
          new SuperAdminInstitution.Cafeteria(
              row.cafeteriaId(),
              row.cafeteriaName(),
              Objects.requireNonNull(row.cafeteriaVisible(), "Cafeteria without state"),
              row.cafeteriaHasActiveAdmin(),
              CafeteriaBilling.stored(
                  Objects.requireNonNull(row.billingModel(), "Cafeteria without billing"),
                  row.perOrderFeeCop(),
                  row.subscriptionFeeCop()),
              Objects.requireNonNull(row.billingVersion(), "Cafeteria without billing")));
    }
    return institutions.values().stream().map(InstitutionBuilder::build).toList();
  }

  private record InstitutionBuilder(
      UUID id, String name, boolean active, Map<UUID, SiteBuilder> sites) {
    InstitutionBuilder(UUID id, String name, boolean active) {
      this(id, name, active, new LinkedHashMap<>());
    }

    SuperAdminInstitution build() {
      return new SuperAdminInstitution(
          id, name, active, sites.values().stream().map(SiteBuilder::build).toList());
    }
  }

  private record SiteBuilder(
      UUID id,
      String name,
      String city,
      boolean active,
      List<SuperAdminInstitution.Cafeteria> cafeterias) {
    SiteBuilder(UUID id, String name, String city, boolean active) {
      this(id, name, city, active, new ArrayList<>());
    }

    SuperAdminInstitution.Site build() {
      return new SuperAdminInstitution.Site(id, name, city, active, cafeterias);
    }
  }
}
