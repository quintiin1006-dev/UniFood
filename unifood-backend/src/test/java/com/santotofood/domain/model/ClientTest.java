package com.santotofood.domain.model;

import static org.junit.jupiter.api.Assertions.*;

import com.santotofood.adapter.out.persistence.entity.ClientEntity;
import com.santotofood.adapter.out.persistence.mapper.ClientMapper;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class ClientTest {
  @Test
  void aRegisteredStudentWithoutPhoneCanBeLoadedAndSaved() {
    var entity =
        new ClientEntity(
            UUID.randomUUID(),
            UUID.randomUUID(),
            UUID.randomUUID(),
            "María Pérez",
            "123456789",
            null,
            Instant.now(),
            Instant.now());
    var mapper = new ClientMapper();
    var client = mapper.toDomain(entity);
    assertNull(client.getPhone());
    assertEquals(entity.getId(), mapper.toEntity(client).getId());
    assertNull(mapper.toEntity(client).getPhone());
  }

  @Test
  void aClientRegisteredAfter018WithoutDocumentCanBeLoadedAndSaved() {
    // The two-step registration never stores a document.
    for (String document : new String[] {null, "", "   "}) {
      var entity =
          new ClientEntity(
              UUID.randomUUID(),
              UUID.randomUUID(),
              UUID.randomUUID(),
              "Ana Torres",
              document,
              null,
              Instant.now(),
              Instant.now());
      var mapper = new ClientMapper();
      var client = mapper.toDomain(entity);
      assertNull(client.getDocument());
      assertNull(mapper.toEntity(client).getDocument());
    }
    var kept = new Client(null, UUID.randomUUID(), UUID.randomUUID(), "Ana Torres", " 123 ", null);
    assertEquals("123", kept.getDocument());
  }
}
