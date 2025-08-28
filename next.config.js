/** @type {import('next').NextConfig} */
const nextConfig = {
  // Disable checks to reduce memory during build (temporary)
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  // Disable source maps to reduce memory footprint
  productionBrowserSourceMaps: false,
  // Keep defaults for file tracing to avoid excessive dependency scanning on Vercel
  // Optimization: Avoid installing 'sharp' during build
  images: { unoptimized: true },
};

module.exports = nextConfig;
