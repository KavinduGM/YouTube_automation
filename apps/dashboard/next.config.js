/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      bodySizeLimit: '5mb',
    },
  },
  async rewrites() {
    return [
      // Android Digital Asset Links — Next.js can't serve a folder starting
      // with a dot, so we host it at /well-known/ and rewrite the .well-known
      // path to it.
      { source: '/.well-known/assetlinks.json', destination: '/well-known/assetlinks.json' },
    ];
  },
};

module.exports = nextConfig;
