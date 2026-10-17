import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { availabilityLoader } from "./helpers/load-availability.mjs";
import { workerProfileFixture } from "./helpers/worker-profile-fixture.mjs";
function render(overrides = {}) {
  const load = availabilityLoader({
    mocks: {
      [path.resolve("features/worker-profile/useWorkerProfile.ts")]: {
        useWorkerProfile: () => ({
          data: workerProfileFixture(),
          loading: false,
          error: null,
          retry() {},
          ...overrides,
        }),
      },
    },
  });
  return renderToStaticMarkup(
    React.createElement(
      load("features/worker-profile/components/WorkerProfilePanel.tsx")
        .WorkerProfilePanel,
    ),
  );
}
test("profile is a semantic read-only card with only account and employment context", () => {
  const html = render();
  for (const text of [
    "Mi perfil",
    "Correo",
    "worker@example.invalid",
    "Rol",
    "Trabajador",
    "Información laboral",
    "Cafetería Principal",
    "Sede Villavicencio",
    "Universidad de prueba",
  ])
    assert.ok(html.includes(text), text);
  assert.match(html, /<h2[^>]*>Mi perfil<\/h2>/);
  assert.match(html, /<dl/);
  assert.match(html, /<dt/);
  assert.match(html, /<dd/);
  assert.doesNotMatch(
    html,
    /<input|<form|disabled|Editar|Guardar|contraseña|Subir foto|Cerrar sesión|Usuario|documento|teléfono|fullName|metadata|uuid/i,
  );
  assert.doesNotMatch(html, /administrativamente inactiva/);
});
test("inactive cafeteria remains readable with an explicit textual notice", () => {
  const data = workerProfileFixture();
  data.cafeteria.active = false;
  const html = render({ data });
  assert.match(html, /Esta cafetería está administrativamente inactiva\./);
  assert.match(html, /role="status"/);
  assert.match(html, /worker@example.invalid/);
});
test("accessible loading and safe error actions distinguish 401, 403, 503, 500 and 502", () => {
  const loading = render({ data: null, loading: true });
  assert.match(loading, /role="status"/);
  assert.match(loading, /Cargando tu perfil/);
  assert.doesNotMatch(loading, /worker@example.invalid/);
  for (const status of [401, 403, 503, 500, 502]) {
    const html = render({
      data: null,
      error: { status, message: "Mensaje seguro" },
    });
    assert.match(html, /role="alert"/);
    if (status === 401) {
      assert.match(html, /href="\/panel\/login"/);
      assert.doesNotMatch(html, /Reintentar/);
    } else if (status === 403)
      assert.doesNotMatch(html, /Reintentar|Iniciar sesión/);
    else assert.match(html, /<button[^>]*>Reintentar<\/button>/);
  }
});
test("profile CSS wraps arbitrary long values and dashboard mounts only the existing profile tab", () => {
  const css = fs.readFileSync(
    "features/worker-profile/components/WorkerProfile.module.css",
    "utf8",
  );
  assert.match(css, /overflow-wrap:\s*anywhere/);
  assert.match(css, /focus-visible/);
  assert.match(css, /minmax\(0,\s*1fr\)/);
  const dashboard = fs.readFileSync(
    "components/worker/WorkerDashboard.tsx",
    "utf8",
  );
  assert.match(
    dashboard,
    /activeModule === "profile"\) return <WorkerProfilePanel/,
  );
});
