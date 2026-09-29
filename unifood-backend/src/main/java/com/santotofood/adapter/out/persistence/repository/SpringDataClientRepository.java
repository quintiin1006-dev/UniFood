package com.santotofood.adapter.out.persistence.repository;

import com.santotofood.adapter.out.persistence.entity.ClientEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface SpringDataClientRepository
        extends JpaRepository<ClientEntity, UUID> {

    Optional<ClientEntity> findByUserId(UUID userId);

    Optional<ClientEntity> findByDocument(String document);

    List<ClientEntity> findByInstitutionId(UUID institutionId);
}