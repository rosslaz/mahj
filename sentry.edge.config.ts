// Sentry init for the edge runtime. Currently unused — we don't have any
// routes running on the edge — but Sentry's withSentryConfig wrapper looks
// for this file. Keeping it minimal.

import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
  release: process.env.NEXT_PUBLIC_APP_VERSION
    ? `pungctual@${process.env.NEXT_PUBLIC_APP_VERSION}`
    : undefined,
  beforeSend(event) {
    if (process.env.NODE_ENV === 'development') return null;
    return event;
  },
});
