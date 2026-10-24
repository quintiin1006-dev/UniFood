import { test } from "node:test";
import assert from "node:assert/strict";
import { availabilityLoader } from "./helpers/load-availability.mjs";
import { adminCatalogFixture } from "./helpers/admin-catalog-fixture.mjs";
import { productImageFixture } from "./helpers/product-image-fixture.mjs";

const product = adminCatalogFixture().products[0];
const key = "99999999-0000-0000-0000-000000000001";
const path = `/api/admin/catalog/${product.id}/image`;
const operation = (state = "APPLIED") => ({
  operationId: key,
  state,
  appliedVersion: state === "APPLIED" ? "1" : null,
  failureStatus: null,
  failureCode: null,
  product: { ...product, version: "1", imageUrl: `${path}/${key}` },
});
const identity = { id: "verified", accessToken: "server-token" };
function loader(
  fetchMock,
  auth = identity,
  profile = { id: "verified", active: true, roles: ["ADMIN"] },
) {
  return availabilityLoader({
    fetchMock,
    mocks: {
      "@/features/auth/server/identity": {
        getVerifiedAuthIdentity: async () => auth,
      },
      "@/features/auth/server/client": {
        authClient: async () => ({
          rpc: async () => ({ data: profile, error: null }),
        }),
      },
    },
  });
}
function request({
  file = productImageFixture(),
  type = "image/png",
  version = "0",
  origin = "http://browser",
  extra = false,
} = {}) {
  const form = new FormData();
  form.set("file", new Blob([file], { type }), "PRIVATE-original.png");
  form.set("expectedVersion", version);
  if (extra) form.set("cafeteriaId", "forged");
  return new Request("http://browser" + path, {
    method: "PUT",
    headers: { origin, "Idempotency-Key": key, authorization: "Bearer forged" },
    body: form,
  });
}
test("private image parsing admits only exact product-scoped routes and preserves legacy sources", () => {
  const load = loader();
  const { parseAdminCatalog } = load("features/admin-catalog/contracts.ts");
  const { productImageSource } = load("features/availability/presentation.ts");
  for (const [imageUrl, expected] of [
    [`${path}/${key}`, `${path}/${key}`],
    ["/unifood-logo.png", "/unifood-logo.png"],
    ["https://evil.test/a.png", null],
    [`${path}/${key}?token=secret`, null],
    [`/api/admin/catalog/${key}/image/${key}`, null],
  ])
    assert.equal(
      parseAdminCatalog({ products: [{ ...product, imageUrl }] }).products[0]
        .imageUrl,
      expected,
    );
  assert.equal(
    productImageSource(`${path}/${key}`),
    null,
    "WORKER policy is unchanged",
  );
});
test("upload BFF forwards verified token, sanitized multipart and stable private response", async () => {
  const forward = loader(async (url, options) => {
    assert.equal(url, "http://backend.test:8080" + path);
    assert.equal(options.method, "PUT");
    assert.equal(options.headers.authorization, "Bearer server-token");
    assert.equal(options.headers["Idempotency-Key"], key);
    assert.equal(options.redirect, "error");
    assert.equal(options.cache, "no-store");
    assert.equal(options.body.get("file").name, "image");
    assert.equal(options.body.get("expectedVersion"), "0");
    return Response.json(
      { ...operation(), storageSecret: "PRIVATE" },
      { headers: { "set-cookie": "PRIVATE" } },
    );
  })("features/admin-catalog/server/images.ts").forwardCatalogImage;
  const response = await forward(request(), product.id, "upload");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), operation());
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("set-cookie"), null);
});
test("image mutations reject origin, tenant selectors, duplicate fields, oversize, unsupported MIME and malformed versions", async () => {
  const forward = loader(() => assert.fail("No upstream request"))(
    "features/admin-catalog/server/images.ts",
  ).forwardCatalogImage;
  for (const [input, expected] of [
    [{ origin: "http://evil" }, 403],
    [{ extra: true }, 400],
    [{ version: "-1" }, 400],
    [{ type: "image/svg+xml" }, 415],
    [{ file: Buffer.alloc(3 * 1024 * 1024 + 1) }, 413],
  ])
    assert.equal(
      (await forward(request(input), product.id, "upload")).status,
      expected,
    );
  const duplicate = request();
  const data = await duplicate.formData();
  data.append("expectedVersion", "1");
  assert.equal(
    (
      await forward(
        new Request(duplicate.url, {
          method: "PUT",
          headers: { origin: "http://browser", "Idempotency-Key": key },
          body: data,
        }),
        product.id,
        "upload",
      )
    ).status,
    400,
  );
});
test("image BFF rejects absent, inactive, mixed-role and mismatched identity before forwarding", async () => {
  for (const [auth, profile, expected] of [
    [null, null, 401],
    [identity, { id: "verified", active: false, roles: ["ADMIN"] }, 403],
    [
      identity,
      { id: "verified", active: true, roles: ["ADMIN", "WORKER"] },
      403,
    ],
    [identity, { id: "other", active: true, roles: ["ADMIN"] }, 403],
  ]) {
    const forward = loader(
      () => assert.fail("No business fetch"),
      auth,
      profile,
    )("features/admin-catalog/server/images.ts").forwardCatalogImage;
    assert.equal(
      (await forward(request(), product.id, "upload")).status,
      expected,
    );
  }
});
test("private bytes bypass shared optimization and do not forward provider headers", async () => {
  const forward = loader(
    async () =>
      new Response(productImageFixture(), {
        headers: {
          "content-type": "image/png",
          "set-cookie": "PRIVATE",
          location: "https://private",
        },
      }),
  )("features/admin-catalog/server/images.ts").forwardCatalogImage;
  const response = await forward(
    new Request("http://browser" + path + "/" + key),
    product.id,
    "image",
    key,
  );
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("location"), null);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.deepEqual(
    Buffer.from(await response.arrayBuffer()),
    productImageFixture(),
  );
});
test("image upstream failures preserve safe status/code without internal details", async () => {
  for (const status of [400, 401, 403, 404, 409, 413, 415, 422, 500, 503]) {
    const forward = loader(async () =>
      Response.json(
        {
          message: "PRIVATE",
          code: status === 413 ? "ADMIN_CATALOG_IMAGE_TOO_LARGE" : "PRIVATE",
        },
        { status },
      ),
    )("features/admin-catalog/server/images.ts").forwardCatalogImage;
    const response = await forward(request(), product.id, "upload");
    assert.equal(response.status, status);
    assert.equal(
      response.headers.get("retry-after"),
      status === 503 ? "5" : null,
    );
    assert.ok(!(await response.text()).includes("PRIVATE"));
  }
});
test("operation recovery is explicit and preserves the original idempotency key", async () => {
  const calls = [];
  const load = loader(async (url, options) => {
    calls.push({ url, options });
    return Response.json(operation());
  });
  const { catalogImageRequest } = load("features/admin-catalog/image-api.ts");
  const attempt = {
    productId: product.id,
    key,
    expectedVersion: "0",
    file: null,
  };
  assert.equal((await catalogImageRequest(attempt, true)).state, "APPLIED");
  assert.equal(
    calls[0].url,
    path.replace(/\/image$/, "/image-operations/" + key),
  );
  assert.equal(calls[0].options.method, "GET");
  await catalogImageRequest(attempt);
  assert.equal(calls[1].options.headers["Idempotency-Key"], key);
  assert.equal(calls[1].options.method, "DELETE");
});
test("processing and malformed confirmation are never considered applied", async () => {
  const load = loader();
  const { parseImageOperation } = load(
    "features/admin-catalog/image-contracts.ts",
  );
  assert.equal(
    parseImageOperation(operation("PROCESSING"), product.id, key).state,
    "PROCESSING",
  );
  assert.equal(
    parseImageOperation(
      { ...operation(), operationId: product.id },
      product.id,
      key,
    ),
    null,
  );
  assert.equal(
    parseImageOperation(
      { ...operation(), appliedVersion: "2" },
      product.id,
      key,
    ),
    null,
  );
});
