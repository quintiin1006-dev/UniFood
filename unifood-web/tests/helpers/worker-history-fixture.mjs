// Published Spring DTO snapshots, shared by node and loopback browser tests.
export function workerHistoryFixture() {
  return {
    businessDate: "2026-10-14",
    nextBusinessDateAt: "2026-10-15T05:00:00Z",
    monthStart: "2026-10-01",
    rangeStart: "2026-10-01",
    rangeEnd: "2026-10-15",
    nextCursor: null,
    hasHistory: true,
    orders: [
      {
        id: "a91c6f2d-0000-0000-0000-000000000003",
        reference: "Pedido · A91C6F2D",
        clientName: /** @type {string|null} */ ("Juan Pérez"),
        status: "DELIVERED",
        completedAt: "2026-10-14T17:43:00Z",
        total: 19000,
        items: [
          {
            name: "Almuerzo del día",
            quantity: 1,
            unitPrice: 15000,
            subtotal: 15000,
          },
          { name: "Jugo", quantity: 1, unitPrice: 4000, subtotal: 4000 },
        ],
      },
      {
        id: "b72d5a10-0000-0000-0000-000000000002",
        reference: "Pedido · B72D5A10",
        clientName: "María Gómez",
        status: "NOT_COLLECTED",
        completedAt: "2026-10-14T17:20:00Z",
        total: 30000,
        items: [
          {
            name: "Almuerzo ejecutivo",
            quantity: 2,
            unitPrice: 15000,
            subtotal: 30000,
          },
        ],
      },
      {
        id: "c83e6b21-0000-0000-0000-000000000001",
        reference: "Pedido · C83E6B21",
        clientName: "Juan Rodríguez",
        status: "CANCELLED",
        completedAt: "2026-10-14T16:10:00Z",
        total: 18000,
        items: [
          {
            name: "Especial histórico",
            quantity: 1,
            unitPrice: 18000,
            subtotal: 18000,
          },
        ],
      },
    ],
  };
}

// Loopback HTTP double only. Real SQL semantics are exercised by the native PG suite.
export function workerHistoryPageFixture(data, params) {
  const labels = {
    DELIVERED: "Entregado",
    NOT_COLLECTED: "No recogido",
    CANCELLED: "Cancelado",
  };
  const normalize = (value) =>
    String(value)
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .trim()
      .replace(/\s+/g, " ");
  const q = normalize(params.get("q") || "");
  const range = params.get("range") || "MONTH";
  const status = params.get("status");
  const limit = Number(params.get("limit") || 30);
  if (
    !["TODAY", "WEEK", "MONTH"].includes(range) ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    q.length > 120 ||
    (status && !labels[status])
  )
    throw new Error("Invalid fixture request");
  const monthStart = data.businessDate.slice(0, 7) + "-01";
  let rangeStart = monthStart;
  if (range === "TODAY") rangeStart = data.businessDate;
  if (range === "WEEK") {
    const day = new Date(data.businessDate + "T12:00:00Z");
    day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
    rangeStart = day.toISOString().slice(0, 10);
    if (rangeStart < monthStart) rangeStart = monthStart;
  }
  const end = Date.parse(data.nextBusinessDateAt),
    start = Date.parse(rangeStart + "T05:00:00Z");
  const month = data.orders.filter(
    (o) =>
      labels[o.status] &&
      Date.parse(o.completedAt) >= Date.parse(monthStart + "T05:00:00Z") &&
      Date.parse(o.completedAt) < end,
  );
  let orders = month.filter(
    (o) =>
      Date.parse(o.completedAt) >= start &&
      (!status || o.status === status) &&
      (!q ||
        [
          o.reference,
          o.clientName || "",
          o.status,
          labels[o.status],
          ...o.items.map((i) => i.name),
        ].some((value) => normalize(value).includes(q))),
  );
  orders.sort(
    (a, b) =>
      Date.parse(b.completedAt) - Date.parse(a.completedAt) ||
      b.id.localeCompare(a.id),
  );
  const scope = JSON.stringify([monthStart, range, status, q, limit]);
  if (params.get("cursor")) {
    const cursor = JSON.parse(
      Buffer.from(params.get("cursor"), "base64url").toString(),
    );
    if (cursor.scope !== scope) throw new Error("Invalid fixture cursor");
    orders = orders.filter(
      (o) =>
        o.completedAt < cursor.at ||
        (o.completedAt === cursor.at && o.id < cursor.id),
    );
  }
  const page = orders.slice(0, limit),
    last = page.at(-1);
  return {
    ...data,
    monthStart,
    rangeStart,
    rangeEnd: new Date(end - 5 * 3600000).toISOString().slice(0, 10),
    orders: page,
    hasHistory: month.length > 0,
    nextCursor:
      orders.length > limit
        ? Buffer.from(
            JSON.stringify({ scope, at: last.completedAt, id: last.id }),
          ).toString("base64url")
        : null,
  };
}
