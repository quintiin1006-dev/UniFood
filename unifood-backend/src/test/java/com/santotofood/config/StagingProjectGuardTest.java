package com.santotofood.config;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;

class StagingProjectGuardTest {

  static final String STAGING_REF = "stgrefabcdefghijklmn";
  static final String PROD_REF = "prdrefzyxwvutsrqponml";
  static final String DIRECT = "jdbc:postgresql://db." + STAGING_REF + ".supabase.co:5432/postgres";
  static final String POOLER =
      "jdbc:postgresql://aws-1-us-west-2.pooler.supabase.com:5432/postgres";

  @Test
  void nonStagingProfilesAreNotChecked() {
    Map<String, String> env = env("SUPABASE_DB_URL", DIRECT.replace(STAGING_REF, PROD_REF));
    assertDoesNotThrow(() -> StagingProjectGuard.verify(env));
    env.put("SPRING_PROFILES_ACTIVE", "production");
    assertDoesNotThrow(() -> StagingProjectGuard.verify(env));
  }

  @Test
  void stagingWithoutExpectedProjectIsRefused() {
    Map<String, String> env = env("SUPABASE_DB_URL", DIRECT);
    env.put("SPRING_PROFILES_ACTIVE", "staging");
    IllegalStateException error =
        assertThrows(IllegalStateException.class, () -> StagingProjectGuard.verify(env));
    assertTrue(error.getMessage().contains("UNIFOOD_EXPECTED_PROJECT_REF"));
  }

  @Test
  void stagingWithMatchingDirectHostStarts() {
    assertDoesNotThrow(() -> StagingProjectGuard.verify(staging(DIRECT, null, STAGING_REF)));
  }

  @Test
  void stagingWithMatchingPoolerUsernameStarts() {
    assertDoesNotThrow(
        () -> StagingProjectGuard.verify(staging(POOLER, "postgres." + STAGING_REF, STAGING_REF)));
  }

  @Test
  void stagingWithMatchingPoolerUserParameterStarts() {
    String url = POOLER + "?user=postgres." + STAGING_REF;
    assertDoesNotThrow(() -> StagingProjectGuard.verify(staging(url, null, STAGING_REF)));
  }

  @Test
  void productionDirectHostIsRefused() {
    String url = DIRECT.replace(STAGING_REF, PROD_REF);
    IllegalStateException error =
        assertThrows(
            IllegalStateException.class,
            () -> StagingProjectGuard.verify(staging(url, null, STAGING_REF)));
    assertTrue(error.getMessage().contains("proyecto esperado"));
    assertFalse(error.getMessage().contains(PROD_REF), "Must not echo configuration values");
  }

  @Test
  void productionPoolerUsernameIsRefused() {
    assertThrows(
        IllegalStateException.class,
        () -> StagingProjectGuard.verify(staging(POOLER, "postgres." + PROD_REF, STAGING_REF)));
  }

  @Test
  void datasourceUrlOverrideToOtherProjectIsRefused() {
    Map<String, String> env = staging(DIRECT, null, STAGING_REF);
    env.put("SPRING_DATASOURCE_URL", DIRECT.replace(STAGING_REF, PROD_REF));
    assertThrows(IllegalStateException.class, () -> StagingProjectGuard.verify(env));
  }

  @Test
  void localDatabaseWithoutProjectReferenceIsRefused() {
    Map<String, String> env =
        staging("jdbc:postgresql://localhost:5432/unifood", "postgres", STAGING_REF);
    IllegalStateException error =
        assertThrows(IllegalStateException.class, () -> StagingProjectGuard.verify(env));
    assertTrue(error.getMessage().contains("no se pudo identificar"));
  }

  @Test
  void multipleHostsAreRefused() {
    String url =
        "jdbc:postgresql://db."
            + STAGING_REF
            + ".supabase.co:5432,db."
            + PROD_REF
            + ".supabase.co:5432/postgres";
    assertThrows(
        IllegalStateException.class,
        () -> StagingProjectGuard.verify(staging(url, null, STAGING_REF)));
  }

  @Test
  void profileListContainingStagingIsChecked() {
    Map<String, String> env = staging(DIRECT.replace(STAGING_REF, PROD_REF), null, STAGING_REF);
    env.put("SPRING_PROFILES_ACTIVE", "monitoring, staging");
    assertThrows(IllegalStateException.class, () -> StagingProjectGuard.verify(env));
  }

