/** @type {import('next').NextConfig} */
const nextConfig = {
  // Only .ts/.tsx are treated as pages/routes. This stops Next from compiling the
  // leftover Base44 .jsx files in src/pages (which import react-router-dom / @base44
  // and would break the build). The new app lives entirely in app/ as .tsx, so it is
  // unaffected. Legacy src/ and base44/ files are never bundled.
  pageExtensions: ["ts", "tsx"],
  // Legacy files are excluded from tsconfig; don't let lint of dead code fail the build.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
