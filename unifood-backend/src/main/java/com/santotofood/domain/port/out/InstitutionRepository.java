package com.santotofood.domain.port.out;

import com.santotofood.domain.model.Institution;

import java.util.Optional;
import java.util.UUID;

public interface InstitutionRepository {

    Optional<Institution> findById(UUID institutionId);

    Optional<Institution> findByEmailDomain(String emailDomain);

    Institution save(Institution institution);
}