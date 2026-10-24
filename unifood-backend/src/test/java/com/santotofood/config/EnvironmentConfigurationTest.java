package com.santotofood.config;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.core.env.SystemEnvironmentPropertySource;
import org.springframework.core.io.support.ResourcePropertySource;

class EnvironmentConfigurationTest {

  @Test
  void processEnvironmentBindsRealBackendPropertiesWithoutInterpretingSpecialCharacters() {
    Map<String, Object> variables =
        Map.ofEntries(
            Map.entry(
                "SUPABASE_DB_URL",
                "jdbc:postgresql://127.0.0.1:1/fixture?sslmode=require&label=first=second?third"),
            Map.entry("SUPABASE_AUTH_ISSUER", "https://auth.example.invalid/auth/v1"),
            Map.entry("SPRING_DATASOURCE_USERNAME", "fixture_user"),
            Map.entry("SPRING_DATASOURCE_PASSWORD", "fixture-password=a&b?c#d"),
            Map.entry("SUPABASE_STORAGE_URL", "https://storage.example.invalid/storage/v1"),
            Map.entry("SUPABASE_STORAGE_SECRET_KEY", "fixture-storage-secret=a&b?c#d"),
            Map.entry("SUPABASE_PRODUCT_IMAGES_BUCKET", "product-images"),
            Map.entry("PRODUCT_IMAGES_CONNECT_TIMEOUT_SECONDS", "5"),
            Map.entry("PRODUCT_IMAGES_OPERATION_TIMEOUT_SECONDS", "20"),
            Map.entry("PRODUCT_IMAGES_CLEANUP_ENABLED", "false"));
    runner
        .withInitializer(
            context ->
                context
                    .getEnvironment()
                    .getPropertySources()
                    .addFirst(
                        new SystemEnvironmentPropertySource(
                            "isolated-process-environment", variables)))
        .run(
            context -> {
              assertThat(context).hasNotFailed();
              var environment = context.getEnvironment();
              Map<String, String> mapping =
                  Map.ofEntries(
                      Map.entry("spring.datasource.url", "SUPABASE_DB_URL"),
                      Map.entry(
                          "spring.security.oauth2.resourceserver.jwt.issuer-uri",
                          "SUPABASE_AUTH_ISSUER"),
                      Map.entry("spring.datasource.username", "SPRING_DATASOURCE_USERNAME"),
                      Map.entry("spring.datasource.password", "SPRING_DATASOURCE_PASSWORD"),
                      Map.entry("catalog.images.storage-url", "SUPABASE_STORAGE_URL"),
                      Map.entry("catalog.images.storage-secret", "SUPABASE_STORAGE_SECRET_KEY"),
                      Map.entry("catalog.images.bucket", "SUPABASE_PRODUCT_IMAGES_BUCKET"),
                      Map.entry(
                          "catalog.images.connect-timeout-seconds",
                          "PRODUCT_IMAGES_CONNECT_TIMEOUT_SECONDS"),
                      Map.entry(
                          "catalog.images.operation-timeout-seconds",
                          "PRODUCT_IMAGES_OPERATION_TIMEOUT_SECONDS"),
                      Map.entry(
                          "catalog.images.cleanup-enabled", "PRODUCT_IMAGES_CLEANUP_ENABLED"));
              mapping.forEach(
                  (property, variable) ->
                      assertThat(environment.getRequiredProperty(property))
                          .isEqualTo(variables.get(variable)));
            });
  }

  @Test
  void storageDefaultsRemainUnchangedWhenNoStorageEnvironmentIsConfigured() {
    runner
        .withPropertyValues(
            "SUPABASE_DB_URL=jdbc:postgresql://127.0.0.1:1/fixture",
            "SUPABASE_AUTH_ISSUER=http://127.0.0.1:1/auth/v1")
        .run(
            context -> {
              assertThat(context).hasNotFailed();
              var environment = context.getEnvironment();
              assertThat(environment.getProperty("catalog.images.storage-url")).isEmpty();
              assertThat(environment.getProperty("catalog.images.storage-secret")).isEmpty();
              assertThat(environment.getProperty("catalog.images.bucket"))
                  .isEqualTo("product-images");
              assertThat(environment.getProperty("catalog.images.connect-timeout-seconds"))
                  .isEqualTo("5");
              assertThat(environment.getProperty("catalog.images.operation-timeout-seconds"))
                  .isEqualTo("20");
              assertThat(environment.getProperty("catalog.images.cleanup-enabled"))
                  .isEqualTo("true");
            });
  }

