import { test } from "node:test";
import assert from "node:assert/strict";
import { availabilityLoader } from "./helpers/load-availability.mjs";
import { adminDashboardFixture } from "./helpers/admin-dashboard-fixture.mjs";

const { parseAdminDashboard, dashboardInteger, dashboardAmount } =
  availabilityLoader()("features/admin-dashboard/contracts.ts");

for (const options of [
  {},
  { empty: true },
  { unavailable: true },
  { range: "TODAY", from: "2026-10-24" },
  { range: "LAST_7_DAYS", from: "2026-10-18", to: "2026-10-24" },
  { range: "LAST_30_DAYS", from: "2026-09-25", to: "2026-10-24" },
]) {
  test(
    "dashboard DTO roundtrips without changing monetary values, nulls or coverage: " +
      JSON.stringify(options),
    () => {
      const data = adminDashboardFixture(options);
      assert.deepEqual(parseAdminDashboard(data), data);
    },
  );
}
test("large count and amount strings retain every digit and have no catalog price ceiling", () => {
  const data = adminDashboardFixture();
  data.summary.receivedOrders = data.trend[0].receivedOrders =
    "90071992547409931234567890";
  data.summary.receivedOrderValue = "999999999999999999999999999999.99";
  for (const check of data.coverage.checks.filter(
    (c) =>
      c.scope.eventTypes.length === 1 && c.scope.eventTypes[0] === "RECEIVED",
  ))
    check.examinedOrders = data.summary.receivedOrders;
  assert.deepEqual(parseAdminDashboard(data), data);
  assert.equal(dashboardInteger("90071992547409931234567890"), true);
  assert.equal(dashboardAmount("999999999999999999999999999999.99"), true);
});
test("explicit projection strips additional private fields at every nesting level", () => {
  const data = adminDashboardFixture(),
    clean = structuredClone(data);
  for (const object of [
    data,
    data.period,
    data.summary,
    data.trend[0],
    data.topDeliveredProducts,
    data.topDeliveredProducts.items[0],
    data.topDeliveredProducts.totals,
    data.topDeliveredProducts.omitted,
    data.coverage,
    data.coverage.provenance,
    data.coverage.checks[0],
    data.coverage.checks[0].scope,
    data.coverage.warnings[0],
  ])
    Object.assign(object, {
      token: "PRIVATE_TOKEN",
      clientName: "PRIVATE_STUDENT",
      note: "PRIVATE_NOTE",
    });
  assert.deepEqual(parseAdminDashboard(data), clean);
});
const mutations = {
  "missing top-level property": (d) => {
    delete d.coverage;
  },
  "missing nullable property": (d) => {
    delete d.summary.notCollectedItemValue;
  },
  "wrong count type": (d) => {
    d.summary.receivedOrders = 1;
  },
  "leading zero count": (d) => {
    d.summary.receivedOrders = "01";
  },
  "negative count": (d) => {
    d.trend[0].deliveredOrders = "-1";
  },
  "binary monetary number": (d) => {
    d.summary.receivedOrderValue = 30;
  },
  "scientific money": (d) => {
    d.summary.receivedOrderValue = "3e1";
  },
  "missing money cents": (d) => {
    d.summary.receivedOrderValue = "30.0";
  },
  NaN: (d) => {
    d.summary.receivedOrderValue = "NaN";
  },
  "invalid rate": (d) => {
    d.summary.notCollectedRatePercent = "100.01";
  },
  "zero denominator with non-null rate": (d) => {
    d.summary.notCollectedRateDenominator = "0";
  },
  "unknown basis": (d) => {
    d.basis = "CREATED_AT";
  },
  "unknown currency": (d) => {
    d.currency = "USD";
  },
  "wrong timezone": (d) => {
    d.period.timezone = "UTC";
  },
  "invalid calendar date": (d) => {
    d.period.to = "2024-02-30";
  },
  "invalid time": (d) => {
    d.period.asOf = "2026-10-24T25:00:00Z";
  },
  "non-UTC instant": (d) => {
    d.period.startInclusive = "2024-01-01T00:00:00-05:00";
  },
  "wrong cutoff": (d) => {
    d.period.endExclusive = "2024-01-02T06:00:00Z";
  },
  "wrong partial flag": (d) => {
    d.period.partial = true;
  },
  "missing day": (d) => {
    d.trend = [];
  },
  "wrong trend date": (d) => {
    d.trend[0].date = "2024-01-02";
  },
  "duplicate product": (d) => {
    d.topDeliveredProducts.items.push(
      structuredClone(d.topDeliveredProducts.items[0]),
    );
  },
  "invalid UUID": (d) => {
    d.notCollectedProducts.items[0].productId = "other-cafeteria";
  },
  "wrong share type": (d) => {
    d.notCollectedProducts.items[0].unitSharePercent = 100;
  },
  "delivered share must remain null": (d) => {
    d.topDeliveredProducts.items[0].unitSharePercent = "100.00";
  },
  "unknown availability": (d) => {
    d.notCollectedProducts.availability = "EMPTY";
  },
  "available totals cannot be null": (d) => {
    d.notCollectedProducts.totals.units = null;
  },
  "unknown scope": (d) => {
    d.coverage.checks[0].scope.basis = "GLOBAL";
  },
  "unknown check": (d) => {
    d.coverage.checks[0].code = "PRIVATE_SECRET";
  },
  "unknown check status": (d) => {
    d.coverage.checks[0].status = "OK";
  },
  "missing coverage checks": (d) => {
    d.coverage.checks = [];
  },
  "duplicate coverage check": (d) => {
    d.coverage.checks[1] = d.coverage.checks[0];
  },
  "unknown is not zero": (d) => {
    d.coverage.checks.at(-1).affectedOrders = "0";
  },
  "invalid affected population": (d) => {
    d.coverage.checks[0].status = "WARN";
    d.coverage.checks[0].affectedOrders = "3";
  },
  "wrong assessed instant": (d) => {
    d.coverage.assessedAt = "2026-10-25T17:00:00Z";
  },
  "unverified is not certified": (d) => {
    d.coverage.provenance.status = "VERIFIED";
  },
  "unknown provenance count": (d) => {
    d.coverage.provenance.verifiedRealOrders = "0";
  },
  "unknown warning code cannot expose data": (d) => {
    d.coverage.warnings[0].code = "PRIVATE_TOKEN";
  },
  "unknown effect cannot expose data": (d) => {
    d.coverage.warnings[0].affects = ["PRIVATE_STUDENT"];
  },
  "warnings cannot be silently removed": (d) => {
    d.coverage.warnings = [];
  },
};
for (const [name, mutate] of Object.entries(mutations))
  test("rejects malformed dashboard: " + name, () => {
    const data = adminDashboardFixture();
    mutate(data);
    assert.equal(parseAdminDashboard(data), null);
  });
