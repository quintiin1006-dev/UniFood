package com.santotofood.application.port.in;

import com.santotofood.application.model.ClientOrderHistory;
import java.util.UUID;

public interface GetOwnOrderHistoryUseCase {

  /** {@code cursor} and {@code limit} arrive as typed by the caller; both are validated here. */
  ClientOrderHistory getOwnOrderHistory(UUID userId, String cursor, String limit);
}
