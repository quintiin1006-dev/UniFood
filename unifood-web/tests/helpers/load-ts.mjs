import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

// Loads a TypeScript module for node:test without a bundler. Relative `./x` imports resolve to `x.ts`.
const cache = new Map();
export function loadTs(file) {
  const filename = path.resolve(file);
  if (cache.has(filename)) return cache.get(filename);
  const mod = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  new Function("require", "module", "exports", source)(
    (name) => loadTs(path.resolve(path.dirname(filename), `${name}.ts`)),
    mod,
    mod.exports,
  );
  cache.set(filename, mod.exports);
  return mod.exports;
}
