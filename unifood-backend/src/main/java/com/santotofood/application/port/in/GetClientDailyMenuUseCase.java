package com.santotofood.application.port.in;

import com.santotofood.application.model.ClientDailyMenu;
import java.util.UUID;

public interface GetClientDailyMenuUseCase {
  ClientDailyMenu getClientDailyMenu(UUID authenticatedUserId, UUID cafeteriaId);
}
