// Next.js 14 instrumentation hook. Runs once at app startup in each runtime
// context (Node or edge). We dynamically require the appropriate Sentry
// config — they're separate files because they need to be excluded from the
// wrong bundles (server config can't be in the browser, etc).

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

// Sentry's request error handler — captures errors thrown during request
// processing (server actions, route handlers) that wouldn't otherwise
// reach the global Sentry init. Next.js looks for an export named
// `onRequestError` on this module; Sentry's SDK exposes the implementation
// as `captureRequestError`, so we alias it.
export { captureRequestError as onRequestError } from '@sentry/nextjs';
