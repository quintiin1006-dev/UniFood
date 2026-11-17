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
