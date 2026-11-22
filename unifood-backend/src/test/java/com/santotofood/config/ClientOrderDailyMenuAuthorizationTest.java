package com.santotofood.config;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.santotofood.adapter.in.web.ClientOrderController;
import com.santotofood.adapter.in.web.error.ClientOrderExceptionHandler;
import com.santotofood.adapter.in.web.error.GlobalExceptionHandler;
import com.santotofood.application.exception.ClientOrderException;
import com.santotofood.application.model.ClientOrder;
import com.santotofood.application.model.OrderDailyMenu;
import com.santotofood.application.model.UserAuthorization;
import com.santotofood.application.port.in.CancelOrderUseCase;
import com.santotofood.application.port.in.CreateOwnOrderUseCase;
import com.santotofood.application.port.in.CreateOwnOrderUseCase.OrderRequest;
import com.santotofood.application.port.in.GetOwnCurrentOrderUseCase;
import com.santotofood.application.port.in.GetOwnOrderHistoryUseCase;
import com.santotofood.application.port.in.GetOwnOrderUseCase;
import com.santotofood.application.port.out.AuthorizationQueryPort;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.MediaType;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.context.junit.jupiter.web.SpringJUnitWebConfig;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;

/**
 * POST /api/me/orders with a daily menu: real security chain and error advice, roles from a stubbed
 * port. Only a CLIENT reaches the use case, with only the fields the server reads.
 */
@SpringJUnitWebConfig(
    classes = {
      SecurityConfig.class,
      OrderAuthorization.class,
      ClientOrderController.class,
      ClientOrderExceptionHandler.class,
      GlobalExceptionHandler.class,
      ClientOrderDailyMenuAuthorizationTest.TestConfig.class
    })
class ClientOrderDailyMenuAuthorizationTest {
  static final UUID CAFETERIA = UUID.randomUUID();
  static final UUID CATEGORY = UUID.randomUUID();
  static final UUID OPTION = UUID.randomUUID();
  static final UUID ADDITION = UUID.randomUUID();
  static final String KEY = "key-0123456789abcdef";
  @Autowired WebApplicationContext context;
  @Autowired AuthorizationQueryPort queries;
  @Autowired CreateOwnOrderUseCase create;
  MockMvc mvc;
  final UUID userId = UUID.randomUUID();

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
    CreateOwnOrderUseCase create() {
      return mock(CreateOwnOrderUseCase.class);
    }

    @Bean
    CancelOrderUseCase cancel() {
      return mock(CancelOrderUseCase.class);
    }

    @Bean
    GetOwnCurrentOrderUseCase current() {
      return mock(GetOwnCurrentOrderUseCase.class);
    }

    @Bean
    GetOwnOrderHistoryUseCase history() {
      return mock(GetOwnOrderHistoryUseCase.class);
    }

