package com.santotofood.application.port.in;

import com.santotofood.application.model.ClientMenu;
import java.util.UUID;

public interface GetClientMenuUseCase {
  ClientMenu getClientMenu(UUID authenticatedUserId, UUID cafeteriaId);
}
