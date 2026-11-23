import "server-only";
import {
  readApiUrl,
  readAuthConfig,
  readDailyMenuEnabled,
  readNoticesEnabled,
  validateEnvironment,
} from "./environment";

export function serverApiUrl() {
  return readApiUrl(process.env);
}

export function serverAuthConfig() {
  return readAuthConfig(process.env);
}

export function serverDailyMenuEnabled() {
  return readDailyMenuEnabled(process.env);
}

/** A malformed value counts as off, so the client shell always renders. */
export function serverNoticesEnabled() {
  try {
    return readNoticesEnabled(process.env);
  } catch {
    return false;
  }
}

export function validateServerEnvironment() {
  validateEnvironment(process.env);
}
