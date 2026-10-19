package com.santotofood.application.model;

import com.santotofood.application.exception.InvalidWorkerHistoryRequestException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Base64;
import java.util.HexFormat;
import java.util.UUID;

/** Position only, never authorization; SQL independently enforces cafeteria and month. */
public record WorkerHistoryCursor(Instant completedAt, UUID id) {
  public static String scope(UUID cafeteria, LocalDate month, WorkerHistoryRequest request) {
    String source =
        cafeteria
            + "|"
            + month
            + "|"
            + request.range()
            + "|"
            + request.status()
            + "|"
            + request.query()
            + "|"
            + request.limit();
    try {
      return HexFormat.of()
          .formatHex(
              MessageDigest.getInstance("SHA-256").digest(source.getBytes(StandardCharsets.UTF_8)));
    } catch (NoSuchAlgorithmException impossible) {
      throw new IllegalStateException(impossible);
    }
  }

  public String encode(String scope) {
    return Base64.getUrlEncoder()
        .withoutPadding()
        .encodeToString(
            ("1|" + scope + "|" + completedAt + "|" + id).getBytes(StandardCharsets.UTF_8));
  }

  public static WorkerHistoryCursor decode(String token, String scope, Instant start, Instant end) {
    if (token == null) return null;
    try {
      if (!token.matches("[A-Za-z0-9_-]{1,512}")) throw new IllegalArgumentException();
      String[] parts =
          new String(Base64.getUrlDecoder().decode(token), StandardCharsets.UTF_8).split("\\|", -1);
      if (parts.length != 4 || !parts[0].equals("1") || !parts[1].equals(scope))
        throw new IllegalArgumentException();
      var cursor = new WorkerHistoryCursor(Instant.parse(parts[2]), UUID.fromString(parts[3]));
      if (cursor.completedAt().isBefore(start) || !cursor.completedAt().isBefore(end))
        throw new IllegalArgumentException();
      return cursor;
    } catch (RuntimeException invalid) {
      throw new InvalidWorkerHistoryRequestException();
    }
  }
}
