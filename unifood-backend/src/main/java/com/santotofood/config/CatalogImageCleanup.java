package com.santotofood.config;

import com.santotofood.application.service.AdminCatalogImageService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;

@Configuration
@EnableScheduling
@ConditionalOnProperty(name = "catalog.images.cleanup-enabled", havingValue = "true")
public class CatalogImageCleanup {
  private static final Logger LOG = LoggerFactory.getLogger(CatalogImageCleanup.class);
  private final AdminCatalogImageService images;

  public CatalogImageCleanup(AdminCatalogImageService images) {
    this.images = images;
  }

  @Scheduled(
      fixedDelayString = "${catalog.images.cleanup-delay-ms:600000}",
      initialDelayString = "${catalog.images.cleanup-delay-ms:600000}")
  public void run() {
    try {
      images.cleanup();
    } catch (RuntimeException e) {
      LOG.warn("Catalog image cleanup unavailable");
    }
  }
}
