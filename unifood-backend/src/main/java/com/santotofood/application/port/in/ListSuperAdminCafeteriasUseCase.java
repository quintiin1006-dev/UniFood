package com.santotofood.application.port.in;

import com.santotofood.application.model.SuperAdminInstitution;
import java.util.List;
import java.util.UUID;

public interface ListSuperAdminCafeteriasUseCase {
  List<SuperAdminInstitution> listCafeterias(UUID authenticatedUserId);
}
