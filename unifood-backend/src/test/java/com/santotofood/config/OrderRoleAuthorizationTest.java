package com.santotofood.config;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.santotofood.adapter.in.web.OrderController;
import com.santotofood.adapter.in.web.WorkerContextController;
import com.santotofood.adapter.in.web.error.GlobalExceptionHandler;
import com.santotofood.adapter.in.web.mapper.OrderResponseMapper;
import com.santotofood.application.model.UserAuthorization;
import com.santotofood.application.port.in.*;
import com.santotofood.application.port.out.AuthorizationQueryPort;
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
 * Real endpoints, method security and API error advice; current facts come from a stubbed output
 * port. The persistence SQL itself is exercised against PostgreSQL by order-authorization.test.mjs.
 */
@SpringJUnitWebConfig(
    classes = {
      SecurityConfig.class,
      OrderAuthorization.class,
      OrderController.class,
      WorkerContextController.class,
      GlobalExceptionHandler.class,
      OrderRoleAuthorizationTest.TestConfig.class
    })
class OrderRoleAuthorizationTest {
  @Autowired WebApplicationContext context;
  @Autowired AuthorizationQueryPort queries;
  @Autowired GetOrdersByCafeteriaUseCase list;
  @Autowired PrepareOrderUseCase prepare;
  @Autowired MarkOrderReadyUseCase ready;
  @Autowired CallStudentUseCase call;
  @Autowired DeliverOrderUseCase deliver;
  @Autowired RejectOrderUseCase reject;
  @Autowired RemindStudentUseCase remind;
  @Autowired MarkOrderNotCollectedUseCase notCollected;
  MockMvc mvc;
  final UUID userId = UUID.randomUUID();
  final UUID cafeteriaId = UUID.randomUUID();
  final UUID orderId = UUID.randomUUID();

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
    PrepareOrderUseCase prepare() {
      return mock(PrepareOrderUseCase.class);
    }

    @Bean
    MarkOrderReadyUseCase ready() {
      return mock(MarkOrderReadyUseCase.class);
    }

    @Bean
    CallStudentUseCase call() {
      return mock(CallStudentUseCase.class);
    }

    @Bean
    DeliverOrderUseCase deliver() {
      return mock(DeliverOrderUseCase.class);
    }

    @Bean
    RejectOrderUseCase reject() {
      return mock(RejectOrderUseCase.class);
    }

    @Bean
    RemindStudentUseCase remind() {
      return mock(RemindStudentUseCase.class);
    }

    @Bean
    MarkOrderNotCollectedUseCase notCollected() {
      return mock(MarkOrderNotCollectedUseCase.class);
    }

