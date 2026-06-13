import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const projectRoot = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // OAuth tokens are handled server-side only; nothing secret is exposed to the client.
  serverExternalPackages: ["@prisma/client", "prisma"],
  // This project is self-contained; pin tracing to its own dir (a parent repo
  // may have its own lockfile during development).
  outputFileTracingRoot: projectRoot,
};

export default nextConfig;
