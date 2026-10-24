import "server-only";
import { unstable_rethrow } from "next/navigation";
import { getVerifiedAuthIdentity } from "@/features/auth/server/identity";
import { authClient } from "@/features/auth/server/client";
import {
  sameOrigin,
  isAdmin,
  type AuthProfile,
} from "@/features/auth/validation";
import {
  isAuthServiceUnavailable,
  isTemporaryAuthFailure,
} from "@/features/auth/server/failures";
import { serverApiUrl } from "@/config/server";
import { catalogUuid } from "../commands";
import { validCatalogVersion } from "../contracts";
import { IMAGE_MAX_BYTES } from "../images";
import { CATALOG_MESSAGES, catalogErrorCode } from "../errors";
import { parseImageOperation } from "../image-contracts";

function failure(status: number, code?: unknown) {
  const safe = catalogErrorCode(status, code);
  return Response.json(
    { status, code: safe, message: CATALOG_MESSAGES[safe] },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        ...(status === 503 ? { "Retry-After": "5" } : {}),
      },
    },
  );
}
async function bounded(body: ReadableStream<Uint8Array> | null, max: number) {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) {
        await reader.cancel();
        throw new RangeError("Body exceeds limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

export async function forwardCatalogImage(
  request: Request,
  productId: string,
  kind: "upload" | "remove" | "operation" | "image",
  id?: string,
) {
  const mutation = kind === "upload" || kind === "remove";
  if (mutation && !sameOrigin(request)) return failure(403);
  if (!catalogUuid(productId) || (!mutation && !catalogUuid(id)))
    return failure(400);
  const key = mutation ? request.headers.get("Idempotency-Key") : id;
  if (!catalogUuid(key))
    return failure(400, "ADMIN_CATALOG_IMAGE_INVALID_REQUEST");
  let identity;
  try {
    identity = await getVerifiedAuthIdentity();
    if (!identity) return failure(401);
    const { data, error, status } = await (
      await authClient()
    ).rpc("current_auth_profile");
    if (error)
      return isTemporaryAuthFailure(error)
        ? failure(503, "AUTH_TEMPORARILY_UNAVAILABLE")
        : failure(status === 401 ? 401 : 403);
    if (!data || data.id !== identity.id || !isAdmin(data as AuthProfile))
      return failure(403);
  } catch (cause) {
    unstable_rethrow(cause);
    return isAuthServiceUnavailable(cause) || isTemporaryAuthFailure(cause)
      ? failure(503, "AUTH_TEMPORARILY_UNAVAILABLE")
      : failure(401);
  }
  let body: BodyInit | undefined;
  try {
    if (kind === "upload") {
      const contentType = request.headers.get("content-type") ?? "";
      if (
        !/^multipart\/form-data;\s*boundary=(?:"[^"\r\n]{1,70}"|[^\s;\r\n]{1,70})$/i.test(
          contentType,
        )
      )
        return failure(400, "ADMIN_CATALOG_IMAGE_INVALID_REQUEST");
      if (
        Number(request.headers.get("content-length")) >
        IMAGE_MAX_BYTES + 65536
      )
        return failure(413, "ADMIN_CATALOG_IMAGE_TOO_LARGE");
      const bytes = await bounded(request.body, IMAGE_MAX_BYTES + 65536);
      const form = await new Response(bytes, {
        headers: { "content-type": contentType },
      }).formData();
      if (
        Array.from(form.keys()).some(
          (k) => !["file", "expectedVersion"].includes(k),
        ) ||
        form.getAll("file").length !== 1 ||
        form.getAll("expectedVersion").length !== 1
      )
        return failure(400, "ADMIN_CATALOG_IMAGE_INVALID_REQUEST");
      const file = form.get("file"),
        version = form.get("expectedVersion");
      if (!(file instanceof Blob) || !validCatalogVersion(version))
        return failure(400, "ADMIN_CATALOG_IMAGE_INVALID_REQUEST");
      if (file.size > IMAGE_MAX_BYTES)
        return failure(413, "ADMIN_CATALOG_IMAGE_TOO_LARGE");
      if (!["image/jpeg", "image/png"].includes(file.type))
        return failure(415, "ADMIN_CATALOG_IMAGE_UNSUPPORTED_FORMAT");
      const safe = new FormData();
      safe.set("file", file, "image");
      safe.set("expectedVersion", version);
      body = safe;
    } else if (kind === "remove") {
      if (
        !/^application\/json(?:\s*;.*)?$/i.test(
          request.headers.get("content-type") ?? "",
        )
      )
        return failure(400);
      const bytes = await bounded(request.body, 1024);
      const raw = JSON.parse(new TextDecoder().decode(bytes));
      if (
        !raw ||
        Object.keys(raw).join() !== "expectedVersion" ||
        !validCatalogVersion(raw.expectedVersion)
      )
        return failure(400, "ADMIN_CATALOG_IMAGE_INVALID_REQUEST");
      body = JSON.stringify({ expectedVersion: raw.expectedVersion });
    }
  } catch (cause) {
    return failure(
      cause instanceof RangeError ? 413 : 400,
      cause instanceof RangeError
        ? "ADMIN_CATALOG_IMAGE_TOO_LARGE"
        : "ADMIN_CATALOG_IMAGE_INVALID_REQUEST",
    );
  }
  try {
    const suffix =
      kind === "operation"
        ? "/image-operations/" + id
        : "/image" + (kind === "image" ? "/" + id : "");
    const upstream = await fetch(
      serverApiUrl() + "/api/admin/catalog/" + productId + suffix,
      {
        method:
          kind === "upload" ? "PUT" : kind === "remove" ? "DELETE" : "GET",
        headers: {
          authorization: "Bearer " + identity.accessToken,
          accept:
            kind === "image" ? "image/jpeg, image/png" : "application/json",
          ...(mutation ? { "Idempotency-Key": key! } : {}),
          ...(kind === "remove" ? { "content-type": "application/json" } : {}),
        },
        ...(body ? { body } : {}),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(kind === "upload" ? 60000 : 30000),
      },
    );
    if (kind === "image" && upstream.status === 200) {
      const type = upstream.headers.get("content-type")?.split(";")[0];
      if (!type || !["image/jpeg", "image/png"].includes(type))
        return failure(502);
      const bytes = await bounded(upstream.body, IMAGE_MAX_BYTES);
      return new Response(bytes, {
        headers: {
          "Content-Type": type,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
          "Cross-Origin-Resource-Policy": "same-origin",
        },
      });
    }
    const bytes = await bounded(upstream.body, 65536);
    const raw: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (kind !== "image") {
      const operation = parseImageOperation(raw, productId, key!);
      if (
        operation &&
        (upstream.status === 200 ||
          (upstream.status === 202 && operation.state === "PROCESSING") ||
          upstream.status === operation.failureStatus)
      )
        return Response.json(operation, {
          status: upstream.status,
          headers: {
            "Cache-Control": "no-store",
            ...(upstream.status === 503 ? { "Retry-After": "5" } : {}),
          },
        });
      if ([200, 202].includes(upstream.status)) return failure(502);
    }
    const status = [400, 401, 403, 404, 409, 413, 415, 422, 500, 503].includes(
      upstream.status,
    )
      ? upstream.status
      : upstream.status >= 502
        ? 503
        : 502;
    return failure(
      status,
      raw && typeof raw === "object" && "code" in raw ? raw.code : undefined,
    );
  } catch {
    return failure(503, "ADMIN_CATALOG_IMAGE_TEMPORARILY_UNAVAILABLE");
  }
}
