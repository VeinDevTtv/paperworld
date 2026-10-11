import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep dev assets available only to the app's loopback hostnames. Provider
  // Route Handlers apply their own same-origin and Host checks to POSTs.
  allowedDevOrigins: ["localhost", "127.0.0.1", "[::1]"],
};

export default nextConfig;
