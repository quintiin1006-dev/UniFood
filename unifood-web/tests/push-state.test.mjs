import { test } from "node:test";
import assert from "node:assert/strict";
import { loadTs } from "./helpers/load-ts.mjs";

const { pushAvailability, iosVersion, applicationServerKey } = loadTs(
  "features/push/state.ts",
);

const ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
const IPHONE = (version) =>
  `Mozilla/5.0 (iPhone; CPU iPhone OS ${version} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1`;

const capable = (extra = {}) => ({
  serviceWorker: true,
  pushManager: true,
  notification: true,
  standalone: false,
  userAgent: ANDROID,
  permission: "default",
  ...extra,
});

test("a capable browser can offer push until the permission is denied", () => {
  assert.equal(pushAvailability(capable()), "available");
  assert.equal(
    pushAvailability(capable({ permission: "granted" })),
    "available",
  );
  assert.equal(pushAvailability(capable({ permission: "denied" })), "denied");
});

test("without Service Worker, Push API or Notification the switch is not offered", () => {
  assert.equal(
    pushAvailability(capable({ serviceWorker: false })),
    "unsupported",
  );
  assert.equal(
    pushAvailability(capable({ pushManager: false })),
    "unsupported",
  );
  assert.equal(
    pushAvailability(capable({ notification: false })),
    "unsupported",
  );
});

test("an iPhone needs iOS 16.4 or later and the installed app", () => {
  assert.deepEqual(iosVersion(IPHONE("17_2")), [17, 2]);
  assert.equal(iosVersion(ANDROID), null);
  // In a Safari tab iOS exposes no PushManager: the install guide comes first.
  assert.equal(
    pushAvailability(
      capable({ userAgent: IPHONE("17_2"), pushManager: false }),
    ),
    "ios-install",
  );
  assert.equal(
    pushAvailability(capable({ userAgent: IPHONE("16_4"), standalone: true })),
    "available",
  );
  assert.equal(
    pushAvailability(capable({ userAgent: IPHONE("16_3"), standalone: true })),
    "ios-too-old",
  );
  assert.equal(
    pushAvailability(capable({ userAgent: IPHONE("15_7") })),
    "ios-too-old",
  );
  assert.equal(
    pushAvailability(
      capable({
        userAgent: IPHONE("17_0"),
        standalone: true,
        permission: "denied",
      }),
    ),
    "denied",
  );
});

test("the VAPID key is decoded from base64url to the bytes subscribe expects", () => {
  const bytes = new Uint8Array(65).map((_, i) => (i * 7) % 256);
  bytes[0] = 4;
  const encoded = Buffer.from(bytes).toString("base64url");
  assert.deepEqual([...applicationServerKey(encoded)], [...bytes]);
});
