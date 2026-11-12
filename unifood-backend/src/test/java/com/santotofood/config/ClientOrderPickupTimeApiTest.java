package com.santotofood.config;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.santotofood.adapter.in.web.ClientOrderController;
import com.santotofood.adapter.in.web.error.ClientOrderExceptionHandler;
import com.santotofood.adapter.in.web.error.GlobalExceptionHandler;
import com.santotofood.adapter.in.web.mapper.OrderResponseMapper;
import com.santotofood.application.model.ClientOrder;
import com.santotofood.application.model.UserAuthorization;
import com.santotofood.application.port.in.CancelOrderUseCase;
import com.santotofood.application.port.in.GetOwnCurrentOrderUseCase;
import com.santotofood.application.port.in.GetOwnOrderHistoryUseCase;
import com.santotofood.application.port.in.GetOwnOrderUseCase;
import com.santotofood.application.port.out.AuthorizationQueryPort;
import com.santotofood.application.port.out.ClientOrderCommandPort;
import com.santotofood.application.port.out.ClientOrderCommandPort.LockedCafeteria;
import com.santotofood.application.port.out.ClientOrderCommandPort.LockedProduct;
import com.santotofood.application.port.out.ClientOrderCommandPort.NewOrder;
import com.santotofood.application.port.out.ClientOrderCommandPort.OrderingClient;
import com.santotofood.application.service.ClientOrderCreationService;
import com.santotofood.domain.port.out.TimeProvider;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.context.junit.jupiter.web.SpringJUnitWebConfig;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;
import org.springframework.web.context.WebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;

/**
 * POST /api/me/orders with {@code requestedPickupAt}: real HTTP security, body decoding, use case
 * and error handler; the database facts are stubbed at the command port. JDBC and the 023 column
 * are covered by {@link ClientOrderCreationApiPostgresTest}.
 */
@SpringJUnitWebConfig(
    classes = {
      SecurityConfig.class,
      OrderAuthorization.class,
      ClientOrderController.class,
      OrderResponseMapper.class,
      ClientOrderExceptionHandler.class,
      GlobalExceptionHandler.class,
      ClientOrderPickupTimeApiTest.TestConfig.class
    })
class ClientOrderPickupTimeApiTest {
  // 2026-11-20 12:00 in America/Bogota.
  static final Instant NOW = Instant.parse("2026-11-20T17:00:00Z");
  static final LocalDate TODAY = LocalDate.parse("2026-11-20");
  static final UUID USER = UUID.randomUUID();
  static final UUID INSTITUTION = UUID.randomUUID();
  static final UUID CAFETERIA = UUID.randomUUID();
  static final UUID JUICE = UUID.randomUUID();
  static final String KEY = "pickup-key-0123456789";

  @Autowired WebApplicationContext context;
  @Autowired AuthorizationQueryPort queries;
  @Autowired ClientOrderCommandPort port;
  MockMvc mvc;
  final AtomicReference<NewOrder> stored = new AtomicReference<>();

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
    ClientOrderCommandPort port() {
      return mock(ClientOrderCommandPort.class);
    }

    @Bean
    ClientOrderCreationService create(ClientOrderCommandPort port) {
      var manager = mock(PlatformTransactionManager.class);
      when(manager.getTransaction(any())).thenAnswer(call -> new SimpleTransactionStatus());
      TimeProvider clock = () -> NOW;
      return new ClientOrderCreationService(port, clock, manager);
    }

    @Bean
    CancelOrderUseCase cancel() {
      return mock(CancelOrderUseCase.class);
    }

    @Bean
    GetOwnOrderUseCase detail() {
      return mock(GetOwnOrderUseCase.class);
    }

    @Bean
    GetOwnCurrentOrderUseCase current() {
      return mock(GetOwnCurrentOrderUseCase.class);
    }

