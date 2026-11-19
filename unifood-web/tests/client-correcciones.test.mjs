import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { availabilityLoader } from "./helpers/load-availability.mjs";
import { loadTs } from "./helpers/load-ts.mjs";

// jj/cliente-correcciones: cambiar contraseña en dos pasos y un solo estilo del worker.

const read = (file) => fs.readFileSync(file, "utf8");
const messages = loadTs("features/shared/messages.ts");
const screen = () => read("features/auth/components/AuthScreen.tsx");

test("the address travels outside the URL, with whether the code already went out", () => {
  const storage = new Map();
  globalThis.sessionStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  };
  const handoff = loadTs("features/auth/recoveryHandoff.ts");
  handoff.handRecoveryEmail("  Ana@Uni.EDU.co ");
  assert.equal(handoff.readRecoveryEmail(), "ana@uni.edu.co");
  assert.equal(handoff.readRecoverySent(), false);
  handoff.handRecoveryEmail("ana@uni.edu.co", true);
  assert.equal(handoff.readRecoverySent(), true);
  handoff.clearRecoveryEmail();
  assert.equal(handoff.readRecoveryEmail(), null);
  assert.equal(handoff.readRecoverySent(), false);
  delete globalThis.sessionStorage;
  assert.doesNotMatch(screen(), /recuperar-contrasena\?[^"]*email=/);
});

test("step 1: «Cambiar contraseña», the known address and only «Enviar código de verificación»", () => {
  const source = screen();
  assert.equal(messages.RECOVERY_TITLE, "Cambiar contraseña");
  assert.equal(messages.RECOVERY_SEND, "Enviar código de verificación");
  // The address field is only there when the address is not known.
  assert.match(source, /isRecovery && step === 0 && !knownEmail\)\) && \(/);
  assert.match(source, /recoverySendTo\(email\)/);
  // No automatic sending: the button sends the code.
  assert.doesNotMatch(source, /await sendRecoveryCode\(handed\)/);
  // Three steps: the code alone is step 2, the new password is step 3.
  assert.match(source, /const isOtp = !isLogin && step === 1;/);
  assert.match(source, /const isPassword = isRecovery && step === 2;/);
});

