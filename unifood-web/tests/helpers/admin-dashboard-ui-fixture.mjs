import { adminDashboardFixture } from "./admin-dashboard-fixture.mjs";

// Used only by the loopback browser-test server. Never imported by application code.
export function dashboardUiFixture(
  parameters = new URLSearchParams("range=TODAY"),
  scenario = "normal",
) {
  const asOf = new Date().toISOString();
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(asOf));
  const today = ["year", "month", "day"]
    .map((k) => parts.find((p) => p.type === k).value)
    .join("-");
  const range = parameters.get("range") ?? "TODAY";
  const to = range === "CUSTOM" ? parameters.get("to") : today;
  const from =
    range === "CUSTOM"
      ? parameters.get("from")
      : new Date(
          Date.parse(today + "T12:00:00Z") -
            (range === "LAST_7_DAYS" ? 6 : range === "LAST_30_DAYS" ? 29 : 0) *
              86400000,
        )
          .toISOString()
          .slice(0, 10);
  const data = adminDashboardFixture({
    range,
    from,
    to,
    asOf,
    empty: scenario === "empty",
    unavailable: scenario === "incomplete",
  });
  if (scenario === "normal") {
    for (const [i, day] of data.trend.entries())
      Object.assign(day, {
        receivedOrders: String(5 + (i % 8)),
        deliveredOrders: String(3 + (i % 5)),
        notCollectedOrders: String(1 + (i % 3)),
      });
    const sum = (key) =>
      data.trend.reduce((n, day) => n + BigInt(day[key]), BigInt(0));
    const r = sum("receivedOrders"),
      d = sum("deliveredOrders"),
      n = sum("notCollectedOrders");
    const money = (value) => value.toString() + ".00";
    const rateHundredths = ((n * BigInt(10000) + (d + n) / BigInt(2)) / (d + n))
      .toString()
      .padStart(3, "0");
    Object.assign(data.summary, {
      receivedOrders: r.toString(),
      deliveredOrders: d.toString(),
      notCollectedOrders: n.toString(),
      receivedOrderValue: money(r * BigInt(15)),
      deliveredOrderValue: money(d * BigInt(20)),
      notCollectedOrderValue: money(n * BigInt(30)),
      notCollectedUnits: (n * BigInt(3)).toString(),
      notCollectedItemValue: money(n * BigInt(30)),
      notCollectedRateDenominator: (d + n).toString(),
      notCollectedRatePercent:
        rateHundredths.slice(0, -2) + "." + rateHundredths.slice(-2),
    });
    for (const [ranking, count, unit] of [
      [data.topDeliveredProducts, d, BigInt(2)],
      [data.notCollectedProducts, n, BigInt(3)],
    ]) {
      const units = (count * unit).toString(),
        value = money(count * unit * BigInt(10));
      Object.assign(ranking.totals, {
        orders: count.toString(),
        units,
        itemValue: value,
      });
      Object.assign(ranking.items[0], {
        orders: count.toString(),
        units,
        itemValue: value,
      });
    }
    for (const check of data.coverage.checks)
      if (check.status !== "NOT_CHECKED") {
        check.examinedOrders =
          check.scope.basis === "RECORDED_TERMINAL_EVENTS"
            ? (d + n).toString()
            : { RECEIVED: r, DELIVERED: d, NOT_COLLECTED: n }[
                check.scope.eventTypes[0]
              ].toString();
      }
  }
  if (scenario === "large") {
    data.summary.receivedOrders = data.trend[0].receivedOrders =
      "900719925474099312345";
    data.summary.receivedOrderValue = "12345678901234567890123.45";
  }
  return data;
}
