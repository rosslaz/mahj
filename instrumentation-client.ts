// Sentry client-side init. Runs in the browser bundle.
//
// This file is required by Next.js's instrumentationHook experiment when
// using @sentry/nextjs. The server-side counterpart is sentry.server.config.ts.

import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Trace 10% of transactions in prod
  tracesSampleRate: 0.1,

  // No replay or session recording — just error capture
  // (those features need separate setup)

  environment: process.env.VERCEL_ENV || process.env.NODE_ENV,

  release: process.env.NEXT_PUBLIC_APP_VERSION
    ? \pungctual@\\
    : undefined,

  beforeSend(event) {
    if (process.env.NODE_ENV === 'development') return null;
    return event;
  },
});
