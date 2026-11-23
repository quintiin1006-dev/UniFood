package com.santotofood.application.port.in;

import com.santotofood.application.model.OrderNotice;
import java.util.List;
import java.util.UUID;

public interface GetOrderNoticesUseCase {
  List<OrderNotice> recentNotices(UUID authenticatedUserId);
}
