package com.santotofood.config;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.santotofood.adapter.in.web.WorkerDailyMenuController;
import com.santotofood.adapter.in.web.error.GlobalExceptionHandler;
import com.santotofood.adapter.in.web.error.WorkerDailyMenuExceptionHandler;
import com.santotofood.application.model.UserAuthorization;
import com.santotofood.application.model.WorkerDailyMenu;
import com.santotofood.application.port.in.ManageWorkerDailyMenuUseCase;
import com.santotofood.application.port.out.AuthorizationQueryPort;
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
import org.springframework.http.MediaType;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.context.junit.jupiter.web.SpringJUnitWebConfig;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;

/**
 * /api/worker/daily-menu/today: real security chain, method security and error advice; roles and
 * assignments come from a stubbed output port. The SQL runs in DailyMenuWorkerApiPostgresTest.
 */
@SpringJUnitWebConfig(
    classes = {
      SecurityConfig.class,
      OrderAuthorization.class,
      WorkerDailyMenuController.class,
      WorkerDailyMenuExceptionHandler.class,
      GlobalExceptionHandler.class,
      DailyMenuWorkerAuthorizationTest.TestConfig.class
    })
class DailyMenuWorkerAuthorizationTest {
  static final LocalDate TODAY = LocalDate.of(2026, 11, 20);
  @Autowired WebApplicationContext context;
  @Autowired AuthorizationQueryPort queries;
  @Autowired ManageWorkerDailyMenuUseCase menus;
  MockMvc mvc;
  final UUID userId = UUID.randomUUID();
  final UUID ownCafeteria = UUID.randomUUID();
  final UUID otherCafeteria = UUID.randomUUID();

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
    ManageWorkerDailyMenuUseCase menus() {
      return mock(ManageWorkerDailyMenuUseCase.class);
    }
  }

  static WorkerDailyMenu empty() {
    return new WorkerDailyMenu(
        TODAY,
        0,
        false,
        false,
        List.of(),
        true,
        "Almuerzo del día",
        null,
        List.of(),
        List.of(),
        null);
  }

  @BeforeEach
  void setup() {
    reset(queries, menus);
    mvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    when(menus.getToday(any())).thenReturn(empty());
    when(menus.replaceOptions(any(), any(), anyLong(), any(), any())).thenReturn(empty());
    when(menus.setAddition(any(), any(), anyLong(), any(), anyBoolean())).thenReturn(empty());
    when(menus.copyYesterday(any(), any(), anyLong())).thenReturn(empty());
    when(menus.publish(any(), any(), any(), anyLong())).thenReturn(empty());
    when(menus.unpublish(any(), any(), anyLong())).thenReturn(empty());
  }

  private void user(boolean active, Set<String> roles, List<UUID> cafeterias) {
    when(queries.findUserAuthorization(userId))
        .thenReturn(Optional.of(new UserAuthorization(active, roles, cafeterias)));
  }

  /** Every endpoint, with claims that try to point at another cafeteria. */
  private List<MockHttpServletRequestBuilder> requests() {
    String base = "/api/worker/daily-menu/today";
    return List.of(
        get(base),
        put(base + "/categories/" + UUID.randomUUID() + "/options")
            .content("{\"expectedVersion\":0,\"options\":[\"Pollo\"]}"),
        put(base + "/additions/" + UUID.randomUUID())
            .content("{\"expectedVersion\":0,\"available\":true}"),
        post(base + "/copy-yesterday").content("{\"expectedVersion\":0}"),
        post(base + "/publish").content("{\"expectedVersion\":0}"),
        post(base + "/unpublish").content("{\"expectedVersion\":0}"));
  }

  private MockHttpServletRequestBuilder signed(MockHttpServletRequestBuilder request) {
    return request
        .contentType(MediaType.APPLICATION_JSON)
        .header("X-Business-Date", TODAY.toString())
        .param("cafeteriaId", otherCafeteria.toString())
        .with(
            jwt()
                .jwt(
                    token ->
                        token
                            .subject(userId.toString())
                            .claim("cafeteriaId", otherCafeteria.toString())
                            .claim("user_metadata", Map.of("role", "WORKER"))));
  }

  @Test
  void ownWorkerReachesEveryEndpointOnlyForTheirOwnCafeteria() throws Exception {
    user(true, Set.of("WORKER"), List.of(ownCafeteria));
    for (var request : requests()) mvc.perform(signed(request)).andExpect(status().isOk());
    verify(menus).getToday(ownCafeteria);
    verify(menus).replaceOptions(eq(ownCafeteria), eq(TODAY), eq(0L), any(), eq(List.of("Pollo")));
    verify(menus).setAddition(eq(ownCafeteria), eq(TODAY), eq(0L), any(), eq(true));
    verify(menus).copyYesterday(ownCafeteria, TODAY, 0L);
    verify(menus).publish(ownCafeteria, userId, TODAY, 0L);
    verify(menus).unpublish(ownCafeteria, TODAY, 0L);
    verifyNoMoreInteractions(menus);
  }

  @ParameterizedTest
  @ValueSource(strings = {"ADMIN", "CLIENT", "SUPER_ADMIN"})
  void otherRolesAreForbiddenEverywhere(String role) throws Exception {
    user(true, Set.of(role), role.equals("ADMIN") ? List.of(ownCafeteria) : List.of());
    for (var request : requests())
      mvc.perform(signed(request))
          .andExpect(status().isForbidden())
          .andExpect(jsonPath("$.code").value("DAILY_MENU_FORBIDDEN"));
    verifyNoInteractions(menus);
  }

  @Test
  void workerAlsoAdminOrInactiveOrWithTwoCafeteriasIsForbidden() throws Exception {
    for (var facts :
        List.of(
            new UserAuthorization(true, Set.of("WORKER", "ADMIN"), List.of(ownCafeteria)),
            new UserAuthorization(false, Set.of("WORKER"), List.of(ownCafeteria)),
            new UserAuthorization(true, Set.of("WORKER"), List.of(ownCafeteria, otherCafeteria)),
            new UserAuthorization(true, Set.of("WORKER"), List.of()))) {
      when(queries.findUserAuthorization(userId)).thenReturn(Optional.of(facts));
      mvc.perform(signed(requests().get(4))).andExpect(status().isForbidden());
    }
    verifyNoInteractions(menus);
  }

  @Test
  void anonymousIsUnauthorized() throws Exception {
    for (var request : requests())
      mvc.perform(request.contentType(MediaType.APPLICATION_JSON))
          .andExpect(status().isUnauthorized());
    verifyNoInteractions(menus);
  }

  @Test
  void writesWithoutDateOrVersionAreInvalid() throws Exception {
    user(true, Set.of("WORKER"), List.of(ownCafeteria));
    mvc.perform(
            post("/api/worker/daily-menu/today/publish")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"expectedVersion\":0}")
                .with(jwt().jwt(token -> token.subject(userId.toString()))))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("DAILY_MENU_INVALID_REQUEST"));
    mvc.perform(signed(post("/api/worker/daily-menu/today/publish").content("{}")))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("DAILY_MENU_INVALID_REQUEST"));
    verifyNoInteractions(menus);
  }
}
