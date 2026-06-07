"use client";

// Re-mounts on every route change → Apple-style fade between pages.
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-in">{children}</div>;
}
