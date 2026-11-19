import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { availabilityLoader } from "./helpers/load-availability.mjs";

const { PUSH_MESSAGES } = availabilityLoader()("features/shared/messages.ts");

function components() {
  const load = availabilityLoader({
    mocks: {
      [path.resolve("features/push/usePush.ts")]: { usePush: () => view() },
    },
  });
  return load("features/push/components/PushControls.tsx");
}

function view(extra = {}) {
  return {
    availability: "available",
    subscribed: false,
    busy: false,
    message: null,
    enable: async () => {},
    disable: async () => {},
    ...extra,
  };
}

const escape = (text) =>
  text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

function toggle(extra, role = "client") {
  const { PushToggleView } = components();
  return renderToStaticMarkup(
    React.createElement(PushToggleView, { role, view: view(extra) }),
  );
}

function card(extra) {
  const { PushPromptCardView } = components();
  return renderToStaticMarkup(
    React.createElement(PushPromptCardView, { view: view(extra) }),
  );
}

test("the switch reflects the subscription and is an accessible switch", () => {
  const off = toggle({});
  assert.match(off, /role="switch"/);
  assert.match(off, /aria-checked="false"/);
  assert.match(off, new RegExp(escape(PUSH_MESSAGES.toggleHintClient)));
  assert.match(toggle({ subscribed: true }), /aria-checked="true"/);
  assert.match(toggle({ busy: true }), /disabled=""/);
  assert.match(
    toggle({}, "worker"),
    new RegExp(escape(PUSH_MESSAGES.toggleHintWorker)),
  );
});

test("nothing renders before the browser was inspected", () => {
  assert.equal(toggle({ availability: null }), "");
  assert.equal(card({ availability: null }), "");
});

test("without support there is no switch, only a short message", () => {
  for (const [availability, key] of [
    ["unsupported", "unsupported"],
    ["ios-too-old", "iosTooOld"],
    ["disabled-on-server", "disabledOnServer"],
  ]) {
    const markup = toggle({ availability });
    assert.doesNotMatch(markup, /role="switch"/, availability);
    assert.match(markup, new RegExp(escape(PUSH_MESSAGES[key])), availability);
  }
});

test("a denied permission shows how to allow it, never a prompt button", () => {
  const markup = toggle({ availability: "denied" });
  assert.doesNotMatch(markup, /role="switch"/);
  assert.match(markup, new RegExp(escape(PUSH_MESSAGES.deniedTitle)));
  assert.match(markup, new RegExp(escape(PUSH_MESSAGES.deniedBody)));
  const prompt = card({ availability: "denied" });
  assert.doesNotMatch(prompt, new RegExp(`>${escape(PUSH_MESSAGES.enable)}<`));
  assert.match(prompt, new RegExp(escape(PUSH_MESSAGES.deniedBody)));
});

test("an iPhone outside the installed app gets the home-screen guide", () => {
  for (const markup of [
    toggle({ availability: "ios-install" }),
    card({ availability: "ios-install" }),
  ]) {
    assert.match(markup, new RegExp(escape(PUSH_MESSAGES.iosInstallTitle)));
    assert.match(markup, /Agregar a pantalla de inicio/);
    assert.doesNotMatch(markup, /role="switch"/);
  }
});

test("the order card asks with context and offers «Ahora no»", () => {
  const markup = card({});
  assert.match(markup, new RegExp(escape(PUSH_MESSAGES.cardTitle)));
  assert.match(markup, new RegExp(escape(PUSH_MESSAGES.cardBody)));
  assert.match(markup, new RegExp(`>${escape(PUSH_MESSAGES.enable)}<`));
  assert.match(markup, new RegExp(`>${escape(PUSH_MESSAGES.later)}<`));
  assert.match(
    card({ busy: true }),
    new RegExp(escape(PUSH_MESSAGES.enabling)),
  );
  assert.equal(card({ subscribed: true }), "");
  assert.match(
    card({ subscribed: true, message: "enabled" }),
    new RegExp(escape(PUSH_MESSAGES.enabled)),
  );
  assert.equal(
    card({ availability: "unsupported" }),
    "",
    "no card without support",
  );
  assert.match(card({ message: "failed" }), /role="alert"/);
});

test("permission is requested only from enable(), never on load", () => {
  const hook = fs.readFileSync("features/push/usePush.ts", "utf8");
  const calls = hook.split("requestPermission").length - 1;
  assert.equal(calls, 1);
  const enable = hook.slice(
    hook.indexOf("const enable"),
    hook.indexOf("const disable"),
  );
  assert.match(enable, /requestPermission/);
  const sync = hook.slice(
    hook.indexOf("const sync"),
    hook.indexOf("useEffect("),
  );
  assert.doesNotMatch(sync, /requestPermission/);
  // Re-subscribing on return only happens with a permission already granted.
  assert.match(sync, /Notification\.permission === "granted"/);
});

test("the card lives in the checkout confirmation; the client switch is only the bell (C4), the worker keeps its own", () => {
  assert.match(
    fs.readFileSync(
      "features/client/components/CheckoutConfirmation.tsx",
      "utf8",
    ),
    /<PushPromptCard \/>/,
  );
  assert.doesNotMatch(
    fs.readFileSync("features/client/components/ClientProfile.tsx", "utf8"),
    /PushToggle/,
  );
  assert.match(
    fs.readFileSync(
      "features/worker-profile/components/WorkerProfilePanel.tsx",
      "utf8",
    ),
    /<PushToggle role="worker" \/>/,
  );
});

test("push uses the UniFood icon set at 20 px or more, never a generic library", () => {
  const source = fs.readFileSync(
    "features/push/components/PushControls.tsx",
    "utf8",
  );
  assert.doesNotMatch(source, /lucide-react|react-icons/);
  assert.match(source, /@\/components\/ui\/Icon/);
  const sizes = [...source.matchAll(/<Icon[^>]*size=\{(\d+)\}/g)].map((m) =>
    Number(m[1]),
  );
  assert.ok(sizes.length >= 3);
  assert.ok(
    sizes.every((size) => size >= 20),
    String(sizes),
  );
  assert.match(toggle({}), /<svg[^>]*aria-hidden="true"/);
});