test("unavailable ranking remains distinct from empty and never accepts a partial Top", () => {
  const data = adminDashboardFixture({ unavailable: true });
  data.notCollectedProducts.items =
    adminDashboardFixture().notCollectedProducts.items;
  assert.equal(parseAdminDashboard(data), null);
});
test("response must match requested filters and ranking limit", () => {
  const data = adminDashboardFixture();
  for (const requested of [
    { range: "TODAY", rankingLimit: 10 },
    { range: "CUSTOM", from: "2024-01-01", to: "2024-01-01", rankingLimit: 5 },
    { range: "CUSTOM", from: "2024-01-02", to: "2024-01-02", rankingLimit: 10 },
  ])
    assert.equal(parseAdminDashboard(data, requested), null);
});
test("null or unexpected JSON roots fail closed", () => {
  for (const data of [null, [], "PRIVATE", 3, {}, { period: {} }])
    assert.equal(parseAdminDashboard(data), null);
});
test("the unexecuted global audit cannot be promoted to PASS", () => {
  const data = adminDashboardFixture();
  const check = data.coverage.checks.at(-1);
  check.status = "PASS";
  check.examinedOrders = "0";
  check.affectedOrders = "0";
  assert.equal(parseAdminDashboard(data), null);
});
test("WARN checks require the corresponding public warning", () => {
  const data = adminDashboardFixture({ unavailable: true });
  data.coverage.warnings = data.coverage.warnings.filter(
    (w) => w.code !== "INCOMPLETE_ITEMS_NOT_COLLECTED",
  );
  assert.equal(parseAdminDashboard(data), null);
});
test("UTC nanosecond instants are preserved and a one-nanosecond cutoff mismatch is rejected", () => {
  const data = adminDashboardFixture({
    range: "TODAY",
    from: "2026-10-24",
    asOf: "2026-10-24T17:00:00.123456789Z",
  });
  assert.deepEqual(parseAdminDashboard(data), data);
  data.period.endExclusive = "2026-10-24T17:00:00.123456790Z";
  assert.equal(parseAdminDashboard(data), null);
});
test("available ranking cannot hide rows declared by its total product count", () => {
  const data = adminDashboardFixture();
  data.notCollectedProducts.items = [];
  assert.equal(parseAdminDashboard(data), null);
});
test("a limited Top preserves the backend share of the entire universe without recalculation", () => {
  const data = adminDashboardFixture({ limit: 1 });
  const ranking = data.notCollectedProducts;
  ranking.hasMore = true;
  ranking.totals = {
    products: "2",
    orders: "1",
    units: "5",
    itemValue: "50.00",
  };
  ranking.omitted = { products: "1", units: "2", itemValue: "20.00" };
  ranking.items[0].unitSharePercent = "60.00";
  Object.assign(data.summary, {
    notCollectedUnits: "5",
    receivedOrderValue: "50.00",
    notCollectedOrderValue: "50.00",
    notCollectedItemValue: "50.00",
  });
  assert.deepEqual(parseAdminDashboard(data), data);
});
