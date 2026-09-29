package com.santotofood.adapter.out.persistence;

import com.santotofood.adapter.out.persistence.mapper.SiteMapper;
import com.santotofood.adapter.out.persistence.repository.SpringDataSiteRepository;
import com.santotofood.domain.model.Site;
import com.santotofood.domain.port.out.SiteRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Component
@RequiredArgsConstructor
public class SitePersistenceAdapter implements SiteRepository {

    private final SpringDataSiteRepository repository;
    private final SiteMapper mapper;

    @Override
    public Site save(Site site) {
        return mapper.toDomain(
                repository.save(mapper.toEntity(site))
        );
    }

    @Override
    public Optional<Site> findById(UUID siteId) {
        return repository.findById(siteId)
                .map(mapper::toDomain);
    }

    @Override
    public List<Site> findByInstitutionId(UUID institutionId) {
        return repository.findByInstitutionId(institutionId)
                .stream()
                .map(mapper::toDomain)
                .toList();
    }

    @Override
    public List<Site> findActiveByInstitutionId(UUID institutionId) {
        return repository.findByInstitutionIdAndActiveTrue(institutionId)
                .stream()
                .map(mapper::toDomain)
                .toList();
    }
}