import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// jj/cliente-ajustes · F: Historial, Disponibilidad y Llamadas como un solo panel, con medidas
// comprobadas aquí en lugar de capturas.

const read = (file) => fs.readFileSync(file, "utf8");
const PANEL_CSS = "features/worker-ui/components/WorkerPanel.module.css";

/** Every `calc(Npx / var(--worker-zoom, 1))` of a rule, as on-screen px at the given zoom. */
function onScreen(css, selector, property, zoom) {
  const escaped = selector.replace(/[.[\]()]/g, (char) => `\\${char}`);
  const block = css.match(
    new RegExp(String.raw`(?:^|\n)${escaped} \{([^}]*)\}`),
  );
  assert.ok(block, selector);
  const line = block[1].match(
    new RegExp(String.raw`\n\s*${property}:([^;]*);`),
  );
  assert.ok(line, `${selector} ${property}`);
  // Llamadas is drawn at scale(0.7) with --worker-zoom 0.7; the others at 1 with 1.
  const scale = zoom;
  return [
    ...line[1].matchAll(/calc\(([\d.]+)px \/ var\(--worker-zoom, 1\)\)/g),
  ].map(([, px]) => +((Number(px) / zoom) * scale).toFixed(2));
}

test("F4: the three modules use the same page, panel and header components", () => {
  const files = {
    history: read("features/worker-history/components/WorkerHistoryPanel.tsx"),
    availability: read(
      "features/availability/components/AvailabilityPanel.tsx",
    ),
    calls: read("components/worker/CallsBoard.tsx"),
  };
  for (const [name, source] of Object.entries(files)) {
    assert.match(source, /panelStyles\.page/, name);
    assert.match(source, /panelStyles\.panel/, name);
    assert.match(source, /<PanelHeader/, name);
  }
  // The module name appears once, in the header; no loose title outside the panel.
  assert.equal(files.availability.match(/Disponibilidad"/g).length, 1);
  assert.doesNotMatch(files.availability, /<h2 id="availability-title">/);
  assert.doesNotMatch(files.history, /<h2 id="worker-history-title">/);
  // The nav's icons in the header.
  assert.match(files.history, /<Icon name="historial"/);
  assert.match(files.availability, /<Icon name="disponibilidad"/);
  // No copied frame: Llamadas lost its own header and frame rules.
  const calls = read("components/worker/CallsBoard.classic.module.css");
  for (const rule of [".listHeader", ".headerIcon", ".counter"])
    assert.doesNotMatch(calls, new RegExp(`\${rule} \{`), rule);
  assert.doesNotMatch(
    calls.match(/\.listPanel \{[^}]*\}/)[0],
    /border-radius|background/,
  );
});

test("F4: same maximum width, padding and radius on screen at zoom 0.7 (Llamadas) and 1", () => {
  const css = read(PANEL_CSS);
  for (const [selector, property] of [
    [".page", "max-width"],
    [".page", "padding"],
    [".panel", "border-radius"],
    [".header", "padding"],
    [".header", "min-height"],
    [".icon", "width"],
    [".icon", "height"],
    [".title", "font-size"],
  ])
    assert.deepEqual(
      onScreen(css, selector, property, 0.7),
      onScreen(css, selector, property, 1),
      `${selector} ${property}`,
    );
  assert.deepEqual(onScreen(css, ".icon", "width", 1), [52]);
  assert.deepEqual(onScreen(css, ".page", "max-width", 1), [1320]);
  assert.deepEqual(onScreen(css, ".panel", "border-radius", 1), [23]);
  assert.match(css, /\.page \{[^}]*margin-inline: auto;/);
  assert.match(css, /\.section \+ \.section \{\s*border-top: 1px solid/);
  // Historial and Disponibilidad no longer set their own width or side padding.
  const page = read("components/worker/WorkerDashboard.module.css");
  for (const module of ["historyPage", "availabilityPage"])
    assert.doesNotMatch(
      page.match(
        new RegExp(String.raw`\.${module} :global\(\.worker-main\) \{[^}]*\}`),
      )[0],
      /max-width|padding: 2/,
      module,
    );
});

test("F2: one 44 px row of solid white filters, a small «Ver detalle» and a white detail", () => {
  const css = read(
    "features/worker-history/components/WorkerHistory.module.css",
  );
  assert.match(css, /\.filters \{[^}]*display: flex;/);
  assert.match(
    css,
    /\.search \{[^}]*height: 44px;[^}]*background: var\(--color-surface\);/,
  );
  assert.match(
    css,
    /\.filter select \{[^}]*height: 44px;[^}]*background: var\(--color-surface\);/,
  );
  const toggle = css.match(/\.toggle \{[^}]*\}/)[0];
  assert.match(toggle, /background: transparent;/);
  assert.match(toggle, /font-size: 13px;/);
  // 32 px drawn, 44 px to touch.
  assert.match(css, /\.toggle::before \{[^}]*inset: -6px 0;/);
  assert.match(
    css,
    /\.detail \{[^}]*background: #ffffff;[^}]*color: var\(--color-ink\);/,
  );
});

test("F3: the cafeteria is one row, categories are sections, cards are compact and the empty line is quiet", () => {
  const panel = read("features/availability/components/AvailabilityPanel.tsx");
  assert.match(panel, /panelStyles\.section\} \$\{styles\.cafeteriaState\}/);
  assert.doesNotMatch(panel, /Estado de la cafetería<|Controla la apertura/);
  const carousel = read(
    "features/availability/components/CategoryCarousel.tsx",
  );
  assert.match(carousel, /panelStyles\.section\} \$\{styles\.category\}/);
  const css = read("features/availability/components/Availability.module.css");
  assert.match(css, /\.card \{[^}]*flex: 0 0 196px;/);
  const empty = css.match(/\.empty \{[^}]*\}/)[0];
  assert.doesNotMatch(empty, /background|border/);
});

test("F5: Mi perfil uses the same nav with the same measures as every module", () => {
  const dashboard = read("components/worker/WorkerDashboard.tsx");
  assert.equal(dashboard.match(/<BottomNav/g).length, 1);
  const page = read("components/worker/WorkerDashboard.module.css");
  // No page tweaks the nav on its own any more.
  assert.doesNotMatch(page, /> nav button/);
  assert.doesNotMatch(page, /Page > nav \{\s*margin-bottom/);
  const nav = read("components/worker/BottomNav.classic.module.css");
  for (const [selector, property] of [
    [".nav", "min-height"],
    [".nav", "padding"],
    [".nav", "border-radius"],
    [".item span", "font-size"],
  ])
    assert.deepEqual(
      onScreen(nav, selector, property, 0.7),
      onScreen(nav, selector, property, 1),
      `${selector} ${property}`,
    );
  assert.deepEqual(onScreen(nav, ".item span", "font-size", 1), [10]);
  // Icons are 20 real px everywhere (ICON_MIN_20 divides by the zoom too).
  assert.match(
    read("components/worker/BottomNav.tsx"),
    /style=\{ICON_MIN_20\}/,
  );
});
