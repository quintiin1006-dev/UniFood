const events = ["RECEIVED", "DELIVERED", "NOT_COLLECTED"];
const instant = (value) => new Date(value).toISOString().replace(".000Z", "Z");
const tomorrow = (date) => instant(Date.parse(date + "T05:00:00Z") + 86400000);

/** Mirrors AdminDashboardResponse and the checks emitted by AdminDashboardService. No student data. */
export function adminDashboardFixture({
  range = "CUSTOM",
  from = "2024-01-01",
  to = from,
  asOf = "2026-10-24T17:00:00Z",
  limit = 10,
  empty = false,
  unavailable = false,
} = {}) {
  const calendarEndExclusive = tomorrow(to);
  const startInclusive = from + "T05:00:00Z";
  const partial = Date.parse(asOf) < Date.parse(calendarEndExclusive);
  const endExclusive = partial ? asOf : calendarEndExclusive;
  const selected = () => (empty ? "0" : "1");
  const check = (code, basis, eventTypes, examined = "0", affected = "0") => ({
    code,
    status: affected === "0" ? "PASS" : "WARN",
    scope: { basis, eventTypes, startInclusive, endExclusive },
    examinedOrders: examined,
    affectedOrders: affected,
    assessedAt: asOf,
  });
  const checks = [
    check(
      "TERMINAL_DATE_VALIDITY",
      "RECORDED_TERMINAL_EVENTS",
      ["DELIVERED", "NOT_COLLECTED"],
      empty ? "0" : "2",
    ),
    check(
      "TERMINAL_DATE_VALIDITY",
      "CREATED_COHORT",
      ["RECEIVED"],
      selected("RECEIVED"),
    ),
    ...events.flatMap((event) => [
      check(
        "HEADER_AMOUNT_VALIDITY",
        "SELECTED_EVENT_ORDERS",
        [event],
        selected(event),
      ),
      check(
        "ITEM_INTEGRITY",
        "SELECTED_EVENT_ORDERS",
        [event],
        selected(event),
        unavailable && event === "NOT_COLLECTED" ? "1" : "0",
      ),
      check(
        "HEADER_ITEM_RECONCILIATION",
        "SELECTED_EVENT_ORDERS",
        [event],
        unavailable && event === "NOT_COLLECTED" ? "0" : selected(event),
      ),
      check(
        "HISTORICAL_NAME",
        "SELECTED_EVENT_ORDERS",
        [event],
        selected(event),
      ),
    ]),
    {
      code: "UNDATED_TERMINALS",
      status: "NOT_CHECKED",
      scope: {
        basis: "CAFETERIA_ALL_HISTORY",
        eventTypes: ["DELIVERED", "NOT_COLLECTED", "CANCELLED"],
        startInclusive: null,
        endExclusive: null,
      },
      examinedOrders: null,
      affectedOrders: null,
      assessedAt: asOf,
    },
  ];
  const ranking = (uncollected) => ({
    availability:
      unavailable && uncollected ? "UNAVAILABLE_INCOMPLETE_ITEMS" : "AVAILABLE",
    limit,
    hasMore: false,
    totals:
      unavailable && uncollected
        ? { products: null, orders: null, units: null, itemValue: null }
        : {
            products: empty ? "0" : "1",
            orders: empty ? "0" : "1",
            units: empty ? "0" : uncollected ? "3" : "2",
            itemValue: empty ? "0.00" : uncollected ? "30.00" : "20.00",
          },
    omitted:
      unavailable && uncollected
        ? { products: null, units: null, itemValue: null }
        : { products: "0", units: "0", itemValue: "0.00" },
    items:
      empty || (unavailable && uncollected)
        ? []
        : [
            {
              productId: uncollected
                ? "10000000-0000-0000-0000-000000000002"
                : "10000000-0000-0000-0000-000000000001",
              historicalName: uncollected
                ? "Almuerzo histórico"
                : "Desayuno histórico",
              units: uncollected ? "3" : "2",
              orders: "1",
              itemValue: uncollected ? "30.00" : "20.00",
              unitSharePercent: uncollected ? "100.00" : null,
            },
          ],
  });
  const trend = [];
  for (
    let day = Date.parse(from + "T00:00:00Z");
    day <= Date.parse(to + "T00:00:00Z");
    day += 86400000
  )
    trend.push({
      date: new Date(day).toISOString().slice(0, 10),
      receivedOrders: !empty && trend.length === 0 ? "1" : "0",
      deliveredOrders: !empty && trend.length === 0 ? "1" : "0",
      notCollectedOrders: !empty && trend.length === 0 ? "1" : "0",
    });
  return {
    period: {
      range,
      from,
      to,
      timezone: "America/Bogota",
      startInclusive,
      calendarEndExclusive,
      endExclusive,
      asOf,
      partial,
    },
    basis: "EVENT_DATE",
    currency: "COP",
    summary: {
      receivedOrders: empty ? "0" : "1",
      deliveredOrders: empty ? "0" : "1",
      notCollectedOrders: empty ? "0" : "1",
      notCollectedUnits: unavailable ? null : empty ? "0" : "3",
      receivedOrderValue: empty ? "0.00" : "30.00",
      deliveredOrderValue: empty ? "0.00" : "20.00",
      notCollectedOrderValue: empty ? "0.00" : "30.00",
      notCollectedItemValue: unavailable ? null : empty ? "0.00" : "30.00",
      notCollectedRatePercent: empty ? null : "50.00",
      notCollectedRateDenominator: empty ? "0" : "2",
    },
    trend,
    topDeliveredProducts: ranking(false),
    notCollectedProducts: ranking(true),
    coverage: {
      assessment: "LIMITED",
      assessedAt: asOf,
      checks,
      provenance: { status: "UNKNOWN", verifiedRealOrders: null },
      warnings: [
        {
          code: "UNDATED_TERMINALS_NOT_ASSESSED",
          affects: ["TERMINAL_METRICS"],
        },
        { code: "UNVERIFIED_ORDER_PROVENANCE", affects: ["ALL_METRICS"] },
        ...(empty
          ? [{ code: "NO_VERIFIABLE_EVENTS", affects: ["ALL_METRICS"] }]
          : []),
        ...(unavailable
          ? [
              {
                code: "INCOMPLETE_ITEMS_NOT_COLLECTED",
                affects: ["NOT_COLLECTED_ITEM_METRICS"],
              },
            ]
          : []),
      ],
    },
  };
}
