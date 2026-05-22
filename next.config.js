/** @type {import('next').NextConfig} */
const pkg = require('./package.json');

const nextConfig = {
  reactStrictMode: true,
  env: {
    // Inject package version into the client bundle so the footer + Sentry
    // (when re-added) can stamp the release. Defaults to empty if pkg.version
    // is somehow missing.
    NEXT_PUBLIC_APP_VERSION: pkg.version,
  },
  async headers() {
    return [
      {
        // Service worker must NOT be cached by the browser — we want every
        // load to re-fetch it so deployments take effect promptly.
        source: '/sw.js',
        headers: [
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
