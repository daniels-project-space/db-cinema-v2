"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          background: "#0a0a0b",
          color: "#fff",
          fontFamily: "system-ui, -apple-system, sans-serif",
          display: "flex",
          minHeight: "100vh",
          alignItems: "center",
          justifyContent: "center",
          margin: 0,
        }}
      >
        <div style={{ textAlign: "center", padding: 24 }}>
          <h1 style={{ fontSize: 22, marginBottom: 8 }}>Something went wrong</h1>
          <p style={{ color: "rgba(255,255,255,0.55)", marginBottom: 20 }}>Please try again in a moment.</p>
          <button
            onClick={() => reset()}
            style={{ background: "#e0992f", color: "#fff", border: 0, borderRadius: 999, padding: "10px 20px", cursor: "pointer", fontSize: 14 }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
