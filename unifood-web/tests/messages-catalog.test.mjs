import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { availabilityLoader } from "./helpers/load-availability.mjs";

// Ola 4 · F5: one catalogue of user texts; every backend ErrorCode has a message.

const ERROR_CODE_JAVA =
  "../unifood-backend/src/main/java/com/santotofood/shared/error/ErrorCode.java";

const catalogue = () => availabilityLoader()("features/shared/messages.ts");

function backendCodes() {
  const source = fs.readFileSync(ERROR_CODE_JAVA, "utf8");
  const start = source.indexOf("{", source.indexOf("enum ErrorCode")) + 1;
  // Constants end at the first «;» (if the enum grows members) or at the closing brace.
  const ends = [source.indexOf(";", start), source.indexOf("}", start)].filter(
    (index) => index > 0,
  );
  const body = source.slice(start, Math.min(...ends));
  return [...body.matchAll(/^\s*([A-Z][A-Z0-9_]+)\s*[,(]?/gm)].map(
    (match) => match[1],
  );
}

test("the mirror list matches the backend ErrorCode enum, in both directions", () => {
  const backend = backendCodes();
  const { BACKEND_ERROR_CODES } = catalogue();
  assert.ok(backend.length > 50, "the enum was read");
  const missing = backend.filter((code) => !BACKEND_ERROR_CODES.includes(code));
  const stale = BACKEND_ERROR_CODES.filter((code) => !backend.includes(code));
  assert.deepEqual(missing, [], "backend codes without a message in the front");
  assert.deepEqual(stale, [], "front codes the backend no longer has");
});

test("every backend code has a short, friendly Spanish message", () => {
  const { BACKEND_ERROR_CODES, BACKEND_ERROR_MESSAGES } = catalogue();
  for (const code of BACKEND_ERROR_CODES) {
    const message = BACKEND_ERROR_MESSAGES[code];
    assert.equal(typeof message, "string", code);
    assert.ok(message.length >= 12 && message.length <= 200, code);
    assert.match(message, /^[A-ZÁÉÍÓÚÑ¿¡]/, `${code} starts with a capital`);
    assert.match(message, /[.…]$/, `${code} ends with a full stop`);
    // No technical leaks: no error codes, HTTP statuses or English server words.
    assert.doesNotMatch(message, /[A-Z]{2,}_[A-Z]/, code);
    assert.doesNotMatch(
      message,
      /\b(4\d\d|5\d\d)\b|HTTP|error|exception|null/i,
      code,
    );
    // Tuteo, never «usted».
    assert.doesNotMatch(message, /\busted\b/i, code);
  }
});

test("screens take backend texts from the catalogue instead of repeating them", () => {
  const { BACKEND_ERROR_MESSAGES } = catalogue();
  const texts = new Set(Object.values(BACKEND_ERROR_MESSAGES));
  const files = [
    ...fs
      .readdirSync("features")
      .map((dir) => `features/${dir}/errors.ts`)
      .filter((file) => fs.existsSync(file)),
    "features/orders/orderActionMessages.ts",
    "features/orders/calledOrderActions.ts",
    "app/api/me/orders/[orderId]/cancel/route.ts",
  ];
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    for (const literal of source.matchAll(/"([^"\n]{12,})"/g))
      assert.ok(
        !texts.has(literal[1]),
        `${file} repeats «${literal[1]}»; use BACKEND_ERROR_MESSAGES`,
      );
  }
});

test("the shared UI texts keep one wording and lib/messages re-exports them", () => {
  const shared = catalogue();
  const legacy = availabilityLoader()("lib/messages.ts");
  for (const name of [
    "SESSION_EXPIRED",
    "SESSION_CHECK_UNAVAILABLE",
    "ORDER_STATE_CHANGED",
  ])
    assert.equal(legacy[name], shared[name], name);
  // listingStatus.ts stays dependency-free (it is evaluated in a sandbox); its offline text
  // must still match the catalogue.
  const listing = availabilityLoader()("features/orders/listingStatus.ts");
  assert.equal(
    listing.syncStatusLabel(Date.now(), true).text,
    shared.OFFLINE_RETRYING,
  );
  assert.equal(shared.backendErrorMessage("NOPE", "fallback"), "fallback");
  assert.equal(
    shared.backendErrorMessage("ORDER_CONCURRENT_MODIFICATION", "x"),
    shared.ORDER_STATE_CHANGED,
  );
});
