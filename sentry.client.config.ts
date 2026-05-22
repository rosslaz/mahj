// Sentry init for the browser bundle.
//
// Captures: unhandled JS errors, unhandled promise rejections, navigation
// performance traces (sampled), and React component errors via error
// boundaries (Sentry's Next.js integration auto-wires these).
//
// DSN is public — safe to expose. The user-context attachment only includes
// the user_id, not email/name, to minimize PII in Sentry.

import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Performance tracing: 10% of pageloads/navigations. Errors are always
  // captured at 100% regardless of this rate.
  tracesSampleRate: 0.1,

  // No session replay (paid feature, also invasive). Sentry won't try to
  // load the replay SDK if we don't enable it here.
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,

  // Environment tag for filtering. NEXT_PUBLIC_VERCEL_ENV is auto-set by
  // Vercel to 'production', 'preview', or 'development'. Fall back to
  // NODE_ENV for non-Vercel runs.
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.NODE_ENV,

  // Release tag — ties errors to a specific deployed version. We use the
  // app version from package.json (already exposed via NEXT_PUBLIC_APP_VERSION).
  release: process.env.NEXT_PUBLIC_APP_VERSION
    ? `pungctual@${process.env.NEXT_PUBLIC_APP_VERSION}`
    : undefined,

  // Tighten the default integrations: drop console capture (we don't want
  // every console.log shipped to Sentry as a breadcrumb), keep error/network
  // breadcrumbs.
  integrations: [
    Sentry.browserTracingIntegration(),
  ],

  // Don't send events when running locally — they'd just clutter the project.
  beforeSend(event) {
    if (process.env.NODE_ENV === 'development') return null;
    return event;
  },
});
