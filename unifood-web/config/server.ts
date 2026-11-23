import "server-only";
import {
  readApiUrl,
  readAuthConfig,
  readDailyMenuEnabled,
  readServiceFeeEnabled,
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

export function serverServiceFeeEnabled() {
  return readServiceFeeEnabled(process.env);
}

export function validateServerEnvironment() {
  validateEnvironment(process.env);
}
