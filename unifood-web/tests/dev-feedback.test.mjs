import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Ola 4 · F5: /dev/feedback is a development-only page with no link from the app.

test("the page calls notFound() in production before rendering anything", () => {
  const source = fs.readFileSync("app/dev/feedback/page.tsx", "utf8");
  assert.match(
    source,
    /if \(process\.env\.NODE_ENV === "production"\) notFound\(\);\s*return <FeedbackGallery \/>;/,
  );
  assert.match(source, /robots: \{ index: false, follow: false \}/);
});

test("nothing in the app links to /dev", () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (file === path.join("app", "dev")) continue;
        walk(file);
      } else if (/\.(tsx?|css)$/.test(entry.name)) {
        if (/["'`]\/dev(\/|["'`])/.test(fs.readFileSync(file, "utf8")))
          offenders.push(file);
      }
    }
  };
  for (const root of ["app", "components", "features", "lib"]) walk(root);
  assert.deepEqual(offenders, []);
});
