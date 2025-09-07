'use client';

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html>
      <body style={{ padding: 24, fontFamily: 'sans-serif' }}>
        <h2>Something went wrong</h2>
        <pre>{error?.message || 'Unknown error'}</pre>
      </body>
    </html>
  );
}
