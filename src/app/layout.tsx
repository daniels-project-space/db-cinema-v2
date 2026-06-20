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
import { GearTurnOverlay } from "@/components/GearTurnOverlay";
import { CheckoutTurnOverlay } from "@/components/CheckoutTurnOverlay";
import { CursorGlow } from "@/components/CursorGlow";
import { SpotlightEffect } from "@/components/SpotlightEffect";
import { ScrollProgress } from "@/components/ScrollProgress";
import { AnalyticsTracker } from "@/components/AnalyticsTracker";
import { BotBubble } from "@/components/BotBubble";
import { SITE_URL, SITE_NAME, HOURS_WINDOWS } from "@/lib/site";

// JSON-LD LocalBusiness — a strong legitimacy + local-SEO signal that helps Google AND
// content filters (FortiGuard et al.) correctly classify the site as a real London business.
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  "@id": `${SITE_URL}/#business`,
  name: SITE_NAME,
  url: SITE_URL,
  email: "dbcinemaproductions@gmail.com",
  image: `${SITE_URL}/opengraph-image`,
  description:
    "Professional cinema camera, lens, lighting, audio and drone hire in London — daily rates, delivered.",
  areaServed: { "@type": "City", name: "London" },
  address: { "@type": "PostalAddress", addressLocality: "London", addressCountry: "GB" },
  priceRange: "££",
  openingHoursSpecification: HOURS_WINDOWS.map((w) => ({
    "@type": "OpeningHoursSpecification",
    dayOfWeek: DAYS,
    opens: w.opens,
    closes: w.closes,
  })),
  knowsAbout: ["Camera rental", "Cinema lens hire", "Lighting hire", "Drone hire", "Audio equipment rental"],
};

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
  metadataBase: new URL(SITE_URL),
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
    url: SITE_URL,
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
        {/* LocalBusiness structured data (schema.org) */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(STRUCTURED_DATA) }}
        />
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
              <GearTurnOverlay />
              <CheckoutTurnOverlay />
            </CartProvider>
          </AccountProvider>
        </ConvexClientProvider>
        <div className="film-grain" aria-hidden />
      </body>
    </html>
  );
}
