'use client';

// Global error boundary — catches React errors that bubble past page-level boundaries.
// Was previously wired to Sentry for error reporting; now standalone until Sentry
// is reinstalled. The user sees a friendly fallback instead of a blank page.

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{
        fontFamily: 'Georgia, serif',
        background: '#f5efe6',
        color: '#1a1410',
        padding: '40px 24px',
        minHeight: '100vh',
        margin: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <div style={{ maxWidth: 480, textAlign: 'center' }}>
          <p style={{
            fontSize: 11,
            letterSpacing: '0.4em',
            textTransform: 'uppercase',
            color: '#a8472a',
            marginBottom: 16,
          }}>Something went wrong</p>
          <h1 style={{
            fontSize: 36,
            fontWeight: 500,
            margin: '0 0 16px 0',
          }}>Pungctual hit a snag</h1>
          <p style={{
            fontSize: 16,
            lineHeight: 1.55,
            color: 'rgba(26, 20, 16, 0.7)',
            marginBottom: 24,
          }}>
            An unexpected error occurred. You can try again, or reload the app.
          </p>
          <button
            onClick={reset}
            style={{
              background: '#3d6b4f',
              color: '#f5efe6',
              border: '1px solid #3d6b4f',
              padding: '12px 24px',
              fontSize: 14,
              letterSpacin