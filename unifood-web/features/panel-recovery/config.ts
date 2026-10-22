export type RecoveryConfig = { url: string; key: string };

/** Only public credentials may cross the Server Component boundary. */
export function publicRecoveryConfig(
  config: RecoveryConfig | null,
): RecoveryConfig | null {
  if (!config) return null;
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(config.key)) return config;
  try {
    const parts = config.key.split(".");
    if (
      parts.length === 3 &&
      JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"))).role ===
        "anon"
    )
      return config;
  } catch {
    /* Never serialize secret or unknown key formats to a browser. */
  }
  return null;
}
