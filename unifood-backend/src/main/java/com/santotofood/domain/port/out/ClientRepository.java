package com.santotofood.domain.port.out;

import com.santotofood.domain.model.Client;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface ClientRepository {

    Client save(Client client);

    Optional<Client> findById(UUID clientId);

    Optional<Client> findByUserId(UUID userId);

    Optional<Client> findByDocument(String document);

    List<Client> findByInstitutionId(UUID institutionId);
}