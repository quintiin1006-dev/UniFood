import "server-only";
import { readApiUrl, readAuthConfig, validateEnvironment } from "./environment";

export function serverApiUrl() {
  return readApiUrl(process.env);
}

export function serverAuthConfig() {
  return readAuthConfig(process.env);
}

export function validateServerEnvironment() {
  validateEnvironment(process.env);
}
