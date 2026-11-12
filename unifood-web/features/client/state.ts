/**
 * Last chosen cafeteria, as a browser cache only (§4). The server never trusts it: the page
 * validates the id against GET /api/me/context on every request. Saving the preference in
 * the server waits for PUT /api/me/preference in the backend.
 */
export const CAFETERIA_STORAGE_KEY = "unifood.client.cafeteria.v1";

export function readCachedCafeteria(ownerId: string): string | null {
  try {
    const saved = JSON.parse(
      localStorage.getItem(CAFETERIA_STORAGE_KEY) ?? "null",
    );
    return saved?.ownerId === ownerId && typeof saved.cafeteriaId === "string"
      ? saved.cafeteriaId
      : null;
  } catch {
    return null;
  }
}

export function cacheCafeteria(ownerId: string, cafeteriaId: string) {
  try {
    localStorage.setItem(
      CAFETERIA_STORAGE_KEY,
      JSON.stringify({ ownerId, cafeteriaId }),
    );
  } catch {
    // Without storage the URL still carries the choice.
  }
}

export function forgetCachedCafeteria() {
  try {
    localStorage.removeItem(CAFETERIA_STORAGE_KEY);
  } catch {
    // Storage unavailable.
  }
}