    @Bean
    OrderResponseMapper mapper() {
      return mock(OrderResponseMapper.class);
    }
  }

  private Optional<UserAuthorization> worker(List<UUID> cafeterias) {
    return Optional.of(new UserAuthorization(true, Set.of("WORKER"), cafeterias));
  }

  @BeforeEach
  void setup() {
    reset(queries, list, prepare, ready, call, deliver, reject, remind, notCollected);
    mvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    when(queries.findOrderCafeteria(orderId)).thenReturn(Optional.of(cafeteriaId));
  }

  private RequestPostProcessor identity(String metadataRole) {
    return jwt()
        .jwt(
            j -> j.subject(userId.toString()).claim("user_metadata", Map.of("role", metadataRole)));
  }

  @Test
  void assignedActiveWorkerCanListAndUseEveryExistingOperation() throws Exception {
    when(queries.findUserAuthorization(userId)).thenReturn(worker(List.of(cafeteriaId)));
    when(list.getOperationalOrders(cafeteriaId))
        .thenReturn(
            new com.santotofood.application.model.OperationalOrders(
                new com.santotofood.domain.model.BusinessDate(java.time.LocalDate.of(2026, 10, 14)),
                List.of()));
    mvc.perform(
            get("/api/orders")
                .param("cafeteriaId", cafeteriaId.toString())
                .with(identity("CLIENT")))
        .andExpect(status().isOk())
        .andExpect(content().json("[]"));
    for (String action :
        List.of("prepare", "ready", "call", "remind", "deliver", "not-collected", "reject")) {
      mvc.perform(patch("/api/orders/" + orderId + "/" + action).with(identity("CLIENT")))
          .andExpect(status().isOk());
    }
    verify(list).getOperationalOrders(cafeteriaId);
    verify(prepare).prepareOrder(orderId);
    verify(ready).markOrderReady(orderId);
    verify(call).callStudent(orderId);
    verify(deliver).deliverOrder(orderId);
    verify(reject).rejectOrder(orderId, userId, null);
    verify(remind).remindStudent(orderId);
    verify(notCollected).markOrderNotCollected(orderId);
    verify(queries, times(8)).findUserAuthorization(userId);
  }

  @Test
  void theWorkerCancellationRouteNoLongerExists() throws Exception {
    when(queries.findUserAuthorization(userId)).thenReturn(worker(List.of(cafeteriaId)));
    int status =
        mvc.perform(patch("/api/orders/" + orderId + "/cancel").with(identity("WORKER")))
            .andReturn()
            .getResponse()
            .getStatus();
    assertEquals(404, status);
    verifyNoInteractions(list, prepare, ready, call, deliver, reject, remind, notCollected);
  }

  @ParameterizedTest
  @ValueSource(strings = {"WORKER", "ADMIN", "SUPER_ADMIN", "CLIENT"})
  void databaseDenialBlocksListingAndEveryOperationRegardlessOfTokenRole(String claimedRole)
      throws Exception {
    when(queries.findUserAuthorization(userId)).thenReturn(Optional.empty());
    mvc.perform(get("/api/worker/context").with(identity(claimedRole)))
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.code").value("FORBIDDEN"));
    mvc.perform(
            get("/api/orders")
                .param("cafeteriaId", cafeteriaId.toString())
                .with(identity(claimedRole)))
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.status").value(403))
        .andExpect(jsonPath("$.code").value("FORBIDDEN"))
        .andExpect(jsonPath("$.path").value("/api/orders"))
        .andExpect(jsonPath("$.timestamp").exists());
    for (String action :
        List.of("prepare", "ready", "call", "remind", "deliver", "not-collected", "reject")) {
      mvc.perform(patch("/api/orders/" + orderId + "/" + action).with(identity(claimedRole)))
          .andExpect(status().isForbidden())
          .andExpect(jsonPath("$.code").value("FORBIDDEN"));
    }
    verifyNoInteractions(list, prepare, ready, call, deliver, reject, remind, notCollected);
  }

  @Test
  void anonymousRequestsCannotReachOperationalUseCases() throws Exception {
    mvc.perform(get("/api/worker/context")).andExpect(status().isUnauthorized());
    mvc.perform(get("/api/orders").param("cafeteriaId", cafeteriaId.toString()))
        .andExpect(status().isUnauthorized());
    mvc.perform(patch("/api/orders/" + orderId + "/prepare")).andExpect(status().isUnauthorized());
    mvc.perform(patch("/api/orders/" + orderId + "/remind")).andExpect(status().isUnauthorized());
    mvc.perform(patch("/api/orders/" + orderId + "/not-collected"))
        .andExpect(status().isUnauthorized());
    verifyNoInteractions(
        queries, list, prepare, ready, call, deliver, reject, remind, notCollected);
  }

  @Test
  void contextReturnsOnlyTheCurrentWorkersCafeteriaWithoutCaching() throws Exception {
    when(queries.findUserAuthorization(userId)).thenReturn(worker(List.of(cafeteriaId)));
    mvc.perform(
            get("/api/worker/context")
                .param("cafeteriaId", UUID.randomUUID().toString())
                .with(identity("SUPER_ADMIN")))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.cafeteriaId").value(cafeteriaId.toString()))
        .andExpect(jsonPath("$.length()").value(1))
        .andExpect(header().string("Cache-Control", "no-store"));
    verify(queries).findUserAuthorization(userId);
    verifyNoInteractions(list, prepare, ready, call, deliver, reject, remind, notCollected);
  }

  @ParameterizedTest
  @ValueSource(ints = {0, 2})
  void absentOrMultipleAssignmentsDenyContextAndEveryOrderOperation(int assignments)
      throws Exception {
    when(queries.findUserAuthorization(userId))
        .thenReturn(worker(assignments == 0 ? List.of() : List.of(cafeteriaId, UUID.randomUUID())));
    mvc.perform(get("/api/worker/context").with(identity("WORKER")))
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.code").value("FORBIDDEN"));
    mvc.perform(
            get("/api/orders")
                .param("cafeteriaId", cafeteriaId.toString())
                .with(identity("WORKER")))
        .andExpect(status().isForbidden());
    for (String action :
        List.of("prepare", "ready", "call", "remind", "deliver", "not-collected", "reject")) {
      mvc.perform(patch("/api/orders/" + orderId + "/" + action).with(identity("WORKER")))
          .andExpect(status().isForbidden());
    }
    verifyNoInteractions(list, prepare, ready, call, deliver, reject, remind, notCollected);
  }

  @Test
  void anotherCafeteriaCannotBeSelectedAndRevocationIsReadOnTheNextRequest() throws Exception {
    when(queries.findUserAuthorization(userId))
        .thenReturn(
            worker(List.of(UUID.randomUUID())), worker(List.of(cafeteriaId)), worker(List.of()));
    mvc.perform(
            get("/api/orders")
                .param("cafeteriaId", cafeteriaId.toString())
                .with(identity("WORKER")))
        .andExpect(status().isForbidden());
    mvc.perform(get("/api/worker/context").with(identity("WORKER"))).andExpect(status().isOk());
    mvc.perform(patch("/api/orders/" + orderId + "/prepare").with(identity("WORKER")))
        .andExpect(status().isForbidden());
    verify(queries, times(3)).findUserAuthorization(userId);
    verifyNoInteractions(list, prepare, ready, call, deliver, reject, remind, notCollected);
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "ADMIN",
        "SUPER_ADMIN",
        "CLIENT",
        "WORKER_CLIENT",
        "UNKNOWN",
        "WORKER_ADMIN",
        "WORKER_SUPER_ADMIN",
        "INACTIVE"
      })
  void databaseFactsDenyInvalidWorkersBeforeUseCases(String scenario) throws Exception {
    Set<String> roles =
        switch (scenario) {
          case "WORKER_CLIENT" -> Set.of("WORKER", "CLIENT");
          case "WORKER_ADMIN" -> Set.of("WORKER", "ADMIN");
          case "WORKER_SUPER_ADMIN" -> Set.of("WORKER", "SUPER_ADMIN");
          case "INACTIVE" -> Set.of("WORKER");
          default -> Set.of(scenario);
        };
    when(queries.findUserAuthorization(userId))
        .thenReturn(
            Optional.of(
                new UserAuthorization(!scenario.equals("INACTIVE"), roles, List.of(cafeteriaId))));
    mvc.perform(get("/api/worker/context").with(identity("WORKER")))
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.code").value("FORBIDDEN"));
    mvc.perform(
            get("/api/orders")
                .param("cafeteriaId", cafeteriaId.toString())
                .with(identity("WORKER")))
        .andExpect(status().isForbidden());
    for (String action :
        List.of("prepare", "ready", "call", "remind", "deliver", "not-collected", "reject")) {
      mvc.perform(patch("/api/orders/" + orderId + "/" + action).with(identity("WORKER")))
          .andExpect(status().isForbidden());
    }
    verifyNoInteractions(list, prepare, ready, call, deliver, reject, remind, notCollected);
  }

  @Test
  void reminderAndNotCollectedRulesReachTheWorkerAs409WithStableCodes() throws Exception {
    when(queries.findUserAuthorization(userId)).thenReturn(worker(List.of(cafeteriaId)));
    when(remind.remindStudent(orderId))
        .thenThrow(new com.santotofood.domain.exception.ReminderTooEarlyException())
        .thenThrow(new com.santotofood.domain.exception.ReminderLimitReachedException())
        .thenThrow(new com.santotofood.domain.exception.InvalidOrderStateException("PRIVATE"));
    when(notCollected.markOrderNotCollected(orderId))
        .thenThrow(new com.santotofood.domain.exception.NotCollectedRequirementsException())
        .thenThrow(new com.santotofood.domain.exception.InvalidOrderStateException("PRIVATE"));
    for (String code :
        List.of("REMINDER_TOO_EARLY", "REMINDER_LIMIT_REACHED", "INVALID_ORDER_STATE")) {
      mvc.perform(patch("/api/orders/" + orderId + "/remind").with(identity("WORKER")))
          .andExpect(status().isConflict())
          .andExpect(jsonPath("$.code").value(code))
          .andExpect(jsonPath("$.path").value("/api/orders/" + orderId + "/remind"));
    }
    for (String code : List.of("NOT_COLLECTED_REQUIREMENTS_NOT_MET", "INVALID_ORDER_STATE")) {
      mvc.perform(patch("/api/orders/" + orderId + "/not-collected").with(identity("WORKER")))
          .andExpect(status().isConflict())
          .andExpect(jsonPath("$.code").value(code))
          .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.not("PRIVATE")));
    }
  }

  @Test
  void anotherCafeteriasOrderAndAMissingOneGetTheSame403OnBothRoutes() throws Exception {
    UUID missing = UUID.randomUUID();
    UUID foreign = UUID.randomUUID();
    when(queries.findUserAuthorization(userId)).thenReturn(worker(List.of(cafeteriaId)));
    when(queries.findOrderCafeteria(missing)).thenReturn(Optional.empty());
    when(queries.findOrderCafeteria(foreign)).thenReturn(Optional.of(UUID.randomUUID()));
    for (UUID id : List.of(missing, foreign)) {
      for (String action : List.of("remind", "not-collected")) {
        mvc.perform(patch("/api/orders/" + id + "/" + action).with(identity("WORKER")))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.code").value("FORBIDDEN"))
            .andExpect(
                jsonPath("$.message").value("No tienes permisos para realizar esta operación"));
      }
    }
    verifyNoInteractions(remind, notCollected);
  }

  @Test
  void invalidIdentityCannotResolveContext() throws Exception {
    mvc.perform(get("/api/worker/context").with(jwt().jwt(j -> j.subject("invalid-subject"))))
        .andExpect(status().isForbidden());
    verifyNoInteractions(queries);
  }
}
