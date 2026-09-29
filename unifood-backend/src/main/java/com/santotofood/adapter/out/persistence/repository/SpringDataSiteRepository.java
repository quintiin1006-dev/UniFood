package com.santotofood.adapter.out.persistence.repository;

import com.santotofood.adapter.out.persistence.entity.SiteEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface SpringDataSiteRepository
        extends JpaRepository<SiteEntity, UUID> {

    List<SiteEntity> findByInstitutionId(UUID institutionId);

    List<SiteEntity> findByInstitutionIdAndActiveTrue(UUID institutionId);
}