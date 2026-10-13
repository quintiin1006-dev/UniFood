package com.santotofood.application.port.out;

import com.santotofood.application.model.ClientProfileDetails;
import java.util.Optional;
import java.util.UUID;

public interface ClientProfileQueryPort {
  Optional<ClientProfileDetails> findByUserId(UUID authenticatedUserId);
}
