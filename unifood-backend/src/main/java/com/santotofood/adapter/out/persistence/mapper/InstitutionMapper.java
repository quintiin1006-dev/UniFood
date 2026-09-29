package com.santotofood.adapter.out.persistence.mapper;

import com.santotofood.adapter.out.persistence.entity.InstitutionEntity;
import com.santotofood.domain.model.Institution;

public final class InstitutionMapper {

    private InstitutionMapper() {
    }

    public static Institution toDomain(InstitutionEntity entity) {
        if (entity == null) {
            return null;
        }

        return new Institution(
                entity.getId(),
                entity.getName(),
                entity.getEmailDomain(),
                entity.getBrandName(),
                entity.isActive(),
                entity.getCreatedAt(),
                entity.getUpdatedAt()
        );
    }

    public static InstitutionEntity toEntity(Institution domain) {
        if (domain == null) {
            return null;
        }

        InstitutionEntity entity = new InstitutionEntity();

        entity.setId(domain.getId());
        entity.setName(domain.getName());
        entity.setEmailDomain(domain.getEmailDomain());
        entity.setBrandName(domain.getBrandName());
        entity.setActive(domain.isActive());
        entity.setCreatedAt(domain.getCreatedAt());
        entity.setUpdatedAt(domain.getUpdatedAt());

        return entity;
    }
}