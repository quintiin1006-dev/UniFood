package com.santotofood.config;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.santotofood.application.model.UserAuthorization;
import com.santotofood.application.port.out.AuthorizationQueryPort;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
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
  @Autowired AuthorizationQueryPort queries;
  @Autowired JwtDecoder decoder;
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

  private Optional<UserAuthorization> worker(List<UUID> cafeterias) {
    return Optional.of(new UserAuthorization(true, Set.of("WORKER"), cafeterias));
  }

  @BeforeEach
  void setup() {
    reset(queries, decoder);
    mvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
  }

  @Test
  void anonymousAndInvalidTokensAreRejected() throws Exception {
    mvc.perform(get("/test/cafeterias/" + cafeteriaId)).andExpect(status().isUnauthorized());
    when(decoder.decode("invalid")).thenThrow(new BadJwtException("Invalid signature"));
    mvc.perform(get("/test/cafeterias/" + cafeteriaId).header("Authorization", "Bearer invalid"))
        .andExpect(status().isUnauthorized());
    verifyNoInteractions(queries);
  }

  @Test
  void databasePermissionsOverrideAnyTokenRole() throws Exception {
    when(queries.findUserAuthorization(userId)).thenReturn(Optional.empty());
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
    when(queries.findUserAuthorization(userId)).thenReturn(worker(List.of(cafeteriaId)));
    mvc.perform(
            get("/test/cafeterias/" + cafeteriaId)
                .with(jwt().jwt(j -> j.subject(userId.toString()))))
        .andExpect(status().isOk());
  }

  @Test
  void orderActionsCheckTheOrdersActualCafeteria() throws Exception {
    when(queries.findOrderCafeteria(orderId)).thenReturn(Optional.of(cafeteriaId));
    when(queries.findUserAuthorization(userId)).thenReturn(worker(List.of(UUID.randomUUID())));
    mvc.perform(get("/test/orders/" + orderId).with(jwt().jwt(j -> j.subject(userId.toString()))))
        .andExpect(status().isForbidden());
    verify(queries).findUserAuthorization(userId);
    when(queries.findOrderCafeteria(orderId)).thenReturn(Optional.empty());
    mvc.perform(get("/test/orders/" + orderId).with(jwt().jwt(j -> j.subject(userId.toString()))))
        .andExpect(status().isForbidden());
  }
}