  @Test
  void storageUrlOfAnotherProjectIsRefused() {
    Map<String, String> env = staging(DIRECT, null, STAGING_REF);
    env.put("SUPABASE_STORAGE_URL", "https://" + PROD_REF + ".supabase.co/storage/v1");
    IllegalStateException error =
        assertThrows(IllegalStateException.class, () -> StagingProjectGuard.verify(env));
    assertTrue(error.getMessage().contains("SUPABASE_STORAGE_URL"));
    assertFalse(error.getMessage().contains(PROD_REF), "Must not echo configuration values");
  }

  @Test
  void storageUrlOfExpectedProjectStarts() {
    Map<String, String> env = staging(DIRECT, null, STAGING_REF);
    env.put("SUPABASE_STORAGE_URL", "https://" + STAGING_REF + ".supabase.co/storage/v1");
    assertDoesNotThrow(() -> StagingProjectGuard.verify(env));
  }

  @Test
  void blankStorageUrlStarts() {
    Map<String, String> env = staging(DIRECT, null, STAGING_REF);
    env.put("SUPABASE_STORAGE_URL", "  ");
    assertDoesNotThrow(() -> StagingProjectGuard.verify(env));
  }

  @Test
  void storageUrlOnCustomDomainIsRefused() {
    Map<String, String> env = staging(DIRECT, null, STAGING_REF);
    env.put("SUPABASE_STORAGE_URL", "https://files.example.org/storage/v1");
    assertThrows(IllegalStateException.class, () -> StagingProjectGuard.verify(env));
  }

  @Test
  void authIssuerOfAnotherProjectIsRefused() {
    Map<String, String> env = staging(DIRECT, null, STAGING_REF);
    env.put("SUPABASE_AUTH_ISSUER", "https://" + PROD_REF + ".supabase.co/auth/v1");
    IllegalStateException error =
        assertThrows(IllegalStateException.class, () -> StagingProjectGuard.verify(env));
    assertTrue(error.getMessage().contains("SUPABASE_AUTH_ISSUER"));
    assertFalse(error.getMessage().contains(PROD_REF), "Must not echo configuration values");
  }

  @Test
  void authIssuerOfExpectedProjectStarts() {
    Map<String, String> env = staging(DIRECT, null, STAGING_REF);
    env.put("SUPABASE_AUTH_ISSUER", "https://" + STAGING_REF + ".supabase.co/auth/v1");
    assertDoesNotThrow(() -> StagingProjectGuard.verify(env));
  }

  @Test
  void authIssuerWithoutSupabaseHostIsRefused() {
    Map<String, String> env = staging(DIRECT, null, STAGING_REF);
    env.put("SUPABASE_AUTH_ISSUER", "http://localhost:54321/auth/v1");
    assertThrows(IllegalStateException.class, () -> StagingProjectGuard.verify(env));
  }

  @Test
  void unparseableStorageUrlIsRefused() {
    Map<String, String> env = staging(DIRECT, null, STAGING_REF);
    env.put("SUPABASE_STORAGE_URL", "https://bad host.supabase.co/storage/v1");
    assertThrows(IllegalStateException.class, () -> StagingProjectGuard.verify(env));
  }

  @Test
  void nonStagingIgnoresOtherSupabaseUrls() {
    Map<String, String> env =
        env("SUPABASE_STORAGE_URL", "https://" + PROD_REF + ".supabase.co/storage/v1");
    assertDoesNotThrow(() -> StagingProjectGuard.verify(env));
  }

  private static Map<String, String> staging(String dbUrl, String username, String expectedRef) {
    Map<String, String> env = env("SUPABASE_DB_URL", dbUrl);
    env.put("SPRING_PROFILES_ACTIVE", "staging");
    env.put("UNIFOOD_EXPECTED_PROJECT_REF", expectedRef);
    if (username != null) {
      env.put("SPRING_DATASOURCE_USERNAME", username);
    }
    return env;
  }

  private static Map<String, String> env(String key, String value) {
    Map<String, String> env = new HashMap<>();
    env.put(key, value);
    return env;
  }
}
