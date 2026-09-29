package com.santotofood.adapter.out.persistence;

import com.santotofood.adapter.out.persistence.mapper.ClientMapper;
import com.santotofood.adapter.out.persistence.repository.SpringDataClientRepository;
import com.santotofood.domain.model.Client;
import com.santotofood.domain.port.out.ClientRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Component
@RequiredArgsConstructor
public class ClientPersistenceAdapter implements ClientRepository {

    private final SpringDataClientRepository repository;
    private final ClientMapper mapper;

    @Override
    public Client save(Client client) {
        return mapper.toDomain(
                repository.save(mapper.toEntity(client))
        );
    }

    @Override
    public Optional<Client> findById(UUID clientId) {
        return repository.findById(clientId)
                .map(mapper::toDomain);
    }

    @Override
    public Optional<Client> findByUserId(UUID userId) {
        return repository.findByUserId(userId)
                .map(mapper::toDomain);
    }

    @Override
    public Optional<Client> findByDocument(String document) {
        return repository.findByDocument(document)
                .map(mapper::toDomain);
    }

    @Override
    public List<Client> findByInstitutionId(UUID institutionId) {
        return repository.findByInstitutionId(institutionId)
                .stream()
                .map(mapper::toDomain)
                .toList();
    }
}