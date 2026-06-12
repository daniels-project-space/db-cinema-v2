import type { Metadata } from "next";
import { Inter, Space_Grotesk, Anton, Instrument_Serif, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { ConvexClientProvider } from "@/components/ConvexClientProvider";
import { CartProvider } from "@/components/cart/CartProvider";
import { CartDrawer } from "@/components/cart/CartDrawer";
import { CartToast } from "@/components/cart/CartToast";
import { AccountProvider } from "@/components/account/AccountProvider";
import { Footer } from "@/components/Footer";
import { AmbientBackground } from "@/components/AmbientBackground";
import { CursorGlow } from "@/components/CursorGlow";
import { SpotlightEffect } from "@/components/SpotlightEffect";
import { ScrollProgress } from "@/components/ScrollProgress";
import { AnalyticsTracker } from "@/components/AnalyticsTracker";
import { BotBubble } from "@/components/BotBubble";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const grotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-grotesk",
  display: "swap",
});

const anton = Anton({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-anton",
  display: "swap",
});

const instrument = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-instrument",
  display: "swap",
});

const jbmono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-jbmono",
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
    <html
      lang="en"
      className={`${inter.variable} ${grotesk.variable} ${anton.variable} ${instrument.variable} ${jbmono.variable}`}
    >
      <body className="font-sans antialiased bg-charcoal-950 text-white/90">
        {/* apply the saved accent before first paint (no flash) */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var a=localStorage.getItem("dbc-accent");if(a)document.documentElement.dataset.accent=a}catch(e){}`,
          }}
        />
        <AmbientBackground />
        <CursorGlow />
        <SpotlightEffect />
        <ScrollProgress />
        <div className="relative z-20 border-b border-amber-400/20 bg-amber-500/10 py-1 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-amber-300/90">
          Test mode — demo only · no real payments are taken
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
              <BotBubble />
            </CartProvider>
          </AccountProvider>
        </ConvexClientProvider>
        <div className="film-grain" aria-hidden />
      </body>
    </html>
  );
}
