package com.santotofood.config;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.santotofood.adapter.in.web.SuperAdminCafeteriaController;
import com.santotofood.adapter.in.web.error.GlobalExceptionHandler;
import com.santotofood.adapter.in.web.error.SuperAdminExceptionHandler;
import com.santotofood.application.model.CafeteriaBilling;
import com.santotofood.application.model.SuperAdminInstitution;
import com.santotofood.application.model.UserAuthorization;
import com.santotofood.application.port.in.ChangeCafeteriaBillingUseCase;
import com.santotofood.application.port.in.ChangeCafeteriaVisibilityUseCase;
import com.santotofood.application.port.in.ListCafeteriaSettingsAuditUseCase;
import com.santotofood.application.port.in.ListSuperAdminCafeteriasUseCase;
import com.santotofood.application.port.out.AuthorizationQueryPort;
import java.util.List;
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
import org.springframework.dao.TransientDataAccessResourceException;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.context.junit.jupiter.web.SpringJUnitWebConfig;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;

/** Real endpoint, method security and advice; current role facts come from a stubbed port. */
@SpringJUnitWebConfig(
    classes = {
      SecurityConfig.class,
      OrderAuthorization.class,
      SuperAdminCafeteriaController.class,
      SuperAdminExceptionHandler.class,
      GlobalExceptionHandler.class,
      SuperAdminCafeteriaAuthorizationTest.TestConfig.class
    })
class SuperAdminCafeteriaAuthorizationTest {
  static final String ENDPOINT = "/api/super-admin/cafeterias";
  @Autowired WebApplicationContext context;
  @Autowired AuthorizationQueryPort queries;
  @Autowired ListSuperAdminCafeteriasUseCase cafeterias;
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
    ListSuperAdminCafeteriasUseCase cafeterias() {
      return mock(ListSuperAdminCafeteriasUseCase.class);
    }

    @Bean
    ChangeCafeteriaVisibilityUseCase visibility() {
      return mock(ChangeCafeteriaVisibilityUseCase.class);
    }

    @Bean
    ChangeCafeteriaBillingUseCase billing() {
      return mock(ChangeCafeteriaBillingUseCase.class);
    }

