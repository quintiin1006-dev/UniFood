package com.santotofood.adapter.out.persistence.mapper;

import com.santotofood.adapter.out.persistence.entity.ClientEntity;
import com.santotofood.domain.model.Client;
import org.springframework.stereotype.Component;

@Component
public class ClientMapper {

    public ClientEntity toEntity(Client client) {
        return new ClientEntity(
                client.getId(),
                client.getUserId(),
                client.getInstitutionId(),
                client.getFullName(),
                client.getDocument(),
                client.getPhone(),
                client.getCreatedAt(),
                client.getUpdatedAt()
        );
    }

    public Client toDomain(ClientEntity entity) {
        return Client.reconstitute(
                entity.getId(),
                entity.getUserId(),
                entity.getInstitutionId(),
                entity.getFullName(),
                entity.getDocument(),
                entity.getPhone(),
                entity.getCreatedAt(),
                entity.getUpdatedAt()
        );
    }
}