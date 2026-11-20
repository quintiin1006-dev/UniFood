package com.santotofood.config;

import static org.assertj.core.api.Assertions.assertThat;

import com.santotofood.config.DailyMenuConfiguration.DailyMenuFeature;
import java.io.IOException;
import java.io.UncheckedIOException;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.core.io.support.ResourcePropertySource;

class DailyMenuConfigurationTest {
  private final ApplicationContextRunner runner =
      new ApplicationContextRunner()
          .withUserConfiguration(DailyMenuConfiguration.class)
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
  void offWithoutTheVariable() {
    runner.run(
        context -> {
          assertThat(context).hasNotFailed();
          assertThat(context.getBean(DailyMenuFeature.class).enabled()).isFalse();
        });
  }

  @Test
  void readsMenuDinamicoEnabled() {
    runner
        .withPropertyValues("MENU_DINAMICO_ENABLED=true")
        .run(context -> assertThat(context.getBean(DailyMenuFeature.class).enabled()).isTrue());
    runner
        .withPropertyValues("MENU_DINAMICO_ENABLED=false")
        .run(context -> assertThat(context.getBean(DailyMenuFeature.class).enabled()).isFalse());
  }

  @Test
  void aValueThatIsNotBooleanFailsAtStartup() {
    runner
        .withPropertyValues("MENU_DINAMICO_ENABLED=quizas")
        .run(context -> assertThat(context).hasFailed());
  }
}
