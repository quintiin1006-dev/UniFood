package com.santotofood.config;

import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.santotofood.adapter.in.web.ClientOrderController;
import com.santotofood.adapter.in.web.error.GlobalExceptionHandler;
import com.santotofood.adapter.in.web.mapper.OrderResponseMapper;
import com.santotofood.application.model.*;
import com.santotofood.application.port.in.CancelOrderUseCase;
import com.santotofood.application.port.out.AuthorizationQueryPort;
import com.santotofood.application.service.OrderService;
import com.santotofood.domain.model.*;
import com.santotofood.domain.port.out.*;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.context.junit.jupiter.web.SpringJUnitWebConfig;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;

/**
 * Real policy, HTTP security, use case and domain; current DB reads are stubbed at output ports.
 */
@SpringJUnitWebConfig(
    classes = {
      SecurityConfig.class,
      OrderAuthorization.class,
      ClientOrderController.class,
      OrderResponseMapper.class,
      GlobalExceptionHandler.class,
      ClientOrderCancellationApiTest.TestConfig.class
    })
class ClientOrderCancellationApiTest {
  @Autowired WebApplicationContext context;
  @Autowired AuthorizationQueryPort queries;
  @Autowired OrderRepository orders;
  @Autowired OrderItemRepository items;
  @Autowired TimeProvider clock;
  MockMvc mvc;
  final UUID userId = UUID.randomUUID();
  final UUID orderId = UUID.randomUUID();
  final String path = "/api/me/orders/" + orderId + "/cancel";

  @Configuration
  @EnableWebMvc
  static class TestConfig {
    @Bean
    AuthorizationQueryPort authorizationQueryPort() {
      return mock(AuthorizationQueryPort.class);
    }

    @Bean
    JwtDecoder jwtDecoder() {
      return mock(JwtDecoder.class);
    }

    @Bean
    OrderRepository orders() {
      return mock(OrderRepository.class);
    }

    @Bean
    OrderItemRepository items() {
      return mock(OrderItemRepository.class);
    }

    @Bean
    TimeProvider clock() {
      return mock(TimeProvider.class);
    }

    @Bean
    CancelOrderUseCase cancel(
        OrderRepository orders, OrderItemRepository items, TimeProvider clock) {
      return new OrderService(orders, items, clock);
    }
  }

  @BeforeEach
  void setup() {
    reset(queries, orders, items, clock);
    mvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    when(queries.findUserAuthorization(userId))
        .thenReturn(Optional.of(new UserAuthorization(true, Set.of("CLIENT"), List.of())));
    when(queries.findOrderOwner(orderId)).thenReturn(Optional.of(new OrderOwner(userId)));
  }

  RequestPostProcessor identity() {
    return jwt()
        .jwt(
            j ->
                j.subject(userId.toString())
                    .claim(
                        "user_metadata",
                        Map.of("role", "SUPER_ADMIN", "clientId", UUID.randomUUID().toString())));
  }

  void storedOrder(OrderStatus status) {
    Instant created = Instant.parse("2026-01-01T00:00:00Z");
    Order order =
        Order.reconstitute(
            orderId,
            UUID.randomUUID(),
            UUID.randomUUID(),
            "Fixture",
            "12345",
            status,
            BigDecimal.ONE,
            created.plusSeconds(1),
            created,
            created);
    when(orders.findById(orderId)).thenReturn(Optional.of(order));
    when(orders.save(order)).thenReturn(order);
    when(items.findByOrderId(orderId)).thenReturn(List.of());
    when(clock.now()).thenReturn(created.plusSeconds(3600));
  }

  @Test
  void ownerGetsCancelledIgnoringBrowserIdentityAndAnExpiredLegacyDeadline() throws Exception {
    storedOrder(OrderStatus.PENDING);
    mvc.perform(
            patch(path)
                .with(identity())
                .param("userId", UUID.randomUUID().toString())
                .param("clientId", UUID.randomUUID().toString())
                .contentType("application/json")
                .content("{\"email\":\"other@example.invalid\"}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.id").value(orderId.toString()))
        .andExpect(jsonPath("$.status").value("CANCELLED"));
    verify(queries).findUserAuthorization(userId);
    verify(orders).save(any());
  }

