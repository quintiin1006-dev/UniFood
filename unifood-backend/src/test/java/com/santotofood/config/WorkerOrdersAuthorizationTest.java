package com.santotofood.config;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.santotofood.adapter.in.web.WorkerOrdersController;
import com.santotofood.adapter.in.web.error.GlobalExceptionHandler;
import com.santotofood.adapter.in.web.mapper.OrderResponseMapper;
import com.santotofood.application.model.OperationalOrders;
import com.santotofood.application.model.UserAuthorization;
import com.santotofood.application.port.in.GetOrdersByCafeteriaUseCase;
import com.santotofood.application.port.out.AuthorizationQueryPort;
import com.santotofood.domain.model.BusinessDate;
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
 * {@code GET /api/worker/orders}: the cafeteria comes only from the database facts read in the same
 * request. Every ineligible account gets the same fixed 403 the old two-call flow returned.
 */
@SpringJUnitWebConfig(
    classes = {
      SecurityConfig.class,
      OrderAuthorization.class,
      WorkerOrdersController.class,
      GlobalExceptionHandler.class,
      WorkerOrdersAuthorizationTest.TestConfig.class
    })
class WorkerOrdersAuthorizationTest {
  static final String FORBIDDEN_MESSAGE = "No tienes permisos para realizar esta operación";

  @Autowired WebApplicationContext context;
  @Autowired AuthorizationQueryPort queries;
  @Autowired GetOrdersByCafeteriaUseCase list;
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
    GetOrdersByCafeteriaUseCase list() {
      return mock(GetOrdersByCafeteriaUseCase.class);
    }

    @Bean
    OrderResponseMapper mapper() {
      return mock(OrderResponseMapper.class);
    }
  }

  @BeforeEach
  void setup() {
    reset(queries, list);
    mvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    when(list.getOperationalOrders(any()))
        .thenReturn(new OperationalOrders(new BusinessDate(LocalDate.of(2026, 11, 20)), List.of()));
  }

  private RequestPostProcessor identity(String metadataRole) {
    return jwt()
        .jwt(
            j ->
                j.subject(userId.toString())
                    .claim(
                        "user_metadata",
                        Map.of("role", metadataRole, "cafeteriaId", UUID.randomUUID().toString())));
  }

  private Optional<UserAuthorization> facts(boolean active, Set<String> roles, List<UUID> cafes) {
    return Optional.of(new UserAuthorization(active, roles, cafes));
  }

  @Test
  void anAssignedActiveWorkerGetsTheListingOfItsDatabaseCafeteriaWithTheBusinessDate()
      throws Exception {
    when(queries.findUserAuthorization(userId))
        .thenReturn(facts(true, Set.of("WORKER"), List.of(cafeteriaId)));
    mvc.perform(
            get("/api/worker/orders")
                .param("cafeteriaId", UUID.randomUUID().toString())
                .with(identity("CLIENT")))
        .andExpect(status().isOk())
        .andExpect(content().json("[]"))
        .andExpect(header().string("Cache-Control", "no-store"))
        .andExpect(header().string("X-Business-Date", "2026-11-20"))
        .andExpect(header().exists("X-Next-Business-Date-At"));
    // One authorization read for the whole listing, and only the database cafeteria is used.
    verify(queries, times(1)).findUserAuthorization(userId);
    verify(list).getOperationalOrders(cafeteriaId);
    verifyNoMoreInteractions(list);
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "MISSING",
        "INACTIVE",
        "CLIENT",
        "ADMIN",
        "SUPER_ADMIN",
        "UNKNOWN",
        "WORKER_CLIENT",
        "WORKER_ADMIN",
        "WORKER_SUPER_ADMIN",
        "NO_ASSIGNMENT",
        "TWO_ASSIGNMENTS"
      })
  void everyIneligibleAccountGetsTheSameFixed403WithoutListing(String scenario) throws Exception {
    Optional<UserAuthorization> current =
        switch (scenario) {
          case "MISSING" -> Optional.empty();
          case "INACTIVE" -> facts(false, Set.of("WORKER"), List.of(cafeteriaId));
          case "WORKER_CLIENT" -> facts(true, Set.of("WORKER", "CLIENT"), List.of(cafeteriaId));
          case "WORKER_ADMIN" -> facts(true, Set.of("WORKER", "ADMIN"), List.of(cafeteriaId));
          case "WORKER_SUPER_ADMIN" ->
              facts(true, Set.of("WORKER", "SUPER_ADMIN"), List.of(cafeteriaId));
          case "NO_ASSIGNMENT" -> facts(true, Set.of("WORKER"), List.of());
          case "TWO_ASSIGNMENTS" ->
              facts(true, Set.of("WORKER"), List.of(cafeteriaId, UUID.randomUUID()));
          default -> facts(true, Set.of(scenario), List.of(cafeteriaId));
        };
    when(queries.findUserAuthorization(userId)).thenReturn(current);
    mvc.perform(get("/api/worker/orders").with(identity("WORKER")))
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.status").value(403))
        .andExpect(jsonPath("$.code").value("FORBIDDEN"))
        .andExpect(jsonPath("$.message").value(FORBIDDEN_MESSAGE))
        .andExpect(jsonPath("$.path").value("/api/worker/orders"));
    verifyNoInteractions(list);
  }

  @Test
  void aCafeteriaChangeOrRevocationIsReadOnTheNextRequestWithoutCaching() throws Exception {
    UUID other = UUID.randomUUID();
    when(queries.findUserAuthorization(userId))
        .thenReturn(
            facts(true, Set.of("WORKER"), List.of(cafeteriaId)),
            facts(true, Set.of("WORKER"), List.of(other)),
            facts(false, Set.of("WORKER"), List.of(other)));
    mvc.perform(get("/api/worker/orders").with(identity("WORKER"))).andExpect(status().isOk());
    mvc.perform(get("/api/worker/orders").with(identity("WORKER"))).andExpect(status().isOk());
    mvc.perform(get("/api/worker/orders").with(identity("WORKER")))
        .andExpect(status().isForbidden());
    verify(queries, times(3)).findUserAuthorization(userId);
    verify(list).getOperationalOrders(cafeteriaId);
    verify(list).getOperationalOrders(other);
    verifyNoMoreInteractions(list);
  }

  @Test
  void anonymousAndInvalidSubjectsNeverReachTheListing() throws Exception {
    mvc.perform(get("/api/worker/orders")).andExpect(status().isUnauthorized());
    mvc.perform(get("/api/worker/orders").with(jwt().jwt(j -> j.subject("invalid-subject"))))
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.code").value("FORBIDDEN"));
    verifyNoInteractions(queries, list);
  }
}
