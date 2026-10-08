import type { Metadata } from "next";
export const metadata: Metadata = {
  manifest: "/account.webmanifest",
  appleWebApp: { capable: true, title: "DB Cinema", statusBarStyle: "black-translucent" },
  icons: { apple: "/db-cinema-logo-512.png" },
};
export default function AccountLayout({children}:{children:React.ReactNode}) { return children; }
