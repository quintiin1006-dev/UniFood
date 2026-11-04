import assert from "node:assert/strict";
import { availabilityLoader } from "./load-availability.mjs";

// Receives a Spring MVC response generated against the test-owned PostgreSQL cluster.
// Never print the body: failures report only that the shared contract disagrees.
try {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const raw = JSON.parse(input);
  const { parseAdminDashboard } = availabilityLoader()(
    "features/admin-dashboard/contracts.ts",
  );
  const parsed = parseAdminDashboard(raw);
  assert.ok(parsed);
  assert.deepEqual(parsed, raw);
  process.stdout.write("OK");
} catch {
  process.stderr.write(
    "Spring response differs from the TypeScript contract.\n",
  );
  process.exitCode = 1;
}
