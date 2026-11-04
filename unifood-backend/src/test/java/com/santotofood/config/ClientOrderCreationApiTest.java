package com.santotofood.config;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.santotofood.adapter.in.web.ClientOrderController;
import com.santotofood.adapter.in.web.error.GlobalExceptionHandler;
import com.santotofood.adapter.in.web.mapper.OrderResponseMapper;
import com.santotofood.application.model.UserAuthorization;
import com.santotofood.application.port.in.CancelOrderUseCase;
import com.santotofood.application.port.in.CreateOwnOrderUseCase;
import com.santotofood.application.port.out.AuthorizationQueryPort;
import com.santotofood.application.service.ClientOrderCreationService;
import com.santotofood.domain.model.CatalogCategory;
import com.santotofood.domain.model.Client;
import com.santotofood.domain.model.Lunch;
import com.santotofood.domain.model.Order;
import com.santotofood.domain.model.OrderItem;
import com.santotofood.domain.port.out.ClientRepository;
import com.santotofood.domain.port.out.LunchRepository;
import com.santotofood.domain.port.out.OrderItemRepository;
import com.santotofood.domain.port.out.OrderRepository;
import com.santotofood.domain.port.out.TimeProvider;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.MediaType;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.context.junit.jupiter.web.SpringJUnitWebConfig;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;

/** POST /api/me/orders through real HTTP security, validation, policy and use case. */
@SpringJUnitWebConfig(
    classes = {
      SecurityConfig.class,
      OrderAuthorization.class,
      ClientOrderController.class,
      OrderResponseMapper.class,
      GlobalExceptionHandler.class,
      ClientOrderCreationApiTest.TestConfig.class
    })
class ClientOrderCreationApiTest {

  @Autowired WebApplicationContext context;
  @Autowired AuthorizationQueryPort queries;
  @Autowired ClientRepository clients;
  @Autowired LunchRepository lunches;
  @Autowired OrderRepository orders;
  @Autowired OrderItemRepository items;
  @Autowired TimeProvider clock;

  MockMvc mvc;

  final UUID userId = UUID.randomUUID();
  final UUID cafeteriaId = UUID.randomUUID();
  final UUID lunchId = UUID.randomUUID();
  final Instant now = Instant.parse("2026-11-03T12:00:00Z");
  final String body =
      "{\"items\":[{\"lunchId\":\"" + lunchId + "\",\"quantity\":2,\"note\":\"sin sal\"}]}";

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
    ClientRepository clients() {
      return mock(ClientRepository.class);
    }

    @Bean
    LunchRepository lunches() {
      return mock(LunchRepository.class);
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
    CancelOrderUseCase cancelOrderUseCase() {
      return mock(CancelOrderUseCase.class);
    }

    @Bean
    CreateOwnOrderUseCase createOwnOrderUseCase(
        ClientRepository clients,
        LunchRepository lunches,
        OrderRepository orders,
        OrderItemRepository items,
        TimeProvider clock) {
      return new ClientOrderCreationService(clients, lunches, orders, items, clock);
    }
  }

  @BeforeEach
  void setup() {
    reset(queries, clients, lunches, orders, items, clock);
    mvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();

    when(queries.findUserAuthorization(userId))
        .thenReturn(Optional.of(new UserAuthorization(true, Set.of("CLIENT"), List.of())));
    when(clients.findByUserId(userId))
        .thenReturn(
            Optional.of(
                Client.reconstitute(
                    UUID.randomUUID(),
                    userId,
                    UUID.randomUUID(),
                    "Ana Estudiante",
                    "1000000001",
                    null,
                    now,
                    now)));
    when(lunches.findAllByIds(any()))
        .thenReturn(
            List.of(
                Lunch.reconstitute(
                    lunchId,
                    cafeteriaId,
                    "Huevos",
                    null,
                    new BigDecimal("10000"),
                    null,
                    5,
                    true,
                    CatalogCategory.CORRIENTE)));
    when(lunches.decreaseStock(lunchId, 2)).thenReturn(true);
    when(orders.save(any(Order.class))).thenAnswer(invocation -> invocation.getArgument(0));
    when(items.save(any(OrderItem.class))).thenAnswer(invocation -> invocation.getArgument(0));
    when(clock.now()).thenReturn(now);
  }

  RequestPostProcessor identity() {
    return jwt().jwt(j -> j.subject(userId.toString()));
  }

  @Test
  void clientCreatesPendingOrderWithServerSidePrice() throws Exception {
    mvc.perform(
            post("/api/me/orders")
                .with(identity())
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.status").value("PENDING"))
        .andExpect(jsonPath("$.total").value(20000))
        .andExpect(jsonPath("$.items[0].unitPrice").value(10000))
        .andExpect(jsonPath("$.items[0].note").value("sin sal"));
  }

  @Test
  void emptyCartIsABadRequestAndNothingIsWritten() throws Exception {
    mvc.perform(
            post("/api/me/orders")
                .with(identity())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"items\":[]}"))
        .andExpect(status().isBadRequest());

    verify(orders, never()).save(any());
    verify(lunches, never()).decreaseStock(any(), anyInt());
  }

  @Test
  void accountWithAdditionalRoleCannotOrder() throws Exception {
    when(queries.findUserAuthorization(userId))
        .thenReturn(
            Optional.of(
                new UserAuthorization(true, Set.of("CLIENT", "WORKER"), List.of(cafeteriaId))));

    mvc.perform(
            post("/api/me/orders")
                .with(identity())
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
        .andExpect(status().isForbidden());

    verifyNoInteractions(orders, lunches);
  }

  @Test
  void inactiveClientAccountCannotOrder() throws Exception {
    when(queries.findUserAuthorization(userId))
        .thenReturn(Optional.of(new UserAuthorization(false, Set.of("CLIENT"), List.of())));

    mvc.perform(
            post("/api/me/orders")
                .with(identity())
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
        .andExpect(status().isForbidden());

    verifyNoInteractions(orders, lunches);
  }

  @Test
  void stockConflictIsReportedAsConflict() throws Exception {
    when(lunches.decreaseStock(lunchId, 2)).thenReturn(false);

    mvc.perform(
            post("/api/me/orders")
                .with(identity())
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.code").value("INSUFFICIENT_STOCK"));

    verify(orders, never()).save(any());
  }
}
