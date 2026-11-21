package com.santotofood.config;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.santotofood.adapter.in.web.ClientDailyMenuController;
import com.santotofood.adapter.in.web.error.ClientCatalogExceptionHandler;
import com.santotofood.adapter.in.web.error.GlobalExceptionHandler;
import com.santotofood.application.exception.ClientCatalogException;
import com.santotofood.application.model.ClientDailyMenu;
import com.santotofood.application.model.ClientMenu;
import com.santotofood.application.model.UserAuthorization;
import com.santotofood.application.port.in.GetClientDailyMenuUseCase;
import com.santotofood.application.port.out.AuthorizationQueryPort;
import java.math.BigDecimal;
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
 * GET /api/me/daily-menu: real security chain, method security and error advice; roles come from a
 * stubbed output port, as in OrderRoleAuthorizationTest. The SQL runs in the PostgresTest.
 */
@SpringJUnitWebConfig(
    classes = {
      SecurityConfig.class,
      OrderAuthorization.class,
      ClientDailyMenuController.class,
      ClientCatalogExceptionHandler.class,
      GlobalExceptionHandler.class,
      DailyMenuAuthorizationTest.TestConfig.class
    })
class DailyMenuAuthorizationTest {
  @Autowired WebApplicationContext context;
  @Autowired AuthorizationQueryPort queries;
  @Autowired GetClientDailyMenuUseCase menus;
  MockMvc mvc;
  final UUID userId = UUID.randomUUID();
  final UUID cafeteriaId = UUID.randomUUID();

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
    GetClientDailyMenuUseCase menus() {
      return mock(GetClientDailyMenuUseCase.class);
    }
  }

  @BeforeEach
  void setup() {
    reset(queries, menus);
    mvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
  }

  private void roles(String... roles) {
    when(queries.findUserAuthorization(userId))
        .thenReturn(
            Optional.of(
                new UserAuthorization(
                    true,
                    Set.of(roles),
                    Set.of(roles).contains("CLIENT") ? List.of() : List.of(cafeteriaId))));
  }

  private RequestPostProcessor identity() {
    return jwt()
        .jwt(
            token ->
                token
                    .subject(userId.toString())
                    .claim("role", "CLIENT")
                    .claim("user_metadata", Map.of("role", "CLIENT")));
  }

  private org.springframework.test.web.servlet.ResultActions read() throws Exception {
    return mvc.perform(
        get("/api/me/daily-menu")
            .with(identity())
            .queryParam("cafeteriaId", cafeteriaId.toString()));
  }

  @Test
  void clientCanReadAndOnlyTheJwtSubjectReachesTheUseCase() throws Exception {
    roles("CLIENT");
    when(menus.getClientDailyMenu(userId, cafeteriaId))
        .thenReturn(
            new ClientDailyMenu(
                new ClientMenu.Cafeteria(cafeteriaId, "Cafetería Central", true),
                LocalDate.of(2026, 11, 20),
                "Almuerzo del día",
                new BigDecimal("9500.00"),
                List.of()));
    read()
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.price").value("9500.00"))
        .andExpect(jsonPath("$.title").value("Almuerzo del día"));
    verify(menus).getClientDailyMenu(userId, cafeteriaId);
  }

  @ParameterizedTest
  @ValueSource(strings = {"WORKER", "ADMIN", "SUPER_ADMIN"})
  void staffIsForbiddenEvenWithClientClaims(String role) throws Exception {
    roles(role);
    read().andExpect(status().isForbidden()).andExpect(jsonPath("$.title").doesNotExist());
    verifyNoInteractions(menus);
  }

  @Test
  void inactiveClientIsForbidden() throws Exception {
    when(queries.findUserAuthorization(userId))
        .thenReturn(Optional.of(new UserAuthorization(false, Set.of("CLIENT"), List.of())));
    read().andExpect(status().isForbidden());
    verifyNoInteractions(menus);
  }

  @Test
  void anonymousIsUnauthorized() throws Exception {
    mvc.perform(get("/api/me/daily-menu").queryParam("cafeteriaId", cafeteriaId.toString()))
        .andExpect(status().isUnauthorized());
    verifyNoInteractions(menus);
  }

  @Test
  void cafeteriaOfAnotherInstitutionIsTheCatalogsNotFound() throws Exception {
    roles("CLIENT");
    when(menus.getClientDailyMenu(any(), any()))
        .thenThrow(ClientCatalogException.cafeteriaNotFound());
    read()
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.code").value("CAFETERIA_NOT_FOUND"))
        .andExpect(jsonPath("$.message").value("No encontramos esa cafetería."));
  }
}
