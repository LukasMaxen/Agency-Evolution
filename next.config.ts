import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    after: true,
  },
  outputFileTracingIncludes: {
    "/api/auto-reply": ["./clients/**", "./1. Departments/reply-management/**"],
    "/api/webhook/[workspace]": ["./clients/**", "./1. Departments/reply-management/**"],
  },
};

export default nextConfig;
