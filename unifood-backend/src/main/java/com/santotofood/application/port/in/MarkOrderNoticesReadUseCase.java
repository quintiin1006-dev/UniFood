package com.santotofood.application.port.in;

import java.util.UUID;

public interface MarkOrderNoticesReadUseCase {
  /** Idempotent: a second call changes nothing and still succeeds. */
  void markNoticesRead(UUID authenticatedUserId);
}
