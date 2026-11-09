package com.santotofood.application.port.in;

import com.santotofood.application.model.ClientContext;
import java.util.UUID;

public interface GetClientContextUseCase {
  ClientContext getClientContext(UUID authenticatedUserId);
}
