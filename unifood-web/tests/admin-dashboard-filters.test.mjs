import { test } from "node:test";
import assert from "node:assert/strict";
import { availabilityLoader } from "./helpers/load-availability.mjs";

const { parseDashboardFilters, dashboardSearch, bogotaDate } =
  availabilityLoader()("features/admin-dashboard/filters.ts");
const now = new Date("2026-10-24T17:00:00Z");
for (const range of ["TODAY", "LAST_7_DAYS", "LAST_30_DAYS"])
  test("accepted range and explicit default limit: " + range, () => {
    const filters = parseDashboardFilters(new URLSearchParams({ range }), now);
    assert.deepEqual(filters, { range, rankingLimit: 10 });
    assert.equal(
      dashboardSearch(filters).toString(),
      "range=" + range + "&rankingLimit=10",
    );
  });
test("strict inclusive custom ranges support leap years and 366 dates", () => {
  assert.deepEqual(
    parseDashboardFilters(
      new URLSearchParams(
        "range=CUSTOM&from=2024-01-01&to=2024-12-31&rankingLimit=50",
      ),
      now,
    ),
    { range: "CUSTOM", from: "2024-01-01", to: "2024-12-31", rankingLimit: 50 },
  );
});
test("future dates use Bogota rather than browser or UTC calendar across the year", () => {
  const rollover = new Date("2027-01-01T04:59:59Z");
  assert.equal(bogotaDate(rollover), "2026-12-31");
  const params = new URLSearchParams(
    "range=CUSTOM&from=2027-01-01&to=2027-01-01",
  );
  assert.equal(parseDashboardFilters(params, rollover), null);
  assert.notEqual(
    parseDashboardFilters(params, new Date("2027-01-01T05:00:00Z")),
    null,
  );
});
for (const query of [
  "",
  "range=",
  "range=today",
  "range=MONTH",
  "range=TODAY&range=TODAY",
  "range=TODAY&from=2024-01-01",
  "range=TODAY&to=2024-01-01",
  "range=CUSTOM",
  "range=CUSTOM&from=2024-01-01",
  "range=CUSTOM&to=2024-01-01",
  "range=CUSTOM&from=2024-1-01&to=2024-01-01",
  "range=CUSTOM&from=2024-02-30&to=2024-03-01",
  "range=CUSTOM&from=2024-01-02&to=2024-01-01",
  "range=CUSTOM&from=2025-01-01&to=2026-01-02",
  "range=CUSTOM&from=2026-10-25&to=2026-10-25",
  "range=CUSTOM&from=2024-01-01&to=2024-01-01&from=2024-01-01",
  "range=TODAY&rankingLimit=0",
  "range=TODAY&rankingLimit=51",
  "range=TODAY&rankingLimit=1.5",
  "range=TODAY&rankingLimit=-1",
  "range=TODAY&rankingLimit=",
  "range=TODAY&rankingLimit=01",
  "range=TODAY&rankingLimit=1&rankingLimit=1",
  ...[
    "cafeteriaId",
    "userId",
    "timezone",
    "asOf",
    "institutionId",
    "siteId",
    "tenantId",
    "unknown",
  ].map((key) => "range=TODAY&" + key + "=FOREIGN"),
])
  test("rejects filters without silently stripping them: " + query, () => {
    assert.equal(parseDashboardFilters(new URLSearchParams(query), now), null);
  });
