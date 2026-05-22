'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <div style={{ padding: 40, textAlign: 'center', fontFamily: 'Georgia, serif' }}>
          <h1 style={{ fontSize: 32 }}>Something went wrong</h1>
          <p style={{ marginTop: 16, color: '#666' }}>An unexpected error occurred.</p>
          <button onClick={reset} style={{ marginTop: 24, padding: '10px 20px', cursor: 'pointer' }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
