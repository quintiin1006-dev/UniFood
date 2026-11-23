package com.santotofood.config;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.santotofood.adapter.in.web.AdminServiceFeeController;
import com.santotofood.adapter.in.web.SuperAdminCafeteriaController;
import com.santotofood.adapter.in.web.SuperAdminServiceFeeController;
import com.santotofood.adapter.in.web.error.GlobalExceptionHandler;
import com.santotofood.adapter.in.web.error.ServiceFeeExceptionHandler;
import com.santotofood.adapter.in.web.error.SuperAdminExceptionHandler;
import com.santotofood.application.exception.ServiceFeeException;
import com.santotofood.application.model.ServiceFeeMonth;
import com.santotofood.application.model.ServiceFeeOverview;
import com.santotofood.application.model.ServiceFeeStatement;
import com.santotofood.application.model.UserAuthorization;
import com.santotofood.application.port.in.ChangeCafeteriaBillingUseCase;
import com.santotofood.application.port.in.ChangeCafeteriaVisibilityUseCase;
import com.santotofood.application.port.in.GetOwnServiceFeeUseCase;
import com.santotofood.application.port.in.ListCafeteriaSettingsAuditUseCase;
import com.santotofood.application.port.in.ListSuperAdminCafeteriasUseCase;
import com.santotofood.application.port.in.ManageServiceFeeUseCase;
import com.santotofood.application.port.out.AuthorizationQueryPort;
import com.santotofood.application.port.out.ServiceFeeFlag;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.YearMonth;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
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
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;

/**
 * Real endpoints, method security and advice of the service fee (033); the use cases are stubbed.
 * Roles always come from the database facts, never from the JWT.
 */
@SpringJUnitWebConfig(
    classes = {
      SecurityConfig.class,
      OrderAuthorization.class,
      SuperAdminServiceFeeController.class,
      AdminServiceFeeController.class,
      SuperAdminCafeteriaController.class,
      ServiceFeeExceptionHandler.class,
      SuperAdminExceptionHandler.class,
      GlobalExceptionHandler.class,
      ServiceFeeAuthorizationTest.TestConfig.class
    })
class ServiceFeeAuthorizationTest {
  static final String ROOT = "/api/super-admin/service-fee";
  static final AtomicBoolean FLAG = new AtomicBoolean(true);
  @Autowired WebApplicationContext context;
  @Autowired AuthorizationQueryPort queries;
  @Autowired ManageServiceFeeUseCase manage;
  @Autowired GetOwnServiceFeeUseCase own;
  @Autowired ChangeCafeteriaBillingUseCase billing;
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
    ManageServiceFeeUseCase manage() {
      return mock(ManageServiceFeeUseCase.class);
    }

    @Bean
    GetOwnServiceFeeUseCase own() {
      return mock(GetOwnServiceFeeUseCase.class);
    }

    @Bean
    ServiceFeeFlag serviceFeeFlag() {
      return FLAG::get;
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
    FLAG.set(true);
    reset(queries, manage, own, billing);
    mvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
  }

  /** The JWT always claims SUPER_ADMIN: only the database facts may decide. */
  RequestPostProcessor as(UUID subject) {
    return jwt()
        .jwt(
            token ->
                token
                    .subject(subject.toString())
                    .claim("role", "SUPER_ADMIN")
                    .claim("app_metadata", java.util.Map.of("role", "SUPER_ADMIN")));
  }

  void facts(UserAuthorization user) {
    when(queries.findUserAuthorization(userId)).thenReturn(Optional.of(user));
  }

  void superAdmin() {
    facts(new UserAuthorization(true, Set.of("SUPER_ADMIN"), List.of()));
  }

  static ServiceFeeMonth.Row row(UUID cafeteria) {
    return new ServiceFeeMonth.Row(
        cafeteria,
        "=Cafetería \"Central\"",
        "Sede Principal",
        YearMonth.of(2026, 10),
        4,
        new BigDecimal("36000.00"),
        1200,
        ServiceFeeMonth.Status.PENDIENTE,
        Instant.parse("2026-11-01T12:00:00Z"),
        null,
        null,
        true,
        12,
        false);
  }

  @Test
  void anonymousRequestsAre401() throws Exception {
    mvc.perform(get(ROOT)).andExpect(status().isUnauthorized());
    mvc.perform(get("/api/admin/service-fee")).andExpect(status().isUnauthorized());
    verifyNoInteractions(manage, own);
  }

