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

export const metadata: Metadata = {
  title: "Db Cinema Rentals — Pro film & cinema gear, daily rates, delivered",
  description:
    "Rent professional cinema cameras, lenses, lighting, audio and drones. Daily, weekly and monthly rates with delivery across the UK.",
  // pre-launch: don't index while in test mode
  robots: { index: false, follow: false },
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
