export const DEFAULT_USERNAME_DOMAIN = "ustavillavo.edu.co";

export function passwordRules(password: string) {
  return [
    password.length >= 8,
    /[A-Z]/.test(password),
    /[a-z]/.test(password),
    /[0-9]/.test(password),
  ];
}

export function validPassword(password: string) {
  return password.length <= 128 && passwordRules(password).every(Boolean);
}

export function validEmail(email: string) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function validDocument(document: string) {
  return /^[A-Za-z0-9-]{5,30}$/.test(document);
}

export function normalizeIdentifier(identifier: string, domain: string) {
  const value = identifier.trim().toLowerCase();
  return value.includes("@") ? value : `${value}@${domain}`;
}

export type AuthProfile = {
  id: string;
  email: string;
  fullName: string | null;
  active: boolean;
  roles: string[];
};

const businessRoles = new Set(["CLIENT", "WORKER", "ADMIN", "SUPER_ADMIN"]);

export function hasValidBusinessRole(profile: AuthProfile | null | undefined) {
  return (
    profile?.active === true &&
    Array.isArray(profile.roles) &&
    profile.roles.length === 1 &&
    businessRoles.has(profile.roles[0])
  );
}

export function isWorker(profile: AuthProfile) {
  return (
    hasValidBusinessRole(profile) &&
    profile.roles.includes("WORKER") &&
    !isAdmin(profile) &&
    !isSuperAdmin(profile)
  );
}

export function isAdmin(profile: AuthProfile) {
  return hasValidBusinessRole(profile) && profile.roles.includes("ADMIN");
}

export function isSuperAdmin(profile: AuthProfile) {
  return hasValidBusinessRole(profile) && profile.roles.includes("SUPER_ADMIN");
}

export function isClient(profile: AuthProfile) {
  return hasValidBusinessRole(profile) && profile.roles.includes("CLIENT");
}

export function destination(profile: AuthProfile | null) {
  if (!profile || !hasValidBusinessRole(profile)) return "/login";
  if (isSuperAdmin(profile)) return "/super-admin";
  if (isAdmin(profile)) return "/admin";
  return isWorker(profile) ? "/worker" : "/cuenta";
}

const firstValue = (header: string | null) =>
  header?.split(",")[0].trim() || undefined;

export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  let protocol: string;
  try {
    protocol = new URL(request.url).protocol;
  } catch {
    return false;
  }
  const proto =
    firstValue(request.headers.get("x-forwarded-proto")) ??
    protocol.replace(":", "");
  const host =
    firstValue(request.headers.get("x-forwarded-host")) ??
    firstValue(request.headers.get("host"));
  return (
    origin ===
    (host ? `${proto}://${host}` : `${proto}://${new URL(request.url).host}`)
  );
}
