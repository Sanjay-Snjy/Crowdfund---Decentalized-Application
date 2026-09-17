/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  images: {
    domains: ["gateway.pinata.cloud", "ipfs.io"],
    unoptimized: true,
  },
  trailingSlash: true,
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = { ...config.resolve.fallback, fs: false, net: false, tls: false };
    }
    return config;
  },
  async headers() {
    return [
      {
        source: "/(.*)\\.(jpg|jpeg|png|gif|webp|svg|ico|css|js|woff|woff2)$",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
  async redirects() {
    return [
      { source: "/all-campaigns", destination: "/home", permanent: true },
      { source: "/campaigns", destination: "/home", permanent: false },
    ];
  },
};

module.exports = nextConfig;
