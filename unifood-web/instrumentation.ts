import { validateServerEnvironment } from "@/config/server";

export function register() {
  // Validate runtime configuration too when an artifact is promoted to another environment.
  validateServerEnvironment();
}
