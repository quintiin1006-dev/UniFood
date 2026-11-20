package com.santotofood.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Feature flag of the dynamic daily menu (docs/propuesta-menu-dinamico.md, section 3.1). {@code
 * menu.dinamico.enabled} comes from MENU_DINAMICO_ENABLED and is off by default. Only the reading
 * exists for now: no endpoint or order rule depends on it yet. A value that is not a boolean fails
 * at startup.
 */
@Configuration
public class DailyMenuConfiguration {

  /** Whether the dynamic daily menu is enabled on this server. */
  public record DailyMenuFeature(boolean enabled) {}

  @Bean
  DailyMenuFeature dailyMenuFeature(@Value("${menu.dinamico.enabled:false}") boolean enabled) {
    return new DailyMenuFeature(enabled);
  }
}
