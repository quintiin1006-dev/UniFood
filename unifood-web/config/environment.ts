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

export function readAuthConfig(environment: Environment) {
  const url = environment.SUPABASE_URL?.trim();
  const key = environment.SUPABASE_PUBLISHABLE_KEY?.trim();
  // Preserve local UI previews without enabling an unconfigured auth provider.
  if (!url && !key && environment.NODE_ENV !== "production") return null;
  const validatedUrl = requiredUrl(environment, "SUPABASE_URL");
  if (!key) invalid("SUPABASE_PUBLISHABLE_KEY", "is required");

  return { url: validatedUrl, key };
}

export function validateEnvironment(environment: Environment): void {
  readApiUrl(environment);
  readAuthConfig(environment);
}
