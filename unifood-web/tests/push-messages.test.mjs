import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadTs } from "./helpers/load-ts.mjs";

const { PUSH_MESSAGES } = loadTs("lib/messages.ts");

function sources(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory())
      return entry.name === "server" ? [] : sources(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

const files = sources("features/push").map((file) => [
  file,
  fs.readFileSync(file, "utf8"),
]);

test("every push text used by the interface comes from the central catalog", () => {
  const used = new Set();
  for (const [, source] of files) {
    for (const match of source.matchAll(/PUSH_MESSAGES\.(\w+)/g))
      used.add(match[1]);
  }
  // Keys the hook stores in view.message and the components resolve via PUSH_MESSAGES[key].
  const hook = fs.readFileSync("features/push/usePush.ts", "utf8");
  for (const match of hook.matchAll(/setMessage\("(\w+)"\)|return "(\w+)";/g))
    used.add(match[1] ?? match[2]);
  assert.ok(used.size > 10);
  for (const key of used)
    assert.ok(key in PUSH_MESSAGES, `missing catalog key: ${key}`);
});

test("every catalog entry is used, non-empty Spanish and free of placeholders", () => {
  const everything = files.map(([, source]) => source).join("\n");
  for (const [key, text] of Object.entries(PUSH_MESSAGES)) {
    assert.ok(text.trim().length > 0, key);
    assert.doesNotMatch(text, /TODO|lorem|undefined|\{\w+\}/i, key);
    assert.ok(
      everything.includes(`PUSH_MESSAGES.${key}`) ||
        everything.includes(`"${key}"`),
      `unused catalog key: ${key}`,
    );
  }
});

test("no user-facing Spanish text is hard-coded in the push components", () => {
  for (const [file, source] of files.filter(([file]) =>
    file.endsWith(".tsx"),
  )) {
    const jsxText = [
      ...source.matchAll(/>\s*([^<>{}\n]*[áéíóúñ¿¡][^<>{}\n]*)\s*</g),
    ].map((match) => match[1].trim());
    assert.deepEqual(jsxText, [], file);
  }
});

test("the payload texts of the backend match the event list of the docs", () => {
  const docs = fs.readFileSync("../docs/notificaciones-push.md", "utf8");
  const java = fs.readFileSync(
    "../unifood-backend/src/main/java/com/santotofood/adapter/out/push/PushMessage.java",
    "utf8",
  );
  for (const title of [
    "Tu pedido está en preparación",
    "¡Tu pedido está listo!",
    "Te están llamando, pasa a recoger",
    "Recuerda recoger tu pedido",
    "La cafetería no pudo aceptar tu pedido",
    "Tu pedido no fue recogido",
  ]) {
    assert.ok(java.includes(title), title);
    assert.ok(docs.includes(title), title);
  }
});
