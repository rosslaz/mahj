// Sentry init for Node-runtime contexts: server actions, API routes,
// Server Components.
//
// Captures unhandled exceptions and unhandled rejections in any server-side
// code path. This is the most valuable layer — currently if a server action
// throws, we only know about it if someone happens to check Vercel logs.

import * as Sentry from '@sentry/nextjs';

Sentry.init({
  // SENTRY_DSN (server-only, no NEXT_PUBLIC_ prefix) keeps the value out of
  // client bundles. Same value as NEXT_PUBLIC_SENTRY_DSN but referenced
  // server-side here for clarity.
  dsn: process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN,

  tracesSampleRate: 0.1,

  environment: process.env.VERCEL_ENV || process.env.NODE_ENV,

  release: process.env.NEXT_PUBLIC_APP_VERSION
    ? `pungctual@${process.env.NEXT_PUBLIC_APP_VERSION}`
    : undefined,

  // Don't send events when running locally
  beforeSend(event) {
    if (process.env.NODE_ENV === 'development') return null;
    return event;
  },
});
