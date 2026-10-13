package com.santotofood.application.service;

import com.santotofood.application.exception.ClientProfileNotFoundException;
import com.santotofood.application.model.ClientProfileDetails;
import com.santotofood.application.port.in.GetClientProfileUseCase;
import com.santotofood.application.port.out.ClientProfileQueryPort;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ClientProfileService implements GetClientProfileUseCase {
  private final ClientProfileQueryPort profiles;

  public ClientProfileService(ClientProfileQueryPort profiles) {
    this.profiles = profiles;
  }

  @Override
  @Transactional(readOnly = true)
  public ClientProfileDetails getClientProfile(UUID authenticatedUserId) {
    return profiles
        .findByUserId(authenticatedUserId)
        .orElseThrow(ClientProfileNotFoundException::new);
  }
}
