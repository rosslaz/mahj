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


// Injected content via Sentry wizard below

const { withSentryConfig } = require("@sentry/nextjs");

module.exports = withSentryConfig(module.exports, {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "pungctual",
  project: "pungctual",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  tunnelRoute: "/monitoring",

  webpack: {
    // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
    // See the following for more information:
    // https://docs.sentry.io/product/crons/
    // https://vercel.com/docs/cron-jobs
    automaticVercelMonitors: true,

    // Tree-shaking options for reducing bundle size
    treeshake: {
      // Automatically tree-shake Sentry logger statements to reduce bundle size
      removeDebugLogging: true,
    },
  },
});
