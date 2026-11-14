package com.santotofood.config;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.santotofood.adapter.in.web.SuperAdminCafeteriaController;
import com.santotofood.adapter.in.web.error.GlobalExceptionHandler;
import com.santotofood.adapter.in.web.error.SuperAdminExceptionHandler;
import com.santotofood.application.exception.CafeteriaSettingsException;
import com.santotofood.application.model.CafeteriaBilling;
import com.santotofood.application.model.CafeteriaSettingsAuditEntry;
import com.santotofood.application.model.SuperAdminInstitution;
import com.santotofood.application.model.UserAuthorization;
import com.santotofood.application.port.in.ChangeCafeteriaBillingUseCase;
import com.santotofood.application.port.in.ChangeCafeteriaVisibilityUseCase;
import com.santotofood.application.port.in.ListCafeteriaSettingsAuditUseCase;
import com.santotofood.application.port.in.ListSuperAdminCafeteriasUseCase;
import com.santotofood.application.port.out.AuthorizationQueryPort;
import java.time.Instant;
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
import org.springframework.dao.CannotAcquireLockException;
import org.springframework.http.MediaType;
import org.springframework.security.oauth2.jwt.BadJwtException;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.context.junit.jupiter.web.SpringJUnitWebConfig;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;

/**
 * Visibility, billing and audit endpoints with the real controller, method security and advice:
 * roles come from a stubbed port, so every refusal happens before any use case runs.
 */
@SpringJUnitWebConfig(
    classes = {
      SecurityConfig.class,
      OrderAuthorization.class,
      SuperAdminCafeteriaController.class,
      SuperAdminExceptionHandler.class,
      GlobalExceptionHandler.class,
      CafeteriaSettingsAuthorizationTest.TestConfig.class
    })
class CafeteriaSettingsAuthorizationTest {
  static final String ENDPOINT = "/api/super-admin/cafeterias";
  static final String HIDE = "{\"visible\":false,\"expectedVisible\":true}";
  static final String FEE =
      "{\"model\":\"PER_ORDER_FEE\",\"perOrderFeeCop\":1000,\"subscriptionFeeCop\":null,\"expectedVersion\":0}";

