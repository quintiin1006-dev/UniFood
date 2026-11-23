package com.santotofood.config;

import com.santotofood.application.port.out.OrderNoticesFlag;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Feature flag of the bell inbox. {@code avisos.bandeja.enabled} comes from AVISOS_BANDEJA_ENABLED
 * and is off by default; a value that is not a boolean fails at startup. Turn it on only after
 * migration 034 is applied.
 */
@Configuration
public class OrderNoticesConfiguration {

  public record OrderNoticesFeature(boolean enabled) implements OrderNoticesFlag {}

  @Bean
  OrderNoticesFeature orderNoticesFeature(
      @Value("${avisos.bandeja.enabled:false}") boolean enabled) {
    return new OrderNoticesFeature(enabled);
  }
}
