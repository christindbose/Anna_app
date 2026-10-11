import type { NextConfig } from "next";

const BACKEND = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  // The frontend talks to the FastAPI backend same-origin: /api/* is proxied.
  // Streaming responses (text/plain chunks) pass through the rewrite unbuffered.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${BACKEND}/api/:path*` }];
  },
};

export default nextConfig;