  @ParameterizedTest
  @ValueSource(strings = {"CLIENT", "WORKER", "ADMIN", "INACTIVE_SUPER_ADMIN", "MISSING"})
  void onlyAnActiveExclusiveSuperAdminReachesTheSuperAdminEndpoints(String identity)
      throws Exception {
    switch (identity) {
      case "CLIENT" -> facts(new UserAuthorization(true, Set.of("CLIENT"), List.of()));
      case "WORKER" -> facts(new UserAuthorization(true, Set.of("WORKER"), List.of(cafeteriaId)));
      case "ADMIN" -> facts(new UserAuthorization(true, Set.of("ADMIN"), List.of(cafeteriaId)));
      case "INACTIVE_SUPER_ADMIN" ->
          facts(new UserAuthorization(false, Set.of("SUPER_ADMIN"), List.of()));
      default -> when(queries.findUserAuthorization(userId)).thenReturn(Optional.empty());
    }
    mvc.perform(get(ROOT).with(as(userId)))
        .andExpect(status().isForbidden())
        .andExpect(header().string("Cache-Control", "no-store"))
        .andExpect(jsonPath("$.code").value("SERVICE_FEE_FORBIDDEN"));
    mvc.perform(
            put(ROOT + "/general")
                .with(as(userId))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"feeCop\":400,\"expectedVersion\":0}"))
        .andExpect(status().isForbidden());
    mvc.perform(post(ROOT + "/settlements/" + cafeteriaId + "/2026-10/close").with(as(userId)))
        .andExpect(status().isForbidden());
    mvc.perform(post(ROOT + "/settlements/" + cafeteriaId + "/2026-10/paid").with(as(userId)))
        .andExpect(status().isForbidden());
    mvc.perform(get(ROOT + "/settlements.csv").param("month", "2026-10").with(as(userId)))
        .andExpect(status().isForbidden());
    verifyNoInteractions(manage);
  }

  @Test
  void theSuperAdminChangesTheGeneralFeeWithStrictJson() throws Exception {
    superAdmin();
    when(manage.changeGeneralFee(userId, 400, 2))
        .thenReturn(
            new ServiceFeeOverview(
                new ServiceFeeOverview.General(400, 3, Instant.parse("2026-11-22T12:00:00Z")),
                List.of()));
    mvc.perform(
            put(ROOT + "/general")
                .with(as(userId))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"feeCop\":400,\"expectedVersion\":2}"))
        .andExpect(status().isOk())
        .andExpect(header().string("Cache-Control", "no-store"))
        .andExpect(jsonPath("$.general.feeCop").value(400))
        .andExpect(jsonPath("$.maxFeeCop").value(2000))
        .andExpect(jsonPath("$.graceDays").value(10));
    for (String body :
        new String[] {
          "{\"feeCop\":400.0,\"expectedVersion\":2}",
          "{\"feeCop\":\"400\",\"expectedVersion\":2}",
          "{\"feeCop\":null,\"expectedVersion\":2}",
          "{\"feeCop\":400}",
          "{\"feeCop\":400,\"expectedVersion\":2,\"cafeteriaId\":\"x\"}"
        })
      mvc.perform(
              put(ROOT + "/general")
                  .with(as(userId))
                  .contentType(MediaType.APPLICATION_JSON)
                  .content(body))
          .andExpect(status().isBadRequest())
          .andExpect(jsonPath("$.code").value("SERVICE_FEE_INVALID_REQUEST"));
    verify(manage, times(1))
        .changeGeneralFee(
            any(), org.mockito.ArgumentMatchers.anyInt(), org.mockito.ArgumentMatchers.anyInt());
  }

  @Test
  void aCafeteriaMayGoBackToTheGeneralFeeWithNull() throws Exception {
    superAdmin();
    when(manage.changeCafeteriaFee(userId, cafeteriaId, null, 1))
        .thenReturn(
            new ServiceFeeOverview(new ServiceFeeOverview.General(300, 0, null), List.of()));
    mvc.perform(
            put(ROOT + "/cafeterias/" + cafeteriaId)
                .with(as(userId))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"feeCop\":null,\"expectedVersion\":1}"))
        .andExpect(status().isOk());
    verify(manage).changeCafeteriaFee(userId, cafeteriaId, null, 1);
  }

  @Test
  void errorsOfTheUseCaseKeepTheirStatusAndAreNoStore() throws Exception {
    superAdmin();
    when(manage.closeMonth(userId, cafeteriaId, YearMonth.of(2026, 11)))
        .thenThrow(ServiceFeeException.monthOpen());
    mvc.perform(post(ROOT + "/settlements/" + cafeteriaId + "/2026-11/close").with(as(userId)))
        .andExpect(status().isConflict())
        .andExpect(header().string("Cache-Control", "no-store"))
        .andExpect(jsonPath("$.code").value("SERVICE_FEE_MONTH_OPEN"));
    when(manage.overview(userId)).thenThrow(ServiceFeeException.disabled());
    mvc.perform(get(ROOT).with(as(userId)))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.code").value("SERVICE_FEE_DISABLED"));
    mvc.perform(get(ROOT + "/settlements").param("month", "2026-13").with(as(userId)))
        .andExpect(status().isBadRequest());
    mvc.perform(post(ROOT + "/settlements/not-a-uuid/2026-10/close").with(as(userId)))
        .andExpect(status().isBadRequest());
  }

  @Test
  void theCsvIsAnAttachmentWithEscapedCellsAndNoStore() throws Exception {
    superAdmin();
    when(manage.month(userId, YearMonth.of(2026, 10)))
        .thenReturn(new ServiceFeeMonth(YearMonth.of(2026, 10), false, List.of(row(cafeteriaId))));
    var result =
        mvc.perform(get(ROOT + "/settlements.csv").param("month", "2026-10").with(as(userId)))
            .andExpect(status().isOk())
            .andExpect(header().string("Cache-Control", "no-store"))
            .andExpect(header().string("Content-Type", "text/csv;charset=UTF-8"))
            .andExpect(
                header()
                    .string(
                        "Content-Disposition",
                        "attachment; filename=\"cargo-por-servicio-2026-10.csv\""))
            .andReturn();
    var text = result.getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
    assertTrue(text.startsWith("﻿cafeteria,sede,mes,"), text);
    // A formula-looking name is neutralized and its quotes doubled.
    assertTrue(text.contains("\"'=Cafetería \"\"Central\"\"\""), text);
    assertTrue(text.contains(",2026-10,4,36000.00,1200,PENDIENTE,SI,12,"), text);
  }

  @Test
  void anAdminReadsTheirOwnCafeteriaAndCannotNameAnother() throws Exception {
    facts(new UserAuthorization(true, Set.of("ADMIN"), List.of(cafeteriaId)));
    when(own.statement(userId))
        .thenReturn(
            new ServiceFeeStatement(
                cafeteriaId, "Cafetería Central", 300, List.of(row(cafeteriaId))));
    mvc.perform(
            get("/api/admin/service-fee")
                .with(as(userId))
                .param("cafeteriaId", UUID.randomUUID().toString()))
        .andExpect(status().isOk())
        .andExpect(header().string("Cache-Control", "no-store"))
        .andExpect(jsonPath("$.cafeteriaId").value(cafeteriaId.toString()))
        .andExpect(jsonPath("$.currentFeeCop").value(300))
        .andExpect(jsonPath("$.months[0].overdue").value(true))
        .andExpect(jsonPath("$.months[0].daysOverdue").value(12));
    // The use case only ever receives the verified subject.
    verify(own).statement(userId);
    when(own.statement(userId)).thenThrow(ServiceFeeException.forbidden());
    mvc.perform(get("/api/admin/service-fee").with(as(userId)))
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.code").value("SERVICE_FEE_FORBIDDEN"));
  }

  @Test
  void withTheFlagOnTheOldBillingEndpointIs410AndWritesNothing() throws Exception {
    superAdmin();
    mvc.perform(
            put("/api/super-admin/cafeterias/" + cafeteriaId + "/billing")
                .with(as(userId))
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    "{\"model\":\"NONE\",\"perOrderFeeCop\":null,\"subscriptionFeeCop\":null,\"expectedVersion\":0}"))
        .andExpect(status().isGone())
        .andExpect(header().string("Cache-Control", "no-store"))
        .andExpect(jsonPath("$.code").value("BILLING_DEPRECATED"));
    verifyNoInteractions(billing);
    // Off: the previous behavior is untouched.
    FLAG.set(false);
    mvc.perform(
            put("/api/super-admin/cafeterias/" + cafeteriaId + "/billing")
                .with(as(userId))
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    "{\"model\":\"NONE\",\"perOrderFeeCop\":null,\"subscriptionFeeCop\":null,\"expectedVersion\":0}"))
        .andExpect(status().is(org.hamcrest.Matchers.not(410)));
    verify(billing).changeBilling(any(), any(), any(), org.mockito.ArgumentMatchers.anyInt());
  }
}
