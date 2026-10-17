// Published Spring DTO snapshots, shared by node and loopback browser tests.
export function workerHistoryFixture() {
  return {
    businessDate: "2026-10-14",
    nextBusinessDateAt: "2026-10-15T05:00:00Z",
    orders: [
      {
        id: "a91c6f2d-0000-0000-0000-000000000003",
        reference: "Pedido · A91C6F2D",
        clientName: "Juan Pérez",
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
