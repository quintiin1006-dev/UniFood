import { test } from "node:test";
import assert from "node:assert/strict";
import { availabilityLoader } from "./helpers/load-availability.mjs";

const load = availabilityLoader();
const { SuperAdminStore } = load("features/super-admin/state.ts");
const { SuperAdminError } = load("features/super-admin/errors.ts");
const presentation = load("features/super-admin/presentation.ts");
const tick = () => new Promise((resolve) => setImmediate(resolve));

const CENTRAL = "00000000-0000-0000-0000-0000000000c1";
const none = (version = 0) => ({
  model: "NONE",
  perOrderFeeCop: null,
  subscriptionFeeCop: null,
  version,
});
const cafeteria = (patch = {}) => ({
  id: CENTRAL,
  name: "Cafetería Central",
  visible: true,
  hasActiveAdmin: true,
  billing: none(),
  ...patch,
});
const tree = (cafeterias) => ({
  institutions: [
    {
      id: "00000000-0000-0000-0000-0000000000a1",
      name: "Universidad",
      active: true,
      sites: [
        {
          id: "00000000-0000-0000-0000-0000000000b1",
          name: "Sede Principal",
          city: "Villavicencio",
          active: true,
          cafeterias,
        },
      ],
    },
  ],
});

function api(overrides = {}) {
  const calls = [];
  return {
    calls,
    async cafeterias() {
      calls.push(["list"]);
      return tree([cafeteria()]);
    },
    async audit(id) {
      calls.push(["audit", id]);
      return { entries: [] };
    },
    async visibility(id, command) {
      calls.push(["visibility", id, command]);
      return cafeteria({ visible: command.visible });
    },
    async billing(id, command) {
      calls.push(["billing", id, command]);
      const { expectedVersion, ...billing } = command;
      return cafeteria({
        billing: { ...billing, version: expectedVersion + 1 },
      });
    },
    ...overrides,
  };
}

test("SA1: summary plurals and SA2: administrator labels without role codes", () => {
  const { summaryText, adminLabel, visibilityLabel } = presentation;
  assert.equal(
    summaryText({ cafeterias: 1, sites: 1, institutions: 1, visible: 1 }),
    "1 cafetería en 1 sede de 1 institución · 1 visible para los clientes.",
  );
  assert.equal(
    summaryText({ cafeterias: 3, sites: 2, institutions: 2, visible: 0 }),
    "3 cafeterías en 2 sedes de 2 instituciones · 0 visibles para los clientes.",
  );
  assert.equal(adminLabel(true), "Asignado");
  assert.equal(adminLabel(false), "Sin administrador activo");
  assert.equal(visibilityLabel(false), "Oculta");
});

test("billing labels and the form's peso rules match migration 022", () => {
  const {
    billingLabel,
    draftBilling,
    parsePesos,
    FEE_INVALID,
    MONTHLY_INVALID,
  } = presentation;
  assert.equal(billingLabel(none()), "Sin cobro");
  assert.equal(
    billingLabel({
      model: "PER_ORDER_FEE",
      perOrderFeeCop: 1000,
      subscriptionFeeCop: null,
    }),
    "Comisión de $1.000 por pedido",
  );
  assert.equal(
    billingLabel({
      model: "SUBSCRIPTION",
      perOrderFeeCop: null,
      subscriptionFeeCop: 250000,
    }),
    "Suscripción de $250.000 al mes",
  );
  assert.equal(
    billingLabel({
      model: "SUBSCRIPTION",
      perOrderFeeCop: null,
      subscriptionFeeCop: null,
    }),
    "Suscripción",
  );
  for (const [text, value] of [
    ["1000", 1000],
    ["1.000", 1000],
    ["$ 1.000.000", 1000000],
    ["1000.5", null],
    ["1,000", null],
    ["-5", null],
    ["", null],
    ["1.00", null],
  ])
    assert.equal(parsePesos(text), value, text);
  const draft = (model, perOrderFee = "", subscriptionFee = "") =>
    draftBilling({ model, perOrderFee, subscriptionFee });
  assert.deepEqual(draft("PER_ORDER_FEE", "1.000", "50000"), {
    billing: {
      model: "PER_ORDER_FEE",
      perOrderFeeCop: 1000,
      subscriptionFeeCop: null,
    },
  });
  for (const fee of ["", "0", "1000001", "12,5"])
    assert.deepEqual(draft("PER_ORDER_FEE", fee), { error: FEE_INVALID });
  assert.deepEqual(draft("SUBSCRIPTION", "1000", ""), {
    billing: {
      model: "SUBSCRIPTION",
      perOrderFeeCop: null,
      subscriptionFeeCop: null,
    },
  });
  assert.deepEqual(draft("SUBSCRIPTION", "", "250.000"), {
    billing: {
      model: "SUBSCRIPTION",
      perOrderFeeCop: null,
      subscriptionFeeCop: 250000,
    },
  });
  for (const monthly of ["0", "100000001", "abc"])
    assert.deepEqual(draft("SUBSCRIPTION", "", monthly), {
      error: MONTHLY_INVALID,
    });
  assert.deepEqual(draft("NONE", "1000", "5000"), {
    billing: { model: "NONE", perOrderFeeCop: null, subscriptionFeeCop: null },
  });
});

