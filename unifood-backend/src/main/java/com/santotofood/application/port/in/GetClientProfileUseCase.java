package com.santotofood.application.port.in;

import com.santotofood.application.model.ClientProfileDetails;
import java.util.UUID;

public interface GetClientProfileUseCase {
  ClientProfileDetails getClientProfile(UUID authenticatedUserId);
}
