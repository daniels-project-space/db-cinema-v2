import type { Metadata } from "next";
import { Inter, Outfit } from "next/font/google";
import "./globals.css";
import { ConvexClientProvider } from "@/components/ConvexClientProvider";
import { CartProvider } from "@/components/cart/CartProvider";
import { CartDrawer } from "@/components/cart/CartDrawer";
import { CartToast } from "@/components/cart/CartToast";
import { AccountProvider } from "@/components/account/AccountProvider";
import { Footer } from "@/components/Footer";
import { AmbientBackground } from "@/components/AmbientBackground";
import { AnalyticsTracker } from "@/components/AnalyticsTracker";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const outfit = Outfit({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-outfit",
  display: "swap",
});

// Flip NEXT_PUBLIC_SITE_LIVE=true on Vercel at launch → site becomes indexable.
const LIVE = process.env.NEXT_PUBLIC_SITE_LIVE === "true";

export const metadata: Metadata = {
  metadataBase: new URL("https://dbcinemarentals.com"),
  title: {
    default: "Db Cinema Rentals — Rent pro cinema cameras, lenses & lighting in London",
    template: "%s | Db Cinema Rentals",
  },
  description:
    "Rent professional cinema cameras, lenses, lighting, audio and drones in London. Daily, 3-day and weekly rates, delivered. Verified gear, 875+ five-star reviews.",
  keywords: [
    "camera rental London",
    "cinema camera hire",
    "lens rental London",
    "film gear rental",
    "video equipment hire London",
    "RED ARRI Sony FX rental",
    "lighting rental",
    "drone hire London",
  ],
  applicationName: "Db Cinema Rentals",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "Db Cinema Rentals",
    title: "Db Cinema Rentals — Pro film & cinema gear, delivered across London",
    description:
      "Rent cinema cameras, lenses, lighting, audio and drones. Daily rates, delivery, 875+ five-star reviews.",
    locale: "en_GB",
    url: "https://dbcinemarentals.com",
  },
  twitter: {
    card: "summary_large_image",
    title: "Db Cinema Rentals — Pro film & cinema gear in London",
    description: "Rent cinema cameras, lenses, lighting and more. Daily rates, delivered.",
  },
  robots: LIVE
    ? { index: true, follow: true }
    : { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${outfit.variable}`}>
      <body className="font-sans antialiased bg-charcoal-950 text-white/90">
        <AmbientBackground />
        <div className="relative z-20 bg-amber-500/90 py-1 text-center text-[11px] font-medium text-black">
          TEST MODE — demo only. No real payments are taken.
        </div>
        <ConvexClientProvider>
          <AnalyticsTracker />
          <AccountProvider>
            <CartProvider>
              <div className="relative z-10">
                {children}
                <Footer />
              </div>
              <CartDrawer />
              <CartToast />
            </CartProvider>
          </AccountProvider>
        </ConvexClientProvider>
        <div className="film-grain" aria-hidden />
      </body>
    </html>
  );
}
