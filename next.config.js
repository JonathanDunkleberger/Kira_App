/** @type {import('next').NextConfig} */
const nextConfig = {
  // Disable checks to reduce memory during build (temporary)
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  // Disable source maps to reduce memory footprint
  productionBrowserSourceMaps: false,
  // Optimization: Externalize heavy SDKs to speed up build analysis
  experimental: {
    serverComponentsExternalPackages: ['openai', '@google/generative-ai', 'stripe'],
  },
  // Optimization: Avoid installing 'sharp' during build
  images: { unoptimized: true },
};

module.exports = nextConfig;
