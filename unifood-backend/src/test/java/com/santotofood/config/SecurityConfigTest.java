package com.santotofood.config;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.oauth2.jwt.BadJwtException;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.context.junit.jupiter.web.SpringJUnitWebConfig;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.context.WebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;

@SpringJUnitWebConfig(
    classes = {SecurityConfig.class, OrderAuthorization.class, SecurityConfigTest.TestConfig.class})
class SecurityConfigTest {
  @Autowired WebApplicationContext context;
  @Autowired JdbcTemplate jdbc;
  @Autowired JwtDecoder decoder;
  MockMvc mvc;
  final UUID userId = UUID.randomUUID();
  final UUID cafeteriaId = UUID.randomUUID();
  final UUID orderId = UUID.randomUUID();

  @Configuration
  @EnableWebMvc
  static class TestConfig {
    @Bean
    JdbcTemplate jdbcTemplate() {
      return mock(JdbcTemplate.class);
    }

    @Bean
    JwtDecoder jwtDecoder() {
      return mock(JwtDecoder.class);
    }

    @Bean
    Probe probe() {
      return new Probe();
    }
  }

  @RestController
  static class Probe {
    @GetMapping("/test/cafeterias/{id}")
    @PreAuthorize("@orderAuthorization.cafeteria(authentication, #id)")
    String cafeteria(@PathVariable UUID id) {
      return "ok";
    }

    @GetMapping("/test/orders/{id}")
    @PreAuthorize("@orderAuthorization.order(authentication, #id)")
    String order(@PathVariable UUID id) {
      return "ok";
    }
  }

  @BeforeEach
  void setup() {
    reset(jdbc, decoder);
    mvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
  }

  @Test
  void anonymousAndInvalidTokensAreRejected() throws Exception {
    mvc.perform(get("/test/cafeterias/" + cafeteriaId)).andExpect(status().isUnauthorized());
    when(decoder.decode("invalid")).thenThrow(new BadJwtException("Invalid signature"));
    mvc.perform(get("/test/cafeterias/" + cafeteriaId).header("Authorization", "Bearer invalid"))
        .andExpect(status().isUnauthorized());
    verifyNoInteractions(jdbc);
  }

  @Test
  void databasePermissionsOverrideAnyTokenRole() throws Exception {
    when(jdbc.queryForList(anyString(), eq(UUID.class), eq(userId))).thenReturn(List.of());
    mvc.perform(
            get("/test/cafeterias/" + cafeteriaId)
                .with(
                    jwt()
                        .jwt(
                            j ->
                                j.subject(userId.toString())
                                    .claim(
                                        "user_metadata", java.util.Map.of("role", "SUPER_ADMIN")))))
        .andExpect(status().isForbidden());
    when(jdbc.queryForList(anyString(), eq(UUID.class), eq(userId)))
        .thenReturn(List.of(cafeteriaId));
    mvc.perform(
            get("/test/cafeterias/" + cafeteriaId)
                .with(jwt().jwt(j -> j.subject(userId.toString()))))
        .andExpect(status().isOk());
  }

  @Test
  void orderActionsCheckTheOrdersActualCafeteria() throws Exception {
    when(jdbc.queryForList(anyString(), eq(UUID.class), eq(orderId)))
        .thenReturn(List.of(cafeteriaId));
    when(jdbc.queryForList(anyString(), eq(UUID.class), eq(userId)))
        .thenReturn(List.of(UUID.randomUUID()));
    mvc.perform(get("/test/orders/" + orderId).with(jwt().jwt(j -> j.subject(userId.toString()))))
        .andExpect(status().isForbidden());
    verify(jdbc).queryForList(anyString(), eq(UUID.class), eq(userId));
    when(jdbc.queryForList(anyString(), eq(UUID.class), eq(orderId))).thenReturn(List.of());
    mvc.perform(get("/test/orders/" + orderId).with(jwt().jwt(j -> j.subject(userId.toString()))))
        .andExpect(status().isForbidden());
  }
}