    @Bean
    ListCafeteriaSettingsAuditUseCase audit() {
      return mock(ListCafeteriaSettingsAuditUseCase.class);
    }
  }

  @BeforeEach
  void setup() {
    reset(queries, cafeterias);
    mvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
  }

  /** The JWT always claims SUPER_ADMIN: only the database facts may decide. */
  RequestPostProcessor as(String subject) {
    return jwt()
        .jwt(
            token ->
                token
                    .subject(subject)
                    .claim("role", "SUPER_ADMIN")
                    .claim("app_metadata", java.util.Map.of("role", "SUPER_ADMIN")));
  }

  void facts(UserAuthorization user) {
    when(queries.findUserAuthorization(userId)).thenReturn(Optional.of(user));
  }

  @Test
  void anonymousRequestIs401WithoutReadingFactsOrCafeterias() throws Exception {
    mvc.perform(get(ENDPOINT)).andExpect(status().isUnauthorized());
    verifyNoInteractions(queries, cafeterias);
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "CLIENT",
        "WORKER",
        "ADMIN",
        "INACTIVE_SUPER_ADMIN",
        "SUPER_ADMIN_WITH_CAFETERIA",
        "SUPER_ADMIN_AND_ADMIN",
        "NO_ROLE",
        "MISSING_USER"
      })
  void everyIdentityExceptAnActiveExclusiveSuperAdminIs403(String identity) throws Exception {
    switch (identity) {
      case "CLIENT" -> facts(new UserAuthorization(true, Set.of("CLIENT"), List.of()));
      case "WORKER" -> facts(new UserAuthorization(true, Set.of("WORKER"), List.of(cafeteriaId)));
      case "ADMIN" -> facts(new UserAuthorization(true, Set.of("ADMIN"), List.of(cafeteriaId)));
      case "INACTIVE_SUPER_ADMIN" ->
          facts(new UserAuthorization(false, Set.of("SUPER_ADMIN"), List.of()));
      case "SUPER_ADMIN_WITH_CAFETERIA" ->
          facts(new UserAuthorization(true, Set.of("SUPER_ADMIN"), List.of(cafeteriaId)));
      case "SUPER_ADMIN_AND_ADMIN" ->
          facts(new UserAuthorization(true, Set.of("SUPER_ADMIN", "ADMIN"), List.of()));
      case "NO_ROLE" -> facts(new UserAuthorization(true, Set.of(), List.of()));
      default -> when(queries.findUserAuthorization(userId)).thenReturn(Optional.empty());
    }
    mvc.perform(get(ENDPOINT).with(as(userId.toString())))
        .andExpect(status().isForbidden())
        .andExpect(header().string("Cache-Control", "no-store"))
        .andExpect(jsonPath("$.code").value("SUPER_ADMIN_FORBIDDEN"))
        .andExpect(jsonPath("$.path").value(ENDPOINT));
    verifyNoInteractions(cafeterias);
  }

  @ParameterizedTest
  @ValueSource(strings = {"", "not-a-uuid"})
  void malformedSubjectsAre403WithoutReadingFacts(String subject) throws Exception {
    mvc.perform(get(ENDPOINT).with(as(subject)))
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.code").value("SUPER_ADMIN_FORBIDDEN"));
    verifyNoInteractions(queries, cafeterias);
  }

  @Test
  void activeExclusiveSuperAdminReadsTheTreeForItsVerifiedSubject() throws Exception {
    facts(new UserAuthorization(true, Set.of("SUPER_ADMIN"), List.of()));
    UUID institution = UUID.randomUUID(), site = UUID.randomUUID();
    when(cafeterias.listCafeterias(userId))
        .thenReturn(
            List.of(
                new SuperAdminInstitution(
                    institution,
                    "Universidad",
                    true,
                    List.of(
                        new SuperAdminInstitution.Site(
                            site,
                            "Sede Principal",
                            "Villavicencio",
                            true,
                            List.of(
                                new SuperAdminInstitution.Cafeteria(
                                    cafeteriaId,
                                    "Cafetería Central",
                                    false,
                                    true,
                                    new CafeteriaBilling(
                                        CafeteriaBilling.Model.SUBSCRIPTION, null, 250000),
                                    3)))))));
    mvc.perform(get(ENDPOINT).with(as(userId.toString())).param("userId", "ignored"))
        .andExpect(status().isOk())
        .andExpect(header().string("Cache-Control", "no-store"))
        .andExpect(jsonPath("$.institutions[0].id").value(institution.toString()))
        .andExpect(jsonPath("$.institutions[0].active").value(true))
        .andExpect(jsonPath("$.institutions[0].sites[0].city").value("Villavicencio"))
        .andExpect(
            jsonPath("$.institutions[0].sites[0].cafeterias[0].id").value(cafeteriaId.toString()))
        .andExpect(jsonPath("$.institutions[0].sites[0].cafeterias[0].visible").value(false))
        .andExpect(jsonPath("$.institutions[0].sites[0].cafeterias[0].subscribed").doesNotExist())
        .andExpect(
            jsonPath("$.institutions[0].sites[0].cafeterias[0].billing.model")
                .value("SUBSCRIPTION"))
        .andExpect(
            jsonPath("$.institutions[0].sites[0].cafeterias[0].billing.subscriptionFeeCop")
                .value(250000))
        .andExpect(jsonPath("$.institutions[0].sites[0].cafeterias[0].billing.version").value(3))
        .andExpect(jsonPath("$.institutions[0].sites[0].cafeterias[0].hasActiveAdmin").value(true))
        .andExpect(jsonPath("$.institutions[0].sites[0].cafeterias[0].active").doesNotExist());
    verify(cafeterias).listCafeterias(userId);
  }

  @Test
  void revokedSuperAdminIsDeniedOnTheNextRequest() throws Exception {
    when(queries.findUserAuthorization(userId))
        .thenReturn(
            Optional.of(new UserAuthorization(true, Set.of("SUPER_ADMIN"), List.of())),
            Optional.of(new UserAuthorization(false, Set.of("SUPER_ADMIN"), List.of())));
    when(cafeterias.listCafeterias(userId)).thenReturn(List.of());
    mvc.perform(get(ENDPOINT).with(as(userId.toString()))).andExpect(status().isOk());
    mvc.perform(get(ENDPOINT).with(as(userId.toString()))).andExpect(status().isForbidden());
    verify(cafeterias, times(1)).listCafeterias(any());
  }

  @Test
  void temporaryFailureIsASafe503() throws Exception {
    facts(new UserAuthorization(true, Set.of("SUPER_ADMIN"), List.of()));
    when(cafeterias.listCafeterias(userId))
        .thenThrow(new TransientDataAccessResourceException("PRIVATE_DETAIL"));
    mvc.perform(get(ENDPOINT).with(as(userId.toString())))
        .andExpect(status().isServiceUnavailable())
        .andExpect(header().string("Retry-After", "5"))
        .andExpect(jsonPath("$.code").value("SUPER_ADMIN_TEMPORARILY_UNAVAILABLE"))
        .andExpect(
            content()
                .string(
                    org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("PRIVATE"))));
  }
}
