type Environment = Readonly<Record<string, string | undefined>>;

function invalid(variable: string, requirement: string): never {
  // Never include configuration values: URLs and keys can contain credentials.
  throw new Error(`Configuration error: ${variable} ${requirement}.`);
}

function requiredUrl(environment: Environment, variable: string): string {
  const value = environment[variable]?.trim();
  if (!value) invalid(variable, "is required");

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    invalid(variable, "must be an absolute HTTP(S) URL");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    invalid(
      variable,
      "must be an HTTP(S) URL without credentials, query or fragment",
    );
  }
  return value.replace(/\/+$/, "");
}

export function readApiUrl(environment: Environment): string {
  return requiredUrl(environment, "API_URL");
}

const PROJECT_REF_VARIABLE = "UNIFOOD_EXPECTED_PROJECT_REF";
// Supabase project references are 20 lowercase letters or digits. Only the exact project host is
// accepted: no uppercase, port, path, query, credentials or any other domain.
const PROJECT_REF = /^[a-z0-9]{20}$/;
const PROJECT_URL = /^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/;

/**
 * Staging guard, the web counterpart of StagingProjectGuard in the backend. When
 * UNIFOOD_EXPECTED_PROJECT_REF is set, SUPABASE_URL must be the exact project host of that
 * reference. Unset or blank leaves the behaviour unchanged (local and real production).
 * Messages name only project references, never keys or other values.
 */
function assertExpectedSupabaseProject(environment: Environment, url: string) {
  const expected = environment[PROJECT_REF_VARIABLE]?.trim();
  if (!expected) return;
  if (!PROJECT_REF.test(expected)) {
    invalid(
      PROJECT_REF_VARIABLE,
      "must be a 20-character lowercase Supabase project reference",
    );
  }
  const match = PROJECT_URL.exec(url);
  if (!match) {
    invalid(
      "SUPABASE_URL",
      `must be exactly https://${expected}.supabase.co when ${PROJECT_REF_VARIABLE} is set`,
    );
  }
  if (match[1] !== expected) {
    throw new Error(
      `Configuration error: SUPABASE_URL points to project ${match[1]}, but ${PROJECT_REF_VARIABLE} expects ${expected}.`,
    );
  }
}

export function readAuthConfig(environment: Environment) {
  const url = environment.SUPABASE_URL?.trim();
  const key = environment.SUPABASE_PUBLISHABLE_KEY?.trim();
  // Preserve local UI previews without enabling an unconfigured auth provider.
  if (!url && !key && environment.NODE_ENV !== "production") return null;
  const validatedUrl = requiredUrl(environment, "SUPABASE_URL");
  if (!key) invalid("SUPABASE_PUBLISHABLE_KEY", "is required");
  assertExpectedSupabaseProject(environment, validatedUrl);

  return { url: validatedUrl, key };
}

/**
 * MENU_DINAMICO_ENABLED, the same flag the backend reads (docs/propuesta-menu-dinamico.md, 3.1).
 * Server-only: the browser never receives it. Off when unset or blank; only "true" or "false"
 * (any case) are accepted. Nothing uses it yet, and validateEnvironment does not check it.
 */
export function readDailyMenuEnabled(environment: Environment): boolean {
  const value = environment.MENU_DINAMICO_ENABLED?.trim().toLowerCase();
  if (!value || value === "false") return false;
  if (value === "true") return true;
  invalid("MENU_DINAMICO_ENABLED", 'must be "true" or "false"');
}

/**
 * AVISOS_BANDEJA_ENABLED, the same flag the backend reads: the bell inbox of recent notices.
 * Server-only: the browser never receives it, only whether to render the inbox. Off when unset or
 * blank; only "true" or "false" (any case) are accepted.
 */
export function readNoticesEnabled(environment: Environment): boolean {
  const value = environment.AVISOS_BANDEJA_ENABLED?.trim().toLowerCase();
  if (!value || value === "false") return false;
  if (value === "true") return true;
  invalid("AVISOS_BANDEJA_ENABLED", 'must be "true" or "false"');
}

export function validateEnvironment(environment: Environment): void {
  readApiUrl(environment);
  readAuthConfig(environment);
}
