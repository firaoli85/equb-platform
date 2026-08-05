import type { NextConfig } from "next";
import { securityHeaders } from "./lib/security-headers";

// Security response headers (audit H6). This config was empty, so the app
// shipped with none of them. The policy itself lives in lib/security-headers
// where it is pure and unit-tested; this file only mounts it on every route.

const nextConfig: NextConfig = {
  // Don't advertise the framework and version on every response.
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders({
          isDev: process.env.NODE_ENV === "development",
          supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
        }),
      },
    ];
  },
};

export default nextConfig;