    @Bean
    GetOwnOrderUseCase detail() {
      return mock(GetOwnOrderUseCase.class);
    }
  }

  @BeforeEach
  void setup() {
    reset(queries, create);
    mvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
  }

  void roles(String... roles) {
    when(queries.findUserAuthorization(userId))
        .thenReturn(Optional.of(new UserAuthorization(true, Set.of(roles), List.of())));
  }

  static String body() {
    return "{\"cafeteriaId\":\""
        + CAFETERIA
        + "\",\"items\":[],\"total\":\"1.00\",\"dailyMenu\":{\"businessDate\":\"2026-11-20\","
        + "\"price\":\"1.00\",\"choices\":[{\"categoryId\":\""
        + CATEGORY
        + "\",\"optionId\":\""
        + OPTION
        + "\",\"extraPrice\":\"0.01\"}],\"additionIds\":[\""
        + ADDITION
        + "\"]}}";
  }

  ResultActions send(String body) throws Exception {
    return mvc.perform(
        post("/api/me/orders")
            .contentType(MediaType.APPLICATION_JSON)
            .header("Idempotency-Key", KEY)
            .content(body)
            .with(
                jwt()
                    .jwt(
                        token ->
                            token
                                .subject(userId.toString())
                                .claim("user_metadata", Map.of("role", "CLIENT")))));
  }

  static ClientOrder created() {
    var now = Instant.parse("2026-11-20T17:00:00Z");
    return new ClientOrder(
        UUID.randomUUID(),
        "PENDING",
        new BigDecimal("9500.00"),
        null,
        now,
        List.of(),
        new ClientOrder.Cafeteria(CAFETERIA, "Cafetería Central"),
        null,
        null,
        new ClientOrder.Timeline(now, null, 0, null, null, null, null),
        null,
        new OrderDailyMenu(
            "Almuerzo del día",
            new BigDecimal("9500.00"),
            List.of(new OrderDailyMenu.Choice("Proteína", "OPTION", "Pollo", null))));
  }

  @Test
  void aClientReachesTheUseCaseWithOnlyTheFieldsTheServerReads() throws Exception {
    roles("CLIENT");
    when(create.createOwnOrder(eq(userId), eq(KEY), any()))
        .thenReturn(new CreateOwnOrderUseCase.CreatedOrder(created(), true));
    send(body())
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.dailyMenu.price").value("9500.00"))
        .andExpect(jsonPath("$.dailyMenu.choices[0].label").value("Pollo"));
    var request = ArgumentCaptor.forClass(OrderRequest.class);
    verify(create).createOwnOrder(eq(userId), eq(KEY), request.capture());
    var menu = request.getValue().dailyMenu();
    assertEquals(LocalDate.of(2026, 11, 20), menu.businessDate());
    assertEquals(
        List.of(new CreateOwnOrderUseCase.Choice(CATEGORY, OPTION, false)), menu.choices());
    assertEquals(List.of(ADDITION), menu.additionIds());
    assertEquals(List.of(), request.getValue().items());
  }

  @ParameterizedTest
  @ValueSource(strings = {"WORKER", "ADMIN", "SUPER_ADMIN"})
  void otherRolesNeverOrderAMenuEvenWithClientClaims(String role) throws Exception {
    roles(role);
    send(body()).andExpect(status().isForbidden());
    verifyNoInteractions(create);
  }

  @Test
  void anonymousIsUnauthorized() throws Exception {
    mvc.perform(
            post("/api/me/orders")
                .contentType(MediaType.APPLICATION_JSON)
                .header("Idempotency-Key", KEY)
                .content(body()))
        .andExpect(status().isUnauthorized());
    verifyNoInteractions(create);
  }

  @Test
  void aBadlyShapedMenuReachesTheUseCaseAsAnUnreadableBody() throws Exception {
    roles("CLIENT");
    when(create.createOwnOrder(eq(userId), eq(KEY), eq(null)))
        .thenThrow(ClientOrderException.invalidRequest());
    for (String menu :
        List.of(
            "{\"businessDate\":\"20-11-2026\",\"choices\":[]}",
            "{\"businessDate\":\"2026-11-20\",\"choices\":[{\"categoryId\":\"nope\"}]}",
            "{\"businessDate\":\"2026-11-20\",\"choices\":[{\"categoryId\":\""
                + CATEGORY
                + "\",\"skip\":\"yes\"}]}",
            "[]"))
      send("{\"cafeteriaId\":\"" + CAFETERIA + "\",\"items\":[],\"dailyMenu\":" + menu + "}")
          .andExpect(status().isBadRequest())
          .andExpect(jsonPath("$.code").value("INVALID_ORDER_REQUEST"));
  }

  @Test
  void aCafeteriaOfAnotherInstitutionIsTheSameNotFound() throws Exception {
    roles("CLIENT");
    when(create.createOwnOrder(eq(userId), eq(KEY), any()))
        .thenThrow(ClientOrderException.cafeteriaNotFound());
    send(body())
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.code").value("CAFETERIA_NOT_FOUND"));
  }
}
