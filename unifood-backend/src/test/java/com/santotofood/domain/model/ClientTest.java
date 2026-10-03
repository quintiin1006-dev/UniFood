package com.santotofood.domain.model;

import com.santotofood.adapter.out.persistence.entity.ClientEntity;
import com.santotofood.adapter.out.persistence.mapper.ClientMapper;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class ClientTest {
    @Test
    void aRegisteredStudentWithoutPhoneCanBeLoadedAndSaved() {
        var entity = new ClientEntity(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
            "María Pérez", "123456789", null, Instant.now(), Instant.now());
        var mapper = new ClientMapper();
        var client = mapper.toDomain(entity);
        assertNull(client.getPhone());
        assertEquals(entity.getId(), mapper.toEntity(client).getId());
        assertNull(mapper.toEntity(client).getPhone());
    }
}
