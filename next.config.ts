import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The concierge system prompt is read from disk at runtime; make sure it ships with every server route.
  outputFileTracingIncludes: {
    "/*": ["./prompts/**/*"],
  },
};

export default nextConfig;
