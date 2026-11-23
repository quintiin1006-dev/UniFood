package com.santotofood.config;

import com.santotofood.application.port.out.ServiceFeeFlag;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Feature flag of the service fee (docs/modelo-de-negocio.md). {@code service.fee.enabled} comes
 * from SERVICE_FEE_ENABLED and is off by default; a value that is not a boolean fails at startup.
 */
@Configuration
public class ServiceFeeConfiguration {

  public record ServiceFeeFeature(boolean enabled) implements ServiceFeeFlag {}

  @Bean
  ServiceFeeFeature serviceFeeFeature(@Value("${service.fee.enabled:false}") boolean enabled) {
    return new ServiceFeeFeature(enabled);
  }
}
