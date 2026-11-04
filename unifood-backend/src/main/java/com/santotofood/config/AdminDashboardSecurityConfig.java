package com.santotofood.config;

import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.time.Instant;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.Order;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.web.cors.CorsConfigurationSource;

/** Route-scoped headers/errors; authentication still uses the shared Resource Server decoder. */
@Configuration
public class AdminDashboardSecurityConfig {
  @Bean
  @Order(1)
  public SecurityFilterChain adminDashboardSecurityFilterChain(
      HttpSecurity http,
      @org.springframework.beans.factory.annotation.Qualifier("corsConfigurationSource")
          CorsConfigurationSource corsConfigurationSource)
      throws Exception {
    http.securityMatcher("/api/admin/dashboard", "/api/admin/dashboard/")
        .csrf(AbstractHttpConfigurer::disable)
        .cors(cors -> cors.configurationSource(corsConfigurationSource))
        .headers(
            headers ->
                headers.addHeaderWriter(
                    (request, response) -> response.setHeader("Cache-Control", "no-store")))
        .authorizeHttpRequests(
            auth ->
                auth.requestMatchers(org.springframework.http.HttpMethod.OPTIONS, "/**")
                    .permitAll()
                    .anyRequest()
                    .authenticated())
        .sessionManagement(
            session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
        .exceptionHandling(
            errors ->
                errors
                    .authenticationEntryPoint((request, response, cause) -> error(response, 401))
                    .accessDeniedHandler((request, response, cause) -> error(response, 403)))
        .oauth2ResourceServer(
            oauth ->
                oauth
                    .jwt(Customizer.withDefaults())
                    .authenticationEntryPoint((request, response, cause) -> error(response, 401)))
        .httpBasic(AbstractHttpConfigurer::disable)
        .formLogin(AbstractHttpConfigurer::disable)
        .logout(AbstractHttpConfigurer::disable);
    return http.build();
  }

  private static void error(HttpServletResponse response, int status) throws IOException {
    response.setStatus(status);
    response.setHeader("Cache-Control", "no-store");
    if (status == 401) response.setHeader("WWW-Authenticate", "Bearer");
    response.setContentType("application/json");
    response.setCharacterEncoding("UTF-8");
    // Only fixed public values; never serialize the authentication exception.
    response
        .getWriter()
        .write(
            "{\"status\":"
                + status
                + ",\"code\":\""
                + (status == 401 ? "UNAUTHORIZED" : "ADMIN_DASHBOARD_FORBIDDEN")
                + "\",\"message\":\"Acceso no autorizado.\",\"timestamp\":\""
                + Instant.now()
                + "\",\"path\":\"/api/admin/dashboard\"}");
  }
}
