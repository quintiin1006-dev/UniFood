package com.santotofood.adapter.out.persistence;

import com.santotofood.adapter.out.persistence.entity.InstitutionEntity;
import com.santotofood.adapter.out.persistence.mapper.InstitutionMapper;
import com.santotofood.adapter.out.persistence.repository.SpringDataInstitutionRepository;
import com.santotofood.domain.model.Institution;
import com.santotofood.domain.port.out.InstitutionRepository;

import java.util.Optional;
import java.util.UUID;

import org.springframework.stereotype.Component;

@Component
public class InstitutionPersistenceAdapter implements InstitutionRepository {

    private final SpringDataInstitutionRepository repository;

    public InstitutionPersistenceAdapter(
            SpringDataInstitutionRepository repository
    ) {
        this.repository = repository;
    }

    @Override
    public Optional<Institution> findById(UUID institutionId) {
        return repository.findById(institutionId)
                .map(InstitutionMapper::toDomain);
    }

    @Override
    public Optional<Institution> findByEmailDomain(String emailDomain) {
        return repository.findByEmailDomain(emailDomain)
                .map(InstitutionMapper::toDomain);
    }

    @Override
    public Institution save(Institution institution) {
        InstitutionEntity entity = InstitutionMapper.toEntity(institution);

        InstitutionEntity savedEntity = repository.save(entity);

        return InstitutionMapper.toDomain(savedEntity);
    }
}