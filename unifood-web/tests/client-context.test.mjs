import { test } from "node:test";
import assert from "node:assert/strict";
import { loadTs } from "./helpers/load-ts.mjs";
import { availabilityLoader } from "./helpers/load-availability.mjs";

const domain = loadTs("features/client/domain/context.ts");
const fixtures = loadTs("tests/fixtures/client-menu.ts");
const context = () =>
  domain.toClientContext(structuredClone(fixtures.clientContext));

test("the context keeps sites, subscribed cafeterias and today's open state", () => {
  const parsed = context();
  assert.deepEqual(parsed.institution, {
    id: fixtures.clientContext.institution.id,
    name: "Universidad de prueba",
  });
  assert.equal(parsed.fullName, "Usuario de prueba");
  assert.equal(parsed.activeOrderId, null);
  assert.deepEqual(
    parsed.sites.map(({ name, cafeterias }) => [
      name,
      cafeterias.map(({ open }) => open),
    ]),
    [
      ["Sede Principal", [true, false]],
      ["Sede Aguas Claras", [true, true]],
      ["Sede Norte", []],
    ],
  );
  // The document and the client type are not part of what the screens keep.
  assert.equal("clientType" in parsed, false);
});

test("malformed sites and cafeterias are dropped; a bad top level is null", () => {
  const body = structuredClone(fixtures.clientContext);
  body.activeOrder = { id: "o1" };
  body.sites.push(
    { id: "s9", name: "Sin lista" },
    { name: "Sin id", cafeterias: [] },
    null,
  );
  body.sites[0].cafeterias.push(
    { id: "c9", name: "Sin estado" },
    { id: fixtures.CAFETERIA_CENTRAL, name: "Repetida", open: true },
  );
  const parsed = domain.toClientContext(body);
  assert.equal(parsed.activeOrderId, "o1");
  assert.equal(parsed.sites.length, 3);
  assert.equal(parsed.sites[0].cafeterias.length, 2);
  for (const payload of [
    null,
    { sites: [] },
    { institution: { id: "i" }, sites: [] },
    { institution: { id: "i", name: "U" } },
  ])
    assert.equal(domain.toClientContext(payload), null);
});

test("Inicio shows the selection until a cafeteria from the context is chosen", () => {
  const parsed = context();
  assert.deepEqual(Object.keys(domain.resolveSelection(parsed, {})).sort(), [
    "choosing",
    "sites",
    "stale",
    "view",
  ]);
  assert.equal(domain.resolveSelection(parsed, {}).view, "sites");
  const home = domain.resolveSelection(parsed, {
    cafeteria: fixtures.CAFETERIA_BLOQUE_B,
  });
  assert.equal(home.view, "home");
  assert.equal(home.site.name, "Sede Principal");
  assert.equal(home.cafeteria.open, false);
  const site = domain.resolveSelection(parsed, {
    sede: fixtures.SITE_AGUAS_CLARAS,
  });
  assert.equal(site.view, "cafeterias");
  assert.equal(site.site.cafeterias.length, 2);
  assert.equal(site.choosing, true);
  const empty = domain.resolveSelection(parsed, { sede: fixtures.SITE_NORTE });
  assert.equal(empty.view, "cafeterias");
  assert.deepEqual(empty.site.cafeterias, []);
});

test("a cafeteria the context no longer lists returns to the selection", () => {
  for (const cafeteria of ["00000000-0000-4000-8000-999999999999", ["x"], ""]) {
    const selection = domain.resolveSelection(context(), { cafeteria });
    assert.notEqual(selection.view, "home");
    assert.equal(selection.stale, typeof cafeteria === "string");
  }
});

test("a single option skips the step but the selector can still open it", () => {
  const single = domain.toClientContext(fixtures.singleCafeteriaContext);
  const home = domain.resolveSelection(single, {});
  assert.equal(home.view, "home");
  assert.equal(home.cafeteria.id, fixtures.CAFETERIA_CENTRAL);
  const choosing = domain.resolveSelection(single, { elegir: "1" });
  assert.equal(choosing.view, "cafeterias");
  assert.equal(choosing.singleSite, true);
  assert.equal(domain.CHANGE_CAFETERIA_HREF, "/cuenta?elegir=1");
  // With one site, the site step is skipped and its cafeterias are listed.
  const oneSite = structuredClone(fixtures.clientContext);
  oneSite.sites = oneSite.sites.slice(0, 1);
  assert.equal(
    domain.resolveSelection(domain.toClientContext(oneSite), {}).view,
    "cafeterias",
  );
});

test("a site with one cafeteria links straight to it", () => {
  const parsed = context();
  assert.equal(
    domain.siteHref({
      ...parsed.sites[0],
      cafeterias: parsed.sites[0].cafeterias.slice(0, 1),
    }),
    `/cuenta?cafeteria=${fixtures.CAFETERIA_CENTRAL}`,
  );
  assert.equal(
    domain.siteHref(parsed.sites[1]),
    `/cuenta?sede=${fixtures.SITE_AGUAS_CLARAS}`,
  );
});

function serverContext({
  auth = {
    accessToken: "verified",
    profile: { id: "u", active: true, roles: ["CLIENT"] },
  },
  respond,
} = {}) {
  const calls = [];
  const load = availabilityLoader({
    fetchMock: async (url, options) => {
      calls.push({ url: String(url), options });
      return respond();
    },
    mocks: {
      "@/features/auth/server/session": { getAuth: async () => auth },
    },
  });
  return {
    calls,
    loadClientContext: load("features/client/server/context.ts")
      .loadClientContext,
  };
}

test("the context client reads Spring through the BFF forward with the session bearer", async () => {
  const { calls, loadClientContext } = serverContext({
    respond: () => Response.json(fixtures.clientContext),
  });
  const result = await loadClientContext();
  assert.equal(result.status, "ok");
  assert.equal(result.context.sites.length, 3);
  assert.equal(calls[0].url, "http://backend.test:8080/api/me/context");
  assert.equal(calls[0].options.headers.authorization, "Bearer verified");
  assert.equal(calls[0].options.cache, "no-store");
  assert.equal(calls[0].options.redirect, "error");
});

test("context failures become one retryable error state without Spring text", async () => {
  for (const respond of [
    () =>
      Response.json(
        { code: "CLIENT_PROFILE_NOT_FOUND", message: "PRIVATE" },
        { status: 404 },
      ),
    () => Response.json({ message: "PRIVATE" }, { status: 503 }),
    () => new Response("<html>PRIVATE</html>", { status: 200 }),
    () => Response.json({ sites: "PRIVATE" }),
    () => {
      throw new TypeError("PRIVATE");
    },
  ]) {
    const { loadClientContext } = serverContext({ respond });
    assert.deepEqual(await loadClientContext(), { status: "error" });
  }
  const anonymous = serverContext({
    auth: null,
    respond: () => Response.json(fixtures.clientContext),
  });
  assert.deepEqual(await anonymous.loadClientContext(), { status: "error" });
  assert.equal(anonymous.calls.length, 0);
  const worker = serverContext({
    auth: {
      accessToken: "t",
      profile: { id: "w", active: true, roles: ["WORKER"] },
    },
    respond: () => Response.json(fixtures.clientContext),
  });
  assert.deepEqual(await worker.loadClientContext(), { status: "error" });
  assert.equal(worker.calls.length, 0);
});
