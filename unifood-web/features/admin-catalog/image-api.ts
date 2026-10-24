import { AdminCatalogError, catalogErrorCode } from "./errors";
import { parseImageOperation, type ImageOperation } from "./image-contracts";

export type ImageAttempt = {
  productId: string;
  expectedVersion: string;
  key: string;
  file: File | null;
};
export async function catalogImageRequest(
  attempt: ImageAttempt,
  reconcile = false,
): Promise<ImageOperation> {
  const body = attempt.file ? new FormData() : null;
  if (body && attempt.file) {
    body.set("file", attempt.file);
    body.set("expectedVersion", attempt.expectedVersion);
  }
  let response: Response;
  try {
    response = await fetch(
      "/api/admin/catalog/" +
        attempt.productId +
        (reconcile ? "/image-operations/" + attempt.key : "/image"),
      {
        method: reconcile ? "GET" : attempt.file ? "PUT" : "DELETE",
        headers: reconcile
          ? {}
          : {
              "Idempotency-Key": attempt.key,
              ...(!attempt.file ? { "content-type": "application/json" } : {}),
            },
        ...(!reconcile
          ? {
              body:
                body ??
                JSON.stringify({ expectedVersion: attempt.expectedVersion }),
            }
          : {}),
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
        signal: AbortSignal.timeout(75000),
      },
    );
  } catch {
    throw new AdminCatalogError(
      503,
      "ADMIN_CATALOG_IMAGE_TEMPORARILY_UNAVAILABLE",
    );
  }
  const raw: unknown = await response.json().catch(() => null);
  const parsed = parseImageOperation(raw, attempt.productId, attempt.key);
  if (parsed) return parsed;
  const code =
    raw && typeof raw === "object" && "code" in raw ? raw.code : undefined;
  throw new AdminCatalogError(
    response.status,
    catalogErrorCode(response.status, code),
  );
}
