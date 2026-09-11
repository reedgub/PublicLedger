import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  images: {
    remotePatterns: [
      // Only load avatars the ingestion/X-verify path stored — currently
      // pbs.twimg.com URLs pulled through the X API. Do not add third-party
      // avatar proxies here: they leak the tracked roster and add a new
      // failure mode for cosmetic content.
      { protocol: "https", hostname: "pbs.twimg.com" },
    ],
  },
};

export default nextConfig;
