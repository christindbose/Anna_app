import type { NextConfig } from "next";

const BACKEND = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";
// STATIC_EXPORT=1 builds a static site (GitHub Pages). There is no /api proxy in that mode: the
// app calls the backend at NEXT_PUBLIC_API_BASE or the address the user enters under "Server".
const STATIC = process.env.STATIC_EXPORT === "1";
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || undefined;

const nextConfig: NextConfig = {
  ...(STATIC
    ? { output: "export", basePath: BASE_PATH, trailingSlash: true, images: { unoptimized: true } }
    : {
        // The frontend talks to the FastAPI backend same-origin: /api/* is proxied.
        // Streaming responses (text/plain chunks) pass through the rewrite unbuffered.
        async rewrites() {
          return [{ source: "/api/:path*", destination: `${BACKEND}/api/:path*` }];
        },
      }),
};

export default nextConfig;
