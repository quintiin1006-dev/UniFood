package com.santotofood.adapter.out.persistence.repository;

import com.santotofood.adapter.out.persistence.entity.InstitutionEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface SpringDataInstitutionRepository
        extends JpaRepository<InstitutionEntity, UUID> {

    Optional<InstitutionEntity> findByEmailDomain(String emailDomain);
}