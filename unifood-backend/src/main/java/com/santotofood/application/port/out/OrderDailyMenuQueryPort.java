package com.santotofood.application.port.out;

import com.santotofood.application.model.OrderDailyMenu;
import java.util.Collection;
import java.util.Map;
import java.util.UUID;

/** Daily menu copies of several orders in one read; orders without one are absent. */
public interface OrderDailyMenuQueryPort {
  Map<UUID, OrderDailyMenu> findDailyMenus(Collection<UUID> orderIds);
}