test("sending shows a 5 s toast with the same generic text for every address", () => {
  const source = screen();
  assert.equal(
    messages.RECOVERY_CODE_SENT,
    "Te enviamos un código de verificación a tu correo registrado",
  );
  assert.match(source, /const TOAST_MS = 5000;/);
  assert.match(source, /showToast\(RECOVERY_CODE_SENT\)/);
  assert.match(
    source,
    /className=\{styles\.toastRegion\} role="status" aria-live="polite"/,
  );
  const css = read("features/auth/components/AuthScreen.module.css");
  assert.match(
    css,
    /prefers-reduced-motion: reduce\) \{\s*\.toast \{\s*animation: none;/,
  );
});

test("step 2: only the code (6 digits, numeric, one-time-code), «Verificar código» and a 30 s resend; step 3: the new password", () => {
  const source = screen();
  assert.equal(messages.RECOVERY_VERIFY, "Verificar código");
  assert.match(source, /isRecovery\s*\?\s*RECOVERY_VERIFY/);
  // The code is verified on its own, before any password is asked.
  assert.doesNotMatch(source, /isOtp && isRecovery/);
  // A reset refused for a lost code session returns to step 2.
  assert.match(source, /failure\.status === 401\) \{\s*setStep\(1\);/);
  assert.match(source, /autoComplete="one-time-code"/);
  assert.match(source, /inputMode="numeric"/);
  assert.equal(messages.RECOVERY_NEW_PASSWORD, "Nueva contraseña");
  assert.equal(
    messages.RECOVERY_CONFIRM_PASSWORD,
    "Confirmar nueva contraseña",
  );
  assert.equal(messages.RECOVERY_SUBMIT, "Cambiar contraseña");
  assert.match(source, /const RECOVERY_RESEND_SECONDS = 30;/);
  assert.equal(messages.recoveryResendIn(23), "Reenviar código en 23 s");
  // The code comes first, then the passwords.
  assert.ok(
    source.indexOf('id="otp-code"') < source.indexOf('name="new-password"'),
  );
  // Done: «Contraseña actualizada» and back to signing in.
  assert.match(source, /showToast\(PASSWORD_UPDATED\)/);
  assert.equal(messages.PASSWORD_UPDATED, "Contraseña actualizada");
});

test("from «Mi perfil» step 1 sends the code to the account address, without fixed notes", () => {
  const page = read("features/client/components/ClientPassword.tsx");
  assert.match(page, /<SendRecoveryCode email=\{email\}/);
  assert.doesNotMatch(page, /volverás a iniciar sesión/);
  const send = read("features/auth/components/SendRecoveryCode.tsx");
  assert.match(send, /fetch\("\/api\/auth\/recover"/);
  assert.match(send, /handRecoveryEmail\(email, true\)/);
  assert.match(
    read("app/cuenta/perfil/contrasena/page.tsx"),
    /email=\{profile\.email\}/,
  );
});

// ---------- Worker: one header, one look ----------

const headerFor = (activeModule) => {
  const load = availabilityLoader({
    mocks: {
      "next/image": {
        __esModule: true,
        default: (props) => React.createElement("img", { alt: props.alt }),
      },
      "@/features/auth/components/LogoutButton": {
        __esModule: true,
        default: () => React.createElement("button", null, "Cerrar sesión"),
      },
    },
  });
  const Header = load("components/worker/Header.tsx").default;
  return renderToStaticMarkup(
    React.createElement(Header, {
      activeModule,
      search: "",
      onSearchChange() {},
      variant:
        activeModule === "orders" || activeModule === "calls"
          ? "classic"
          : "modern",
    }),
  );
};

test("the five worker modules use the same header, 64 px tall with a 40 px logo", () => {
  const classes = new Set();
  for (const moduleName of [
    "orders",
    "calls",
    "history",
    "availability",
    "profile",
  ]) {
    const html = headerFor(moduleName);
    classes.add(html.match(/<header class="([^"]+)"/)[1]);
    // Search only in Pedidos and Llamadas.
    const searches = moduleName === "orders" || moduleName === "calls";
    assert.equal(/role="search"/.test(html), searches, moduleName);
  }
  assert.equal(classes.size, 1);
  const css = read("components/worker/Header.classic.module.css");
  assert.match(css, /height: calc\(64px \/ var\(--worker-zoom, 1\)\);/);
  assert.match(css, /width: calc\(40px \/ var\(--worker-zoom, 1\)\);/);
});

test("Historial and Disponibilidad share the Pedidos surface, page and watermark", () => {
  const surfaces = read("components/worker/surfaces.module.css");
  assert.match(surfaces, /\.glass \{/);
  assert.match(read("components/worker/KanbanBoard.tsx"), /surfaces\.glass/);
  // jj/cliente-ajustes · F: Historial, Disponibilidad and Llamadas are one shared glass panel.
  for (const file of [
    "features/worker-history/components/WorkerHistoryPanel.tsx",
    "features/availability/components/AvailabilityPanel.tsx",
    "components/worker/CallsBoard.tsx",
  ])
    assert.match(read(file), /panelStyles\.panel/, file);
  const page = read("components/worker/WorkerDashboard.module.css");
  assert.match(page, /\.brandedPage:global\(\.worker-page\)/);
  const opacity = Number(
    page.match(
      /\.brandedPage :global\(\.worker-main\)::before \{[^}]*opacity: ([\d.]+);/,
    )[1],
  );
  assert.ok(opacity <= 0.08);
  // No big white sheet and no inner scroll in the two modules.
  const history = read(
    "features/worker-history/components/WorkerHistory.module.css",
  );
  const availability = read(
    "features/availability/components/Availability.module.css",
  );
  for (const css of [history, availability]) {
    const panel = css.match(/\.panel \{[^}]*\}/)[0];
    assert.doesNotMatch(panel, /background/);
    assert.match(panel, /overflow: visible/);
  }
  // Fields stay solid white.
  assert.match(
    history,
    /\.filter select \{[^}]*background: var\(--color-surface\)/,
  );
  assert.match(history, /\.search \{[^}]*background: var\(--color-surface\)/);
});
