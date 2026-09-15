import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Explicit so Vercel never treats this as a static-export / empty output project.
  poweredByHeader: false,
  trailingSlash: false,
};

export default nextConfig;
