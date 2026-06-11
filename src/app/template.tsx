"use client";

// Re-mounts on every route change → letterbox bars retract like a film
// shutter opening, while the page content rises in underneath.
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="letterbox-bar top" aria-hidden />
      <div className="letterbox-bar bottom" aria-hidden />
      <div className="page-in">{children}</div>
    </>
  );
}
