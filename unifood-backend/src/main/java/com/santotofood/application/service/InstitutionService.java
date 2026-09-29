package com.santotofood.application.service;

import com.santotofood.domain.model.Institution;
import com.santotofood.domain.port.out.InstitutionRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Optional;
import java.util.UUID;

@Service
public class InstitutionService {

    private final InstitutionRepository institutionRepository;

    public InstitutionService(
            InstitutionRepository institutionRepository
    ) {
        this.institutionRepository =
                institutionRepository;
    }

    @Transactional(readOnly = true)
    public Optional<Institution> findById(
            UUID institutionId
    ) {

        return institutionRepository.findById(
                institutionId
        );
    }

    @Transactional(readOnly = true)
    public Optional<Institution> findByEmailDomain(
            String emailDomain
    ) {

        if (emailDomain == null ||
                emailDomain.isBlank()) {

            return Optional.empty();
        }

        String normalizedDomain =
                emailDomain
                        .trim()
                        .toLowerCase();

        return institutionRepository
                .findByEmailDomain(
                        normalizedDomain
                );
    }

    public Institution save(
            Institution institution
    ) {

        return institutionRepository.save(
                institution
        );
    }
}