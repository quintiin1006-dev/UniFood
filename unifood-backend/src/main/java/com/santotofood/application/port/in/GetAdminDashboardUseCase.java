package com.santotofood.application.port.in;

import com.santotofood.application.model.AdminDashboard;
import com.santotofood.application.model.AdminDashboardRequest;
import java.util.UUID;

public interface GetAdminDashboardUseCase {
  AdminDashboard getDashboard(UUID authenticatedUserId, AdminDashboardRequest request);
}