  private final ApplicationContextRunner runner =
      new ApplicationContextRunner()
          .withUserConfiguration(EnvironmentConfiguration.class)
          .withInitializer(
              context -> {
                var sources = context.getEnvironment().getPropertySources();
                sources.remove(StandardEnvironment.SYSTEM_ENVIRONMENT_PROPERTY_SOURCE_NAME);
                sources.remove(StandardEnvironment.SYSTEM_PROPERTIES_PROPERTY_SOURCE_NAME);
                try {
                  sources.addLast(new ResourcePropertySource("classpath:application.properties"));
                } catch (IOException exception) {
                  throw new UncheckedIOException(exception);
                }
              });

  @Test
  void missingConfigurationFailsBeforeExternalClientsAreInitialized() {
    AtomicBoolean clientInitialized = new AtomicBoolean();
    runner
        .withBean(
            "externalClient",
            Object.class,
            () -> {
              clientInitialized.set(true);
              return new Object();
            })
        .run(
            context -> {
              assertThat(context).hasFailed();
              assertThat(context.getStartupFailure())
                  .hasMessage("Configuration error: SUPABASE_DB_URL is required.");
              assertThat(clientInitialized).isFalse();
            });
  }

  @Test
  void issuerHasNoFallback() {
    runner
        .withPropertyValues("SUPABASE_DB_URL=jdbc:postgresql://127.0.0.1:1/unifood_test")
        .run(
            context -> {
              assertThat(context).hasFailed();
              assertThat(context.getStartupFailure())
                  .hasMessage("Configuration error: SUPABASE_AUTH_ISSUER is required.");
            });
  }

  @Test
  void blankVariablesAreRejectedInEveryEnvironment() {
    for (String profile : new String[] {"dev", "staging", "production"}) {
      for (String variable : new String[] {"SUPABASE_DB_URL", "SUPABASE_AUTH_ISSUER"}) {
        runner
            .withPropertyValues(
                "spring.profiles.active=" + profile,
                "SUPABASE_DB_URL=jdbc:postgresql://127.0.0.1:1/unifood_test",
                "SUPABASE_AUTH_ISSUER=http://127.0.0.1:1/auth/v1",
                variable + "=   ")
            .run(
                context -> {
                  assertThat(context).hasFailed();
                  assertThat(context.getStartupFailure())
                      .hasMessage("Configuration error: " + variable + " is required.");
                });
      }
    }
  }

  @Test
  void validExternalConfigurationWorksWithoutSelectingAProfile() {
    runner
        .withPropertyValues(
            "SUPABASE_DB_URL=jdbc:postgresql://127.0.0.1:1/unifood_test",
            "SUPABASE_AUTH_ISSUER=http://127.0.0.1:1/auth/v1")
        .run(
            context -> {
              assertThat(context).hasNotFailed();
              assertThat(context.getEnvironment().getActiveProfiles()).isEmpty();
              assertThat(
                      context
                          .getEnvironment()
                          .getProperty("spring.security.oauth2.resourceserver.jwt.audiences"))
                  .isEqualTo("authenticated");
            });
  }

  @Test
  void malformedConfigurationDoesNotExposeSuppliedValues() {
    for (String databaseUrl :
        new String[] {"configuration-secret", "https://user:configuration-secret@db.test"}) {
      runner
          .withPropertyValues(
              "SUPABASE_DB_URL=" + databaseUrl, "SUPABASE_AUTH_ISSUER=https://auth.test/auth/v1")
          .run(
              context -> {
                assertThat(context).hasFailed();
                assertThat(context.getStartupFailure())
                    .hasMessage(
                        "Configuration error: SUPABASE_DB_URL must be a PostgreSQL JDBC URL.");
                assertThat(context.getStartupFailure().getCause()).isNull();
              });
    }
    for (String issuer :
        new String[] {
          "configuration-secret",
          "https://[configuration-secret",
          "https://user:configuration-secret@auth.test/auth/v1",
          "https://auth.test/auth/v1?key=configuration-secret",
          "https://auth.test/auth/v1#configuration-secret"
        }) {
      runner
          .withPropertyValues(
              "SUPABASE_DB_URL=jdbc:postgresql://127.0.0.1:1/unifood_test",
              "SUPABASE_AUTH_ISSUER=" + issuer)
          .run(
              context -> {
                assertThat(context).hasFailed();
                assertThat(context.getStartupFailure())
                    .hasMessage(
                        "Configuration error: SUPABASE_AUTH_ISSUER must be an HTTP(S) issuer URL.");
                assertThat(context.getStartupFailure().getCause()).isNull();
              });
    }
  }
}
