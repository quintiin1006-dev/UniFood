package com.santotofood.application.port.out;

import com.santotofood.application.model.AdminProfileDetails;
import java.util.Optional;
import java.util.UUID;

public interface AdminProfileQueryPort {
  Optional<AdminProfileDetails> findByUserAndCafeteria(UUID userId, UUID authorizedCafeteriaId);
}
