package com.santotofood.config;

import java.net.URI;
import java.net.URISyntaxException;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Refuses to start the staging profile when its database points at another Supabase project.
 *
 * <p>Runs before Spring starts, from the process environment only. Fail-closed: with the staging
 * profile, a missing expected reference, an unreadable URL or a URL without a project reference
 * stops the start. Error messages never include configuration values.
 */
public final class StagingProjectGuard {

  public static final String STAGING_PROFILE = "staging";
  public static final String EXPECTED_PROJECT_REF = "UNIFOOD_EXPECTED_PROJECT_REF";

  private static final String PROFILES = "SPRING_PROFILES_ACTIVE";
  private static final String DB_URL = "SUPABASE_DB_URL";
  private static final String DATASOURCE_URL = "SPRING_DATASOURCE_URL";
  private static final String DATASOURCE_USERNAME = "SPRING_DATASOURCE_USERNAME";
  private static final String AUTH_ISSUER = "SUPABASE_AUTH_ISSUER";
  private static final String STORAGE_URL = "SUPABASE_STORAGE_URL";
  private static final String JDBC_PREFIX = "jdbc:postgresql://";

  // Direct connection: db.<ref>.supabase.co
  private static final Pattern DIRECT_HOST = Pattern.compile("db\\.([a-z0-9]+)\\.supabase\\.co");
  // Project API host of any Supabase URL (Auth issuer, Storage): <ref>.supabase.co
  private static final Pattern SUPABASE_HOST = Pattern.compile("([a-z0-9]+)\\.supabase\\.co");
  // Pooler connection: the username carries the project reference, postgres.<ref>
  private static final Pattern POOLER_USER = Pattern.compile("postgres\\.([a-z0-9]+)");

  private StagingProjectGuard() {}

  /** Throws IllegalStateException with a safe message when staging points elsewhere. */
  public static void verify(Map<String, String> environment) {
    if (!isStaging(environment.get(PROFILES))) {
      return;
    }
    String expected = blankToNull(environment.get(EXPECTED_PROJECT_REF));
    if (expected == null) {
      throw refuse(EXPECTED_PROJECT_REF + " es obligatoria con el perfil staging.");
    }
    String username = blankToNull(environment.get(DATASOURCE_USERNAME));
    List<String> refs = new ArrayList<>();
    for (String variable : List.of(DB_URL, DATASOURCE_URL)) {
      String url = blankToNull(environment.get(variable));
      // SPRING_DATASOURCE_URL overrides the property, so it is checked whenever it is set.
      if (url == null && variable.equals(DB_URL)) {
        throw refuse(DB_URL + " es obligatoria con el perfil staging.");
      }
      if (url != null) {
        refs.addAll(referencesIn(variable, url, username));
      }
    }
    if (refs.isEmpty()) {
      throw refuse("no se pudo identificar el proyecto Supabase de la base de datos.");
    }
    for (String ref : refs) {
      if (!ref.equals(expected)) {
        throw refuse(
            "la base de datos no pertenece al proyecto esperado (" + EXPECTED_PROJECT_REF + ").");
      }
    }
    // Other Supabase URLs the backend calls. A blank value is not a connection to another
    // project: Storage is then disabled, and Spring refuses to start without an issuer.
    for (String variable : List.of(AUTH_ISSUER, STORAGE_URL)) {
      String url = blankToNull(environment.get(variable));
      if (url != null) {
        requireProject(variable, url, expected);
      }
    }
  }

  private static void requireProject(String variable, String url, String expected) {
    URI uri;
    try {
      uri = new URI(url.trim());
    } catch (URISyntaxException e) {
      throw refuse(variable + " no es una URL válida.");
    }
    String host = uri.getHost();
    Matcher project = SUPABASE_HOST.matcher(host == null ? "" : host);
    if (!project.matches()) {
      // Custom domains are unknown to the guard, so they are refused rather than trusted.
      throw refuse(variable + " debe apuntar a <ref>.supabase.co.");
    }
    if (!project.group(1).equals(expected)) {
      throw refuse(variable + " no pertenece al proyecto esperado (" + EXPECTED_PROJECT_REF + ").");
    }
  }

  static boolean isStaging(String profiles) {
    if (profiles == null) {
      return false;
    }
    for (String profile : profiles.split(",")) {
      if (STAGING_PROFILE.equals(profile.trim())) {
        return true;
      }
    }
    return false;
  }

  private static List<String> referencesIn(String variable, String url, String username) {
    String trimmed = url.trim();
    if (!trimmed.startsWith(JDBC_PREFIX)) {
      throw refuse(variable + " debe ser una URL jdbc:postgresql://.");
    }
    URI uri;
    try {
      uri = new URI(trimmed.substring("jdbc:".length()));
    } catch (URISyntaxException e) {
      // Also covers several hosts in one URL, which is not a single project.
      throw refuse(variable + " no se puede interpretar como una única base de datos.");
    }
    String host = uri.getHost();
    if (host == null) {
      throw refuse(variable + " debe tener un único host.");
    }

    List<String> refs = new ArrayList<>();
    Matcher direct = DIRECT_HOST.matcher(host);
    if (direct.matches()) {
      refs.add(direct.group(1));
    }
    String userParameter = queryParameter(uri.getRawQuery(), "user");
    if (userParameter != null) {
      addPoolerReference(refs, userParameter);
    }
    if (username != null) {
      addPoolerReference(refs, username);
    }
    return refs;
  }

  private static void addPoolerReference(List<String> refs, String user) {
    Matcher pooler = POOLER_USER.matcher(user);
    if (pooler.matches()) {
      refs.add(pooler.group(1));
    }
  }

  private static String queryParameter(String rawQuery, String name) {
    if (rawQuery == null) {
      return null;
    }
    for (String pair : rawQuery.split("&")) {
      int equals = pair.indexOf('=');
      if (equals > 0 && pair.substring(0, equals).equals(name)) {
        return URLDecoder.decode(pair.substring(equals + 1), StandardCharsets.UTF_8);
      }
    }
    return null;
  }

  private static String blankToNull(String value) {
    if (value == null || value.isBlank()) {
      return null;
    }
    return value.trim();
  }

  private static IllegalStateException refuse(String reason) {
    return new IllegalStateException(
        "UniFood: el perfil staging no arranca: " + reason + " No se muestran valores.");
  }
}
