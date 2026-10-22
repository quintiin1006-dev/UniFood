package com.santotofood.application.port.in;

import com.santotofood.application.model.AdminProfileDetails;
import java.util.UUID;

public interface GetAdminProfileUseCase {
  AdminProfileDetails getAdminProfile(UUID authenticatedUserId);
}
