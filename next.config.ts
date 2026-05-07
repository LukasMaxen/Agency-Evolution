import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/auto-reply": ["./clients/**", "./1. Departments/reply-management/**"],
    "/api/webhook/[workspace]": ["./clients/**", "./1. Departments/reply-management/**"],
  },
};

export default nextConfig;
