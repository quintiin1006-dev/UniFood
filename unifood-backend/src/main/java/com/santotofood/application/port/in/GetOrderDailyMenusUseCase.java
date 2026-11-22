package com.santotofood.application.port.in;

import com.santotofood.application.model.OrderDailyMenu;
import java.util.Collection;
import java.util.Map;
import java.util.UUID;

/** The daily menu copies of orders already authorized by the caller (§3.5). */
public interface GetOrderDailyMenusUseCase {
  Map<UUID, OrderDailyMenu> getDailyMenus(Collection<UUID> orderIds);
}
