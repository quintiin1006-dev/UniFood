import { parseAdminCatalog, validCatalogVersion } from "./contracts";
import { catalogUuid } from "./commands";
import { catalogErrorCode } from "./errors";
import type { AdminProduct } from "./types";

export type ImageOperation = {
  operationId: string;
  state: "PROCESSING" | "APPLIED" | "REJECTED";
  appliedVersion: string | null;
  failureStatus: number | null;
  failureCode: string | null;
  product: AdminProduct;
};
export function parseImageOperation(
  raw: unknown,
  productId: string,
  operationId: string,
): ImageOperation | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const product = parseAdminCatalog({ products: [r.product] })?.products[0];
  if (
    !catalogUuid(r.operationId) ||
    r.operationId !== operationId ||
    !product ||
    product.id !== productId
  )
    return null;
  if (
    r.state === "APPLIED" &&
    validCatalogVersion(r.appliedVersion) &&
    BigInt(product.version) >= BigInt(r.appliedVersion) &&
    r.failureStatus === null &&
    r.failureCode === null
  )
    return {
      operationId,
      state: r.state,
      appliedVersion: r.appliedVersion,
      failureStatus: null,
      failureCode: null,
      product,
    };
  if (
    r.state === "PROCESSING" &&
    r.appliedVersion === null &&
    r.failureStatus === null &&
    r.failureCode === null
  )
    return {
      operationId,
      state: r.state,
      appliedVersion: null,
      failureStatus: null,
      failureCode: null,
      product,
    };
  if (
    r.state === "REJECTED" &&
    r.appliedVersion === null &&
    typeof r.failureStatus === "number" &&
    [400, 403, 404, 409, 413, 415, 422, 500, 503].includes(r.failureStatus) &&
    typeof r.failureCode === "string"
  )
    return {
      operationId,
      state: r.state,
      appliedVersion: null,
      failureStatus: r.failureStatus,
      failureCode: catalogErrorCode(r.failureStatus, r.failureCode),
      product,
    };
  return null;
}
