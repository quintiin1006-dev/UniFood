import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const nativeRequire = createRequire(import.meta.url);
export function availabilityLoader({
  mocks = {},
  fetchMock = global.fetch,
  environment = { API_URL: "http://backend.test:8080" },
} = {}) {
  const cache = new Map();
  function load(file) {
    const resolved = path.resolve(file);
    if (Object.hasOwn(mocks, resolved)) return mocks[resolved];
    if (cache.has(resolved)) return cache.get(resolved).exports;
    const mod = { exports: {} };
    cache.set(resolved, mod);
    const source = ts.transpileModule(fs.readFileSync(resolved, "utf8"), {
      fileName: resolved,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    }).outputText;
    new Function("require", "module", "exports", "process", "fetch", source)(
      (name) => {
        if (Object.hasOwn(mocks, name)) return mocks[name];
        if (name === "server-only") return {};
        if (name.endsWith(".css"))
          return new Proxy(
            {},
            { get: (_, key) => (key === "__esModule" ? false : String(key)) },
          );
        if (!name.startsWith("@/") && !name.startsWith("."))
          return nativeRequire(name);
        const root = name.startsWith("@/")
          ? path.resolve(name.slice(2))
          : path.resolve(path.dirname(resolved), name);
        const dependency = [root, `${root}.ts`, `${root}.tsx`].find(
          (candidate) =>
            fs.existsSync(candidate) && fs.statSync(candidate).isFile(),
        );
        if (!dependency) throw new Error("Missing test dependency: " + name);
        return load(dependency);
      },
      mod,
      mod.exports,
      { env: environment },
      fetchMock,
    );
    return mod.exports;
  }
  return load;
}

export const itemId = "00000000-0000-0000-0000-000000000021";
export const secondItemId = "00000000-0000-0000-0000-000000000022";
export const businessDate = "2026-10-13";
export function availabilityFixture({
  active = true,
  open = false,
  available = false,
} = {}) {
  return {
    businessDate,
    cafeteria: {
      id: "00000000-0000-0000-0000-000000000002",
      name: "Cafetería de prueba",
      active,
      open,
    },
    categories: [
      "DEL_DIA",
      "CORRIENTE",
      "EJECUTIVO",
      "ESPECIAL",
      "DESAYUNO",
    ].map((category, i) => ({
      category,
      items:
        i === 1
          ? [
              {
                id: itemId,
                name: "Almuerzo corriente",
                price: 15000,
                description: null,
                image: "/unifood-logo.png",
                available,
              },
              {
                id: secondItemId,
                name: "Segundo producto",
                price: 18000,
                description: "Descripción",
                image: null,
                available: false,
              },
            ]
          : [],
    })),
  };
}
