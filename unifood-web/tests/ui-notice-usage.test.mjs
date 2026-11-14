import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { availabilityLoader } from "./helpers/load-availability.mjs";

// Ola 2: every success, error and warning message of the worker and admin panels goes through
// the shared Notice (components/ui), with the same texts and roles as before.

const screens = [
  "features/availability/components/AvailabilityPanel.tsx",
  "features/worker-history/components/WorkerHistoryPanel.tsx",
  "features/worker-profile/components/WorkerProfilePanel.tsx",
  "features/orders/components/BoardFeedback.tsx",
  "features/orders/components/OrderActionAlert.tsx",
  "features/admin/components/AdminShell.tsx",
  "features/admin-catalog/components/AdminCatalog.tsx",
  "features/admin-dashboard/components/AdminDashboard.tsx",
];

test("worker and admin response messages use the shared Notice", () => {
  for (const file of screens)
    assert.match(
      fs.readFileSync(file, "utf8"),
      /from "@\/components\/ui\/Notice"/,
      file,
    );
});

test("the action alert keeps its role, its close button and the error tone", () => {
  const { OrderActionAlert } = availabilityLoader()(
    "features/orders/components/OrderActionAlert.tsx",
  );
  const html = renderToStaticMarkup(
    React.createElement(OrderActionAlert, {
      title: "Acción no disponible",
      message: "Primero pasa a preparación el pedido más antiguo de hoy.",
      onClose() {},
    }),
  );
  assert.match(html, /role="alert"/);
  assert.match(html, /notice_error/);
  assert.match(html, /Acción no disponible/);
  assert.match(html, /aria-label="Cerrar aviso"/);
});
