import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const mod = { exports: {} };
new Function(
  "module",
  "exports",
  ts.transpileModule(readFileSync("features/auth/validation.ts", "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText,
)(mod, mod.exports);
const { parseEntrypoint, loginPath, canUseEntrypoint, destination } =
  mod.exports;

test("entrypoint accepts only two navigation contexts, defaulting omission to client", () => {
  assert.equal(parseEntrypoint(undefined), "client");
  for (const value of ["client", "panel"])
    assert.equal(parseEntrypoint(value), value);
  for (const value of [
    null,
    "",
    "CLIENT",
    "worker",
    "https://evil.invalid",
    ["panel"],
    {},
    true,
  ])
    assert.equal(parseEntrypoint(value), null);
  assert.equal(loginPath("client"), "/login");
  assert.equal(loginPath("panel"), "/panel/login");
});
test("entrypoint compatibility cannot create a role or admit an invalid profile", () => {
  for (const [role, target] of [
    ["CLIENT", "/cuenta"],
    ["WORKER", "/worker"],
    ["ADMIN", "/admin"],
    ["SUPER_ADMIN", "/super-admin"],
  ]) {
    const profile = {
      active: true,
      roles: [role],
      user_metadata: { role: "SUPER_ADMIN" },
    };
    assert.equal(destination(profile), target);
    for (const entrypoint of ["client", "panel"])
      assert.equal(
        canUseEntrypoint(profile, entrypoint),
        (role === "CLIENT") === (entrypoint === "client"),
      );
    assert.equal(canUseEntrypoint(profile, "unknown"), false);
  }
  for (const profile of [
    null,
    { active: false, roles: ["WORKER"] },
    ...[
      [],
      ["UNKNOWN"],
      ["CLIENT", "WORKER"],
      ["WORKER", "ADMIN"],
      ["ADMIN", "SUPER_ADMIN"],
      ["CLIENT", "CLIENT"],
      null,
      "WORKER",
    ].map((roles) => ({ active: true, roles })),
  ]) {
    for (const entrypoint of ["client", "panel"])
      assert.equal(canUseEntrypoint(profile, entrypoint), false);
  }
});
