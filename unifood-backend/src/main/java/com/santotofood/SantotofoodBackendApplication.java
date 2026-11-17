package com.santotofood;

import com.santotofood.config.StagingProjectGuard;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class SantotofoodBackendApplication {

  public static void main(String[] args) {
    try {
      // Before Spring creates the datasource: a staging process never touches another project.
      StagingProjectGuard.verify(System.getenv());
    } catch (IllegalStateException refused) {
      System.err.println(refused.getMessage());
      System.exit(1);
    }
    SpringApplication.run(SantotofoodBackendApplication.class, args);
  }
}
