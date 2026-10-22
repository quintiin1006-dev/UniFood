package com.santotofood.application.service;

import com.santotofood.application.exception.AdminProfileForbiddenException;
import com.santotofood.application.model.AdminProfileDetails;
import com.santotofood.application.port.in.GetAdminProfileUseCase;
import com.santotofood.application.port.out.AdminProfileQueryPort;
import com.santotofood.application.port.out.AuthorizationQueryPort;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AdminProfileService implements GetAdminProfileUseCase {
  private final AuthorizationQueryPort authorization;
  private final AdminProfileQueryPort profiles;

  public AdminProfileService(AuthorizationQueryPort authorization, AdminProfileQueryPort profiles) {
    this.authorization = authorization;
    this.profiles = profiles;
  }

  @Override
  @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ, timeout = 15)
  public AdminProfileDetails getAdminProfile(UUID authenticatedUserId) {
    Objects.requireNonNull(authenticatedUserId);
    // Identity facts are shared; ADMIN admission is independent of order policies.
    // One snapshot prevents a reassignment between authorization and the context read.
    var user =
        authorization
            .findUserAuthorization(authenticatedUserId)
            .filter(
                facts ->
                    facts.active()
                        && facts.roles().equals(Set.of("ADMIN"))
                        && facts.cafeteriaIds().size() == 1)
            .orElseThrow(AdminProfileForbiddenException::new);
    return profiles
        .findByUserAndCafeteria(authenticatedUserId, user.cafeteriaIds().getFirst())
        .orElseThrow(AdminProfileForbiddenException::new);
  }
}
