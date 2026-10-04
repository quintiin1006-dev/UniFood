package com.santotofood.config;

import java.net.URI;
import java.net.URISyntaxException;
import org.springframework.beans.factory.config.BeanFactoryPostProcessor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;

/** Validate effective configuration before persistence or JWT clients are initialized. */
@Configuration(proxyBeanMethods = false)
public class EnvironmentConfiguration {

  @Bean
  static BeanFactoryPostProcessor validateRequiredEnvironment(Environment environment) {
    return beanFactory -> {
      String databaseUrl =
          requiredProperty(environment, "spring.datasource.url", "SUPABASE_DB_URL");
      if (!databaseUrl.startsWith("jdbc:postgresql:") || !databaseUrl.equals(databaseUrl.trim())) {
        throw invalid("SUPABASE_DB_URL", "must be a PostgreSQL JDBC URL");
      }

      String issuer =
          requiredProperty(
              environment,
              "spring.security.oauth2.resourceserver.jwt.issuer-uri",
              "SUPABASE_AUTH_ISSUER");
      try {
        URI uri = new URI(issuer);
        if (!("http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme()))
            || uri.getHost() == null
            || uri.getUserInfo() != null
            || uri.getRawQuery() != null
            || uri.getRawFragment() != null) {
          throw invalid("SUPABASE_AUTH_ISSUER", "must be an HTTP(S) issuer URL");
        }
      } catch (URISyntaxException exception) {
        // Discard the parse exception: its message can contain the supplied value.
        throw invalid("SUPABASE_AUTH_ISSUER", "must be an HTTP(S) issuer URL");
      }
    };
  }

  private static String requiredProperty(
      Environment environment, String property, String variable) {
    final String value;
    try {
      value = environment.getProperty(property);
    } catch (IllegalArgumentException exception) {
      throw invalid(variable, "is required");
    }
    if (value == null || value.isBlank()) {
      throw invalid(variable, "is required");
    }
    return value;
  }

  private static IllegalStateException invalid(String variable, String requirement) {
    return new IllegalStateException("Configuration error: " + variable + " " + requirement + ".");
  }
}
