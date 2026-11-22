package com.santotofood.application.service;

import com.santotofood.application.model.OrderDailyMenu;
import com.santotofood.application.port.in.GetOrderDailyMenusUseCase;
import com.santotofood.application.port.out.OrderDailyMenuQueryPort;
import java.util.Collection;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Reads the immutable daily menu copies (031) of orders the caller may already see. It never
 * authorizes on its own: each controller checks the orders first.
 */
@Service
public class OrderDailyMenuQueryService implements GetOrderDailyMenusUseCase {
  private final OrderDailyMenuQueryPort menus;

  public OrderDailyMenuQueryService(OrderDailyMenuQueryPort menus) {
    this.menus = menus;
  }

  @Override
  @Transactional(readOnly = true, timeout = 15)
  public Map<UUID, OrderDailyMenu> getDailyMenus(Collection<UUID> orderIds) {
    if (orderIds.isEmpty()) return Map.of();
    return menus.findDailyMenus(orderIds);
  }
}
