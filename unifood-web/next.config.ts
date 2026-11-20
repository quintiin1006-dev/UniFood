import type { NextConfig } from "next";
import { networkInterfaces } from "node:os";
import { validateEnvironment } from "./config/environment";

// Next loads .env files before this configuration: fail before starting or building.
validateEnvironment(process.env);

const networkHosts = Object.values(networkInterfaces()).flatMap((addresses) =>
  (addresses ?? [])
    .filter((address) => address.family === "IPv4" && !address.internal)
    .map((address) => address.address),
);

const nextConfig: NextConfig = {
  // Binding to :: does not allow the browser's IPv4/IPv6 loopback origins.
  allowedDevOrigins: ["127.0.0.1", "[::1]", ...networkHosts],
  turbopack: { root: process.cwd() },
  // A (jj/cliente-ajustes-2): back in a tab of the client within 30 s, the page is painted from
  // the router cache instead of waiting for the server. Signing in or out and accepting the
  // terms are full page loads (the cache goes with them); placing an order calls
  // router.refresh(). Data that changes by itself (Mi pedido, the menu) refreshes in the browser.
  experimental: { staleTimes: { dynamic: 30 } },
  async headers() {
    return [
      {
        // The push service worker: always revalidated, same-origin scripts only.
        source: "/sw.js",
        headers: [
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          {
            key: "Content-Security-Policy",
            value: "default-src 'self'; script-src 'self'",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