  @Test
  void anonymousDoesNotReachPolicyOrUseCase() throws Exception {
    mvc.perform(patch(path)).andExpect(status().isUnauthorized());
    verifyNoInteractions(queries, orders, items, clock);
  }

  @Test
  void foreignOrUnlinkedOrderIsNotFoundBeforeUseCase() throws Exception {
    for (UUID owner : new UUID[] {UUID.randomUUID(), null}) {
      when(queries.findOrderOwner(orderId)).thenReturn(Optional.of(new OrderOwner(owner)));
      mvc.perform(patch(path).with(identity()))
          .andExpect(status().isNotFound())
          .andExpect(jsonPath("$.code").value("ORDER_NOT_FOUND"))
          .andExpect(jsonPath("$.status").value(404))
          .andExpect(jsonPath("$.path").value(path));
    }
    verifyNoInteractions(orders, items, clock);
  }

  @Test
  void missingOrderGetsConsistentNotFoundBeforeUseCase() throws Exception {
    when(queries.findOrderOwner(orderId)).thenReturn(Optional.empty());
    mvc.perform(patch(path).with(identity()))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.code").value("ORDER_NOT_FOUND"));
    verifyNoInteractions(orders, items, clock);
  }

  @ParameterizedTest
  @EnumSource(value = OrderStatus.class, names = "PENDING", mode = EnumSource.Mode.EXCLUDE)
  void everyNonPendingStateReturnsConflictWithoutSaving(OrderStatus status) throws Exception {
    storedOrder(status);
    mvc.perform(patch(path).with(identity()))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.code").value("INVALID_ORDER_STATE"))
        .andExpect(jsonPath("$.status").value(409));
    verify(orders, never()).save(any());
    verifyNoInteractions(items);
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "WORKER",
        "ADMIN",
        "SUPER_ADMIN",
        "CLIENT_WORKER",
        "CLIENT_ADMIN",
        "CLIENT_SUPER_ADMIN",
        "NONE",
        "INACTIVE",
        "MISSING"
      })
  void invalidAccountCannotReachUseCaseEvenWithClientMetadata(String scenario) throws Exception {
    Set<String> roles =
        switch (scenario) {
          case "CLIENT_WORKER" -> Set.of("CLIENT", "WORKER");
          case "CLIENT_ADMIN" -> Set.of("CLIENT", "ADMIN");
          case "CLIENT_SUPER_ADMIN" -> Set.of("CLIENT", "SUPER_ADMIN");
          case "INACTIVE" -> Set.of("CLIENT");
          case "NONE", "MISSING" -> Set.of();
          default -> Set.of(scenario);
        };
    when(queries.findUserAuthorization(userId))
        .thenReturn(
            scenario.equals("MISSING")
                ? Optional.empty()
                : Optional.of(
                    new UserAuthorization(!scenario.equals("INACTIVE"), roles, List.of())));
    mvc.perform(
            patch(path)
                .with(
                    jwt()
                        .jwt(
                            j ->
                                j.subject(userId.toString())
                                    .claim("user_metadata", Map.of("role", "CLIENT")))))
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.code").value("FORBIDDEN"));
    verify(queries, never()).findOrderOwner(any());
    verifyNoInteractions(orders, items, clock);
  }

  @Test
  void malformedSubjectCannotReachPolicyOrUseCase() throws Exception {
    mvc.perform(patch(path).with(jwt().jwt(j -> j.subject("invalid"))))
        .andExpect(status().isForbidden());
    verifyNoInteractions(queries, orders, items, clock);
  }

  @Test
  void revocationIsReadOnTheNextRequest() throws Exception {
    storedOrder(OrderStatus.PENDING);
    mvc.perform(patch(path).with(identity())).andExpect(status().isOk());
    clearInvocations(orders, items, clock);
    when(queries.findUserAuthorization(userId))
        .thenReturn(Optional.of(new UserAuthorization(true, Set.of(), List.of())));
    mvc.perform(patch(path).with(identity())).andExpect(status().isForbidden());
    verifyNoInteractions(orders, items, clock);
    when(queries.findUserAuthorization(userId))
        .thenReturn(Optional.of(new UserAuthorization(false, Set.of("CLIENT"), List.of())));
    mvc.perform(patch(path).with(identity())).andExpect(status().isForbidden());
    verifyNoInteractions(orders, items, clock);
  }
}
