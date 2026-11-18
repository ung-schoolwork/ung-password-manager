import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // Emits .next/standalone (server.js plus only the traced node_modules) for
  // the container image built by the Dockerfile.
  output: "standalone",
  serverExternalPackages: ["mongoose"],
}

export default nextConfig
