/** @type {import('next').NextConfig} */
const nextConfig = {
  // CRITICAL: Ensure error ignoring stays disabled.
  // Optimization: Externalize heavy SDKs to speed up build analysis
  experimental: {
    serverComponentsExternalPackages: ['openai', '@google/generative-ai', 'stripe'],
  },
  // Optimization: Avoid installing 'sharp' during build
  images: { unoptimized: true },
};

module.exports = nextConfig;
