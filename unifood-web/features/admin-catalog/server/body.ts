import "server-only";
import { CATALOG_BODY_LIMIT } from "../commands";

/** Bound streamed bytes too: Content-Length is only an early rejection hint. */
export async function catalogRequestBody(request: Request): Promise<unknown> {
  if (
    !/^application\/json(?:\s*;|$)/i.test(
      request.headers.get("content-type") ?? "",
    ) ||
    Number(request.headers.get("content-length")) > CATALOG_BODY_LIMIT ||
    !request.body
  )
    throw new Error("Invalid catalog body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > CATALOG_BODY_LIMIT)
        throw new Error("Catalog body too large");
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
