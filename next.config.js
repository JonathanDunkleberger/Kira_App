/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    // This setting allows your project to build on Vercel even if there are
    // TypeScript errors. It dramatically reduces build time and memory usage.
    ignoreBuildErrors: true,
  },
};

module.exports = nextConfig;
