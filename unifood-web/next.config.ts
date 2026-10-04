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
  allowedDevOrigins: networkHosts,
  turbopack: { root: process.cwd() },
};

export default nextConfig;
