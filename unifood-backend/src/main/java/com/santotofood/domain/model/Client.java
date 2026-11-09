package com.santotofood.domain.model;

import java.time.Instant;
import java.util.UUID;
import lombok.Getter;

@Getter
public class Client {

  private UUID id;
  private UUID userId;
  private UUID institutionId;
  private String fullName;
  private String document;
  private String phone;
  private Instant createdAt;
  private Instant updatedAt;

  public Client(
      UUID id, UUID userId, UUID institutionId, String fullName, String document, String phone) {
    if (userId == null) {
      throw new IllegalArgumentException("El usuario es obligatorio");
    }

    if (institutionId == null) {
      throw new IllegalArgumentException("La institución es obligatoria");
    }

    if (fullName == null || fullName.isBlank()) {
      throw new IllegalArgumentException("El nombre completo es obligatorio");
    }

    this.id = id;
    this.userId = userId;
    this.institutionId = institutionId;
    this.fullName = fullName;
    // Optional since 018: the two-step registration never stores a document.
    this.document = document == null || document.isBlank() ? null : document.trim();
    this.phone = phone == null || phone.isBlank() ? null : phone.trim();
    this.createdAt = Instant.now();
    this.updatedAt = Instant.now();
  }

  public static Client reconstitute(
      UUID id,
      UUID userId,
      UUID institutionId,
      String fullName,
      String document,
      String phone,
      Instant createdAt,
      Instant updatedAt) {
    Client client = new Client(id, userId, institutionId, fullName, document, phone);

    client.createdAt = createdAt;
    client.updatedAt = updatedAt;

    return client;
  }
}
