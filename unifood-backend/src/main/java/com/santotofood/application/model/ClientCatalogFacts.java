package com.santotofood.application.model;

import java.util.UUID;

/** The authenticated client's own facts, read from the database, never from the token. */
public record ClientCatalogFacts(
    UUID clientId,
    String fullName,
    String clientType,
    UUID institutionId,
    String institutionName) {}
