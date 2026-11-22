package com.santotofood.adapter.in.web;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.santotofood.adapter.in.web.mapper.OrderResponseMapper;
import com.santotofood.adapter.in.web.mapper.OrderResponseMapperTest;
import com.santotofood.application.model.OperationalOrders;
import com.santotofood.application.model.OrderDailyMenu;
import com.santotofood.application.port.in.GetOrderDailyMenusUseCase;
import com.santotofood.application.port.in.GetOrdersByCafeteriaUseCase;
import com.santotofood.config.OrderAuthorization;
import com.santotofood.domain.model.BusinessDate;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.security.core.Authentication;

/** The worker listing carries each order's daily menu copy, read once (§3.5). */
class WorkerOrdersDailyMenuTest {
  @Test
  void onlyOrdersWithAMenuCarryItAndTheListingReadsThemOnce() {
    var authorization = mock(OrderAuthorization.class);
    var list = mock(GetOrdersByCafeteriaUseCase.class);
    var menus = mock(GetOrderDailyMenusUseCase.class);
    var authentication = mock(Authentication.class);
    var cafeteria = UUID.randomUUID();
    var withMenu = OrderResponseMapperTest.order(null);
    var withoutMenu = OrderResponseMapperTest.order("Sin cebolla");
    var plate =
        new OrderDailyMenu(
            "Almuerzo del día",
            new BigDecimal("9500.00"),
            List.of(
                new OrderDailyMenu.Choice("Proteína", "OPTION", "Pollo", null),
                new OrderDailyMenu.Choice("Bebida", "NONE", null, null),
                new OrderDailyMenu.Choice(
                    "Adiciones", "ADDITION", "Huevo frito", new BigDecimal("2000.00"))));
    when(authorization.workerCafeteria(authentication)).thenReturn(Optional.of(cafeteria));
    when(list.getOperationalOrders(cafeteria))
        .thenReturn(
            new OperationalOrders(
                new BusinessDate(LocalDate.of(2026, 11, 20)), List.of(withMenu, withoutMenu)));
    when(menus.getDailyMenus(List.of(withMenu.getId(), withoutMenu.getId())))
        .thenReturn(Map.of(withMenu.getId(), plate));
    var controller =
        new WorkerOrdersController(
            authorization, list, new OrderResponseMapper(), Optional.of(menus));

    var body = controller.orders(authentication).getBody();

    assertEquals(plate, body.get(0).dailyMenu());
    assertNull(body.get(1).dailyMenu());
    verify(menus, times(1)).getDailyMenus(any());
  }

  private static <T> T any() {
    return org.mockito.ArgumentMatchers.any();
  }
}
