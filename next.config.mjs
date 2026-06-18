/** @type {import('next').NextConfig} */
const nextConfig = {
  // Legacy Base44/Vite files remain in the repo as dead code; don't fail builds on them.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
