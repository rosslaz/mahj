/** @type {import('next').NextConfig} */
const pkg = require('./package.json');
const { withSentryConfig } = require('@sentry/nextjs');

const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
  },
  async headers() {
    return [
      {
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

// Sentry build-time configuration. This wrapper:
//   1. Uploads source maps to Sentry during `next build` so error stack
//      traces in Sentry's UI show un-minified file/line/symbol names
//   2. Adds the Sentry SDK to client and server bundles automatically
//   3. Tunnels Sentry's `/monitoring` route to bypass ad-blockers (off by
//      default; would need a route handler)
//
// Source-map upload requires SENTRY_AUTH_TOKEN at build time. Set this in
// Vercel Environment Variables (Production, Preview, Development). The
// token starts with `sntrys_` and has `project:releases` scope.

module.exports = withSentryConfig(nextConfig, {
  // Sentry SDK build options
  org: 'pungctual',
  project: 'pungctual',

  // Suppress upload errors if the auth token is missing (e.g. local dev,
  // first-time setup). Build still succeeds; source maps just aren't
  // uploaded for that build.
  silent: !process.env.CI,

  // Upload source maps from the standard Next.js build output. Sentry's
  // wrapper handles the rest.
  widenClientFileUpload: true,

  // Hide source maps from the public — we upload them to Sentry but don't
  // serve them at /static/chunks/*.map. Source code stays minified for
  // end users; Sentry has the un-minified version privately.
  hideSourceMaps: true,

  // Disable telemetry pings that Sentry's build plugin sends about itself.
  // No reason for them.
  disableLogger: true,
});
