package com.santotofood.domain.port.out;

import com.santotofood.domain.model.Site;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface SiteRepository {

    Site save(Site site);

    Optional<Site> findById(UUID siteId);

    List<Site> findByInstitutionId(UUID institutionId);

    List<Site> findActiveByInstitutionId(UUID institutionId);
}