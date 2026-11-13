package com.santotofood.adapter.in.web;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.santotofood.adapter.in.web.dto.OrderResponse;
import com.santotofood.adapter.in.web.mapper.OrderResponseMapper;
import com.santotofood.application.model.OperationalOrders;
import com.santotofood.application.port.in.GetOrdersByCafeteriaUseCase;
import com.santotofood.config.OrderAuthorization;
import com.santotofood.domain.model.BusinessDate;
import com.santotofood.domain.model.Order;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.Authentication;

class WorkerOrdersControllerTest {
  OrderAuthorization authorization;
  GetOrdersByCafeteriaUseCase list;
  OrderResponseMapper mapper;
  WorkerOrdersController controller;
  final Authentication authentication = mock(Authentication.class);

  @BeforeEach
  void setUp() {
    authorization = mock(OrderAuthorization.class);
    list = mock(GetOrdersByCafeteriaUseCase.class);
    mapper = mock(OrderResponseMapper.class);
    controller = new WorkerOrdersController(authorization, list, mapper);
  }

  @Test
  void listsTheResolvedCafeteriaInFifoOrderWithTheBusinessDateHeaders() {
    UUID cafeteria = UUID.randomUUID();
    Order first = mock(Order.class);
    Order second = mock(Order.class);
    OrderResponse firstResponse = mock(OrderResponse.class);
    OrderResponse secondResponse = mock(OrderResponse.class);
    when(authorization.workerCafeteria(authentication)).thenReturn(Optional.of(cafeteria));
    when(list.getOperationalOrders(cafeteria))
        .thenReturn(
            new OperationalOrders(
                new BusinessDate(LocalDate.of(2026, 11, 20)), List.of(first, second)));
    when(mapper.toResponse(first)).thenReturn(firstResponse);
    when(mapper.toResponse(second)).thenReturn(secondResponse);

    var response = controller.orders(authentication);

    assertEquals(200, response.getStatusCode().value());
    assertEquals(List.of(firstResponse, secondResponse), response.getBody());
    assertEquals("no-store", response.getHeaders().getFirst("Cache-Control"));
    assertEquals("2026-11-20", response.getHeaders().getFirst("X-Business-Date"));
    assertEquals("2026-11-21T05:00:00Z", response.getHeaders().getFirst("X-Next-Business-Date-At"));
    verify(authorization, times(1)).workerCafeteria(authentication);
  }

  @Test
  void anUnresolvedCafeteriaIsDeniedBeforeListing() {
    when(authorization.workerCafeteria(authentication)).thenReturn(Optional.empty());
    assertThrows(AccessDeniedException.class, () -> controller.orders(authentication));
    verifyNoInteractions(list, mapper);
  }
}
