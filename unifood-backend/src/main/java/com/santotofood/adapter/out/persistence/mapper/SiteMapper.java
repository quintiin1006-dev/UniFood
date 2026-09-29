package com.santotofood.adapter.out.persistence.mapper;

import com.santotofood.adapter.out.persistence.entity.SiteEntity;
import com.santotofood.domain.model.Site;
import org.springframework.stereotype.Component;

@Component
public class SiteMapper {

    public SiteEntity toEntity(Site site) {
        return new SiteEntity(
                site.getId(),
                site.getInstitutionId(),
                site.getName(),
                site.getCity(),
                site.isActive(),
                site.getCreatedAt()
        );
    }

    public Site toDomain(SiteEntity entity) {
        return Site.reconstitute(
                entity.getId(),
                entity.getInstitutionId(),
                entity.getName(),
                entity.getCity(),
                entity.isActive(),
                entity.getCreatedAt()
        );
    }
}