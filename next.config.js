/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Universal links / app links: the files have no extension (Apple) or must
  // be JSON (Google); serve both as JSON (Phase 5, docs/NEEDS_KOREY.md).
  async headers() {
    return [
      { source: '/.well-known/apple-app-site-association', headers: [{ key: 'content-type', value: 'application/json' }] },
      { source: '/.well-known/assetlinks.json', headers: [{ key: 'content-type', value: 'application/json' }] },
    ];
  },
  experimental: {
    optimizePackageImports: ['@phosphor-icons/react'],
  },
};

module.exports = nextConfig;