    @Bean
    GetOwnOrderHistoryUseCase history() {
      return mock(GetOwnOrderHistoryUseCase.class);
    }
  }

  @BeforeEach
  void setUp() {
    reset(queries, port);
    stored.set(null);
    mvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    when(queries.findUserAuthorization(USER))
        .thenReturn(Optional.of(new UserAuthorization(true, Set.of("CLIENT"), List.of())));
    when(port.findOrderingClient(USER))
        .thenReturn(
            Optional.of(
                new OrderingClient(UUID.randomUUID(), "Ana", INSTITUTION, "STUDENT", "1234567")));
    when(port.findByIdempotencyKey(any(), any())).thenReturn(Optional.empty());
    when(port.findActiveOrder(any())).thenReturn(Optional.empty());
    when(port.lockCafeteria(INSTITUTION, CAFETERIA))
        .thenReturn(Optional.of(new LockedCafeteria(CAFETERIA, true)));
    when(port.lockOpenToday(CAFETERIA, TODAY)).thenReturn(true);
    when(port.lockProducts(eq(CAFETERIA), anyList()))
        .thenReturn(List.of(new LockedProduct(JUICE, "Jugo", new BigDecimal("4500.00"), true)));
    when(port.lockAvailableToday(eq(CAFETERIA), anyList(), eq(TODAY))).thenReturn(Set.of(JUICE));
    doAnswer(
            call -> {
              stored.set(call.getArgument(0));
              return null;
            })
        .when(port)
        .insertOrder(any());
    // The stored order reads back what was inserted.
    when(port.findOrder(any()))
        .thenAnswer(
            call ->
                Optional.of(
                    new ClientOrder(
                        call.getArgument(0),
                        "PENDING",
                        new BigDecimal("4500.00"),
                        null,
                        NOW,
                        List.of(
                            new ClientOrder.Item(
                                "Jugo", 1, new BigDecimal("4500.00"), new BigDecimal("4500.00"))),
                        new ClientOrder.Cafeteria(CAFETERIA, "Cafetería Central"),
                        null,
                        null,
                        new ClientOrder.Timeline(NOW, null, 0, null, null, null, null),
                        stored.get() == null ? null : stored.get().requestedPickupAt())));
  }

  ResultActions create(String pickupJson) throws Exception {
    var pickup = pickupJson == null ? "" : ",\"requestedPickupAt\":" + pickupJson;
    return mvc.perform(
        post("/api/me/orders")
            .with(jwt().jwt(j -> j.subject(USER.toString())))
            .header("Idempotency-Key", KEY)
            .contentType("application/json")
            .content(
                "{\"cafeteriaId\":\""
                    + CAFETERIA
                    + "\",\"items\":[{\"productId\":\""
                    + JUICE
                    + "\",\"quantity\":1}]"
                    + pickup
                    + "}"));
  }

  @Test
  void withoutPickupTimeTheOrderIsCreatedAndExposesNull() throws Exception {
    create(null)
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.requestedPickupAt").value(org.hamcrest.Matchers.nullValue()));
    create("null").andExpect(status().isCreated());
  }

  @Test
  void aValidPickupTimeIsCreatedAndReturnedAsAnInstant() throws Exception {
    create("\"2026-11-20T13:30:00-05:00\"")
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.requestedPickupAt").value("2026-11-20T18:30:00Z"));
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "\"2026-11-20T11:00:00-05:00\"",
        "\"2026-11-21T09:00:00-05:00\"",
        "\"2026-11-20T13:30:00\"",
        "\"13:30\"",
        "\"\""
      })
  void anInvalidPickupTimeIsA400WithItsOwnCode(String pickup) throws Exception {
    create(pickup)
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("INVALID_PICKUP_TIME"))
        .andExpect(
            jsonPath("$.message").value("La hora de recogida debe ser más tarde el día de hoy."))
        .andExpect(jsonPath("$.path").value("/api/me/orders"));
    verify(port, never()).insertOrder(any());
  }

  @ParameterizedTest
  @ValueSource(strings = {"1763659800", "true", "{}", "[\"2026-11-20T13:30:00-05:00\"]"})
  void aPickupTimeThatIsNotAStringIsAMalformedRequest(String pickup) throws Exception {
    create(pickup)
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("INVALID_ORDER_REQUEST"));
    verify(port, never()).insertOrder(any());
  }
}