test("history lines name who, a manual SQL change and the initial row", () => {
  const { auditWho, auditChange } = presentation;
  const base = { changedAt: "2026-11-12T15:00:00Z" };
  assert.equal(
    auditWho({ ...base, source: "SQL", changedBy: null }),
    "Cambio manual (SQL)",
  );
  assert.equal(
    auditWho({ ...base, source: "API", changedBy: { name: "Dueño" } }),
    "Dueño",
  );
  assert.equal(
    auditChange({
      setting: "VISIBILITY",
      oldValue: { visible: true },
      newValue: { visible: false },
    }),
    "Visibilidad: Visible → Oculta",
  );
  assert.equal(
    auditChange({ setting: "BILLING", oldValue: null, newValue: none() }),
    "Cobro inicial: Sin cobro",
  );
  assert.equal(
    auditChange({
      setting: "BILLING",
      oldValue: none(),
      newValue: {
        model: "PER_ORDER_FEE",
        perOrderFeeCop: 1500,
        subscriptionFeeCop: null,
      },
    }),
    "Cobro: Sin cobro → Comisión de $1.500 por pedido",
  );
});

test("saving sends the expected value from the listing, then announces it and reloads the history", async () => {
  const fake = api();
  const store = new SuperAdminStore(fake);
  await store.load();
  store.select(CENTRAL);
  await tick();
  assert.equal(await store.setVisibility(CENTRAL, false), true);
  await tick();
  let state = store.getSnapshot();
  assert.equal(state.notice, "Cambios guardados.");
  assert.equal(
    state.data.institutions[0].sites[0].cafeterias[0].visible,
    false,
  );
  assert.deepEqual(fake.calls[2], [
    "visibility",
    CENTRAL,
    { visible: false, expectedVisible: true },
  ]);
  assert.deepEqual(fake.calls[3], ["audit", CENTRAL]);
  assert.equal(
    await store.setBilling(CENTRAL, {
      model: "SUBSCRIPTION",
      perOrderFeeCop: null,
      subscriptionFeeCop: 250000,
    }),
    true,
  );
  state = store.getSnapshot();
  assert.deepEqual(fake.calls[4][2], {
    model: "SUBSCRIPTION",
    perOrderFeeCop: null,
    subscriptionFeeCop: 250000,
    expectedVersion: 0,
  });
  assert.equal(
    state.data.institutions[0].sites[0].cafeterias[0].billing.version,
    1,
  );
  assert.equal(state.saving, null);
});

test("a conflict stays next to its control and reloads the current values", async () => {
  const fake = api({
    async visibility() {
      throw new SuperAdminError(409, "VISIBILITY_STATE_CHANGED", "save");
    },
  });
  const store = new SuperAdminStore(fake);
  await store.load();
  store.select(CENTRAL);
  assert.equal(await store.setVisibility(CENTRAL, false), false);
  await tick();
  const state = store.getSnapshot();
  assert.deepEqual(state.controlError, {
    control: "visibility",
    message:
      "Otra persona cambió esta cafetería. Revisa el valor actual e inténtalo de nuevo.",
  });
  assert.equal(state.notice, null);
  assert.equal(fake.calls.filter(([kind]) => kind === "list").length, 2);
});

test("a temporary failure says the change was not saved; a denied session clears everything", async () => {
  const store = new SuperAdminStore(
    api({
      async billing() {
        throw new SuperAdminError(503, undefined, "save");
      },
      async visibility() {
        throw new SuperAdminError(403);
      },
    }),
  );
  await store.load();
  store.select(CENTRAL);
  await store.setBilling(CENTRAL, {
    model: "PER_ORDER_FEE",
    perOrderFeeCop: 1000,
    subscriptionFeeCop: null,
  });
  assert.equal(
    store.getSnapshot().controlError.message,
    "No pudimos guardar el cambio. Inténtalo de nuevo.",
  );
  await store.setVisibility(CENTRAL, false);
  const state = store.getSnapshot();
  assert.equal(state.data, null);
  assert.equal(state.selected, null);
  assert.equal(state.error.status, 403);
});

test("a second save waits for the first, and selection does not change meanwhile", async () => {
  let release;
  const fake = api({
    visibility: (id, command) =>
      new Promise((resolve) => {
        release = () => resolve(cafeteria({ visible: command.visible }));
      }),
  });
  const store = new SuperAdminStore(fake);
  await store.load();
  store.select(CENTRAL);
  const first = store.setVisibility(CENTRAL, false);
  assert.equal(await store.setBilling(CENTRAL, none()), false);
  store.select(null);
  assert.equal(store.getSnapshot().selected, CENTRAL);
  release();
  assert.equal(await first, true);
});