  @Autowired WebApplicationContext context;
  @Autowired AuthorizationQueryPort queries;
  @Autowired ChangeCafeteriaVisibilityUseCase visibility;
  @Autowired ChangeCafeteriaBillingUseCase billing;
  @Autowired ListCafeteriaSettingsAuditUseCase audit;
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
      JwtDecoder decoder = mock(JwtDecoder.class);
      when(decoder.decode(any())).thenThrow(new BadJwtException("Rejected test token"));
      return decoder;
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
    reset(queries, visibility, billing, audit);
    mvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
  }

  /** The JWT always claims SUPER_ADMIN: only the database facts may decide. */
  RequestPostProcessor as(UUID subject) {
    return jwt().jwt(token -> token.subject(subject.toString()).claim("role", "SUPER_ADMIN"));
  }

  void facts(UserAuthorization user) {
    when(queries.findUserAuthorization(userId)).thenReturn(Optional.of(user));
  }

  void superAdmin() {
    facts(new UserAuthorization(true, Set.of("SUPER_ADMIN"), List.of()));
  }

  String path(String suffix) {
    return ENDPOINT + "/" + cafeteriaId + suffix;
  }

  MockHttpServletRequestBuilder visibilityRequest(String body) {
    return patch(path("/visibility")).contentType(MediaType.APPLICATION_JSON).content(body);
  }

  MockHttpServletRequestBuilder billingRequest(String body) {
    return put(path("/billing")).contentType(MediaType.APPLICATION_JSON).content(body);
  }

  SuperAdminInstitution.Cafeteria updated() {
    return new SuperAdminInstitution.Cafeteria(
        cafeteriaId,
        "Cafetería Central",
        false,
        true,
        new CafeteriaBilling(CafeteriaBilling.Model.PER_ORDER_FEE, 1000, null),
        1);
  }

  @Test
  void anonymousAndInvalidTokensAre401WithoutTouchingAnything() throws Exception {
    mvc.perform(visibilityRequest(HIDE)).andExpect(status().isUnauthorized());
    mvc.perform(billingRequest(FEE)).andExpect(status().isUnauthorized());
    mvc.perform(get(path("/audit"))).andExpect(status().isUnauthorized());
    mvc.perform(visibilityRequest(HIDE).header("Authorization", "Bearer invalid"))
        .andExpect(status().isUnauthorized());
    mvc.perform(billingRequest(FEE).header("Authorization", "Bearer invalid"))
        .andExpect(status().isUnauthorized());
    verifyNoInteractions(queries, visibility, billing, audit);
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
        "MISSING_USER"
      })
  void onlyAnActiveExclusiveSuperAdminChangesOrReadsSettings(String identity) throws Exception {
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
      default -> when(queries.findUserAuthorization(userId)).thenReturn(Optional.empty());
    }
    for (var request : List.of(visibilityRequest(HIDE), billingRequest(FEE), get(path("/audit"))))
      mvc.perform(request.with(as(userId)))
          .andExpect(status().isForbidden())
          .andExpect(header().string("Cache-Control", "no-store"))
          .andExpect(jsonPath("$.code").value("SUPER_ADMIN_FORBIDDEN"));
    verifyNoInteractions(visibility, billing, audit);
  }

  @Test
  void superAdminChangesAndReadsForItsVerifiedSubject() throws Exception {
    superAdmin();
    when(visibility.changeVisibility(userId, cafeteriaId, false, true)).thenReturn(updated());
    when(billing.changeBilling(
            userId,
            cafeteriaId,
            new CafeteriaBilling(CafeteriaBilling.Model.PER_ORDER_FEE, 1000, null),
            0))
        .thenReturn(updated());
    mvc.perform(visibilityRequest(HIDE).with(as(userId)))
        .andExpect(status().isOk())
        .andExpect(header().string("Cache-Control", "no-store"))
        .andExpect(jsonPath("$.id").value(cafeteriaId.toString()))
        .andExpect(jsonPath("$.visible").value(false))
        .andExpect(jsonPath("$.hasActiveAdmin").value(true))
        .andExpect(jsonPath("$.subscribed").doesNotExist());
    mvc.perform(billingRequest(FEE).with(as(userId)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.billing.model").value("PER_ORDER_FEE"))
        .andExpect(jsonPath("$.billing.perOrderFeeCop").value(1000))
        .andExpect(jsonPath("$.billing.subscriptionFeeCop").isEmpty())
        .andExpect(jsonPath("$.billing.version").value(1));
    when(audit.listAudit(userId, cafeteriaId, 5))
        .thenReturn(
            List.of(
                new CafeteriaSettingsAuditEntry(
                    CafeteriaSettingsAuditEntry.Setting.BILLING,
                    "{\"model\": \"NONE\", \"perOrderFeeCop\": null, \"subscriptionFeeCop\": null}",
                    "{\"model\": \"PER_ORDER_FEE\", \"perOrderFeeCop\": 1000, \"subscriptionFeeCop\": null}",
                    Instant.parse("2026-11-12T15:00:00Z"),
                    "Dueño",
                    CafeteriaSettingsAuditEntry.Source.API),
                new CafeteriaSettingsAuditEntry(
                    CafeteriaSettingsAuditEntry.Setting.VISIBILITY,
                    "{\"visible\": true}",
                    "{\"visible\": false}",
                    Instant.parse("2026-11-12T14:00:00Z"),
                    null,
                    CafeteriaSettingsAuditEntry.Source.SQL)));
    mvc.perform(get(path("/audit")).param("limit", "5").with(as(userId)))
        .andExpect(status().isOk())
        .andExpect(header().string("Cache-Control", "no-store"))
        .andExpect(jsonPath("$.entries[0].setting").value("BILLING"))
        .andExpect(jsonPath("$.entries[0].newValue.perOrderFeeCop").value(1000))
        .andExpect(jsonPath("$.entries[0].oldValue.model").value("NONE"))
        .andExpect(jsonPath("$.entries[0].changedBy.name").value("Dueño"))
        .andExpect(jsonPath("$.entries[0].source").value("API"))
        .andExpect(jsonPath("$.entries[1].newValue.visible").value(false))
        .andExpect(jsonPath("$.entries[1].changedBy").isEmpty())
        .andExpect(jsonPath("$.entries[1].source").value("SQL"));
    when(audit.listAudit(userId, cafeteriaId, 20)).thenReturn(List.of());
    mvc.perform(get(path("/audit")).with(as(userId)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.entries").isEmpty());
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "",
        "[]",
        "{}",
        "{\"visible\":false}",
        "{\"visible\":\"false\",\"expectedVisible\":true}",
        "{\"visible\":false,\"expectedVisible\":true,\"cafeteriaId\":\"x\"}",
        "{\"visible\":false,\"visible\":true,\"expectedVisible\":true}",
        "{\"visible\":false,\"expectedVisible\":null}",
        "{\"visible\":false,\"expectedVisible\":true} {}"
      })
  void malformedVisibilityIs400WithoutWriting(String body) throws Exception {
    superAdmin();
    mvc.perform(visibilityRequest(body).with(as(userId)))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("SUPER_ADMIN_INVALID_REQUEST"));
    verifyNoInteractions(visibility);
  }

  @Test
  void visibilityWithoutJsonContentTypeIs400() throws Exception {
    superAdmin();
    mvc.perform(
            patch(path("/visibility"))
                .contentType(MediaType.TEXT_PLAIN)
                .content(HIDE)
                .with(as(userId)))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("SUPER_ADMIN_INVALID_REQUEST"));
    verifyNoInteractions(visibility);
  }

  static String billingBody(String model, String perOrder, String subscription, String version) {
    return "{\"model\":"
        + model
        + ",\"perOrderFeeCop\":"
        + perOrder
        + ",\"subscriptionFeeCop\":"
        + subscription
        + ",\"expectedVersion\":"
        + version
        + "}";
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        // fee missing, zero, over the cap, with cents, as text
        "\"PER_ORDER_FEE\"|null|null|0",
        "\"PER_ORDER_FEE\"|0|null|0",
        "\"PER_ORDER_FEE\"|1000001|null|0",
        "\"PER_ORDER_FEE\"|1000.5|null|0",
        "\"PER_ORDER_FEE\"|1000.0|null|0",
        "\"PER_ORDER_FEE\"|\"1000\"|null|0",
        // fee without its model, monthly amount without SUBSCRIPTION
        "\"NONE\"|1000|null|0",
        "\"SUBSCRIPTION\"|1000|null|0",
        "\"NONE\"|null|50000|0",
        "\"PER_ORDER_FEE\"|1000|50000|0",
        // monthly amount out of range or not whole
        "\"SUBSCRIPTION\"|null|0|0",
        "\"SUBSCRIPTION\"|null|100000001|0",
        "\"SUBSCRIPTION\"|null|50000.5|0",
        // unknown model, bad version
        "\"PERCENT\"|null|null|0",
        "null|null|null|0",
        "\"NONE\"|null|null|-1",
        "\"NONE\"|null|null|\"0\"",
        "\"NONE\"|null|null|1.5"
      })
  void invalidBillingIs400WithoutWriting(String row) throws Exception {
    superAdmin();
    var parts = row.split("\\|");
    mvc.perform(
            billingRequest(billingBody(parts[0], parts[1], parts[2], parts[3])).with(as(userId)))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("BILLING_INVALID_REQUEST"));
    verifyNoInteractions(billing);
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "{}",
        "{\"model\":\"NONE\",\"perOrderFeeCop\":null,\"expectedVersion\":0}",
        "{\"model\":\"NONE\",\"perOrderFeeCop\":null,\"subscriptionFeeCop\":null,\"expectedVersion\":0,\"x\":1}"
      })
  void billingNeedsExactlyItsFourKeys(String body) throws Exception {
    superAdmin();
    mvc.perform(billingRequest(body).with(as(userId)))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("BILLING_INVALID_REQUEST"));
    verifyNoInteractions(billing);
  }

  @Test
  void validAgreementsReachTheUseCase() throws Exception {
    superAdmin();
    when(billing.changeBilling(any(), any(), any(), anyInt())).thenReturn(updated());
    for (var body :
        List.of(
            billingBody("\"NONE\"", "null", "null", "0"),
            billingBody("\"SUBSCRIPTION\"", "null", "null", "0"),
            billingBody("\"SUBSCRIPTION\"", "null", "100000000", "2"),
            billingBody("\"PER_ORDER_FEE\"", "1", "null", "0"),
            billingBody("\"PER_ORDER_FEE\"", "1000000", "null", "0")))
      mvc.perform(billingRequest(body).with(as(userId))).andExpect(status().isOk());
    verify(billing)
        .changeBilling(
            userId,
            cafeteriaId,
            new CafeteriaBilling(CafeteriaBilling.Model.SUBSCRIPTION, null, 100000000),
            2);
  }

  @ParameterizedTest
  @ValueSource(strings = {"0", "51", "-1", "x", "1.5", "007"})
  void auditLimitOutsideOneToFiftyIs400(String limit) throws Exception {
    superAdmin();
    mvc.perform(get(path("/audit")).param("limit", limit).with(as(userId)))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("SUPER_ADMIN_INVALID_REQUEST"));
    verifyNoInteractions(audit);
  }

  @Test
  void malformedCafeteriaIdIs400() throws Exception {
    superAdmin();
    mvc.perform(
            patch(ENDPOINT + "/not-a-uuid/visibility")
                .contentType(MediaType.APPLICATION_JSON)
                .content(HIDE)
                .with(as(userId)))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("SUPER_ADMIN_INVALID_REQUEST"));
    verifyNoInteractions(visibility);
  }

  @Test
  void businessOutcomesKeepTheirStatusAndFixedMessage() throws Exception {
    superAdmin();
    when(visibility.changeVisibility(any(), any(), anyBoolean(), anyBoolean()))
        .thenThrow(
            CafeteriaSettingsException.requiresAdmin(),
            CafeteriaSettingsException.visibilityChanged(),
            CafeteriaSettingsException.cafeteriaNotFound());
    mvc.perform(visibilityRequest(HIDE).with(as(userId)))
        .andExpect(status().isConflict())
        .andExpect(header().string("Cache-Control", "no-store"))
        .andExpect(jsonPath("$.code").value("CAFETERIA_REQUIRES_ADMIN"))
        .andExpect(
            jsonPath("$.message")
                .value("Asigna un administrador activo antes de hacer visible esta cafetería."));
    mvc.perform(visibilityRequest(HIDE).with(as(userId)))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.code").value("VISIBILITY_STATE_CHANGED"));
    mvc.perform(visibilityRequest(HIDE).with(as(userId)))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.code").value("CAFETERIA_NOT_FOUND"));
    when(billing.changeBilling(any(), any(), any(), anyInt()))
        .thenThrow(
            CafeteriaSettingsException.billingChanged(),
            new CannotAcquireLockException("PRIVATE_DETAIL"));
    mvc.perform(billingRequest(FEE).with(as(userId)))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.code").value("BILLING_STATE_CHANGED"));
    mvc.perform(billingRequest(FEE).with(as(userId)))
        .andExpect(status().isServiceUnavailable())
        .andExpect(header().string("Retry-After", "5"))
        .andExpect(jsonPath("$.code").value("SUPER_ADMIN_TEMPORARILY_UNAVAILABLE"))
        .andExpect(
            content()
                .string(
                    org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("PRIVATE"))));
  }
}
