import Script from "next/script";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <Script
        src="https://jarvis-orcin-six.vercel.app/jarvis-embed.js?v=universal-controls-20260719-1"
        strategy="afterInteractive"
        data-jarvis-app="db-cinema-v2-admin"
      />
    </>
  );
}
