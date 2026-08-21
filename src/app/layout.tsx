import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk, Anton, Instrument_Serif, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { ConvexClientProvider } from "@/components/ConvexClientProvider";
import { CartProvider } from "@/components/cart/CartProvider";
import { CartDrawer } from "@/components/cart/CartDrawer";
import { CartToast } from "@/components/cart/CartToast";
import { AccountProvider } from "@/components/account/AccountProvider";
import { GafferSessionProvider } from "@/components/gaffer/GafferSession";
import { GafferFocusProvider } from "@/components/gaffer/GafferFocus";
import { MicPermission } from "@/components/gaffer/MicPermission";
import { GafferDock } from "@/components/gaffer/GafferDock";
import { Footer } from "@/components/Footer";
import { AmbientBackground } from "@/components/AmbientBackground";
import { GearTurnOverlay } from "@/components/GearTurnOverlay";
import { CheckoutTurnOverlay } from "@/components/CheckoutTurnOverlay";
import { CursorGlow } from "@/components/CursorGlow";
import { SpotlightEffect } from "@/components/SpotlightEffect";
import { ScrollProgress } from "@/components/ScrollProgress";
import { AnalyticsTracker } from "@/components/AnalyticsTracker";
import { BotBubble } from "@/components/BotBubble";
import { FormSevenPrewarm } from "@/components/FormSevenPrewarm";
import { SITE_URL } from "@/lib/site";

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

export const viewport: Viewport = {
  themeColor: "#0a0a0b",
};

// Site-wide structured data: Organization (brand/logo) + WebSite with a SearchAction so Google
// can surface a sitelinks search box that points straight at the gear catalogue.
const orgJsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: "Db Cinema Rentals",
      url: SITE_URL,
      logo: `${SITE_URL}/db-cinema-logo-512.png`,
      description: "Pro film & cinema gear rental, delivered across London.",
      areaServed: "London, United Kingdom",
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      url: SITE_URL,
      name: "Db Cinema Rentals",
      publisher: { "@id": `${SITE_URL}/#organization` },
      potentialAction: {
        "@type": "SearchAction",
        target: { "@type": "EntryPoint", urlTemplate: `${SITE_URL}/gear?search={search_term_string}` },
        "query-input": "required name=search_term_string",
      },
    },
  ],
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Camera Hire London — Pro Cinema Cameras, Lenses, Lighting & Drones | Db Cinema Rentals",
    template: "%s | Db Cinema Rentals",
  },
  description:
    "Camera hire in London — rent professional cinema cameras, lenses, lighting, audio and drones. Daily, 3-day & weekly rates, delivered or collect in central London. Verified gear, 875+ five-star reviews.",
  keywords: [
    "camera hire London",
    "camera rental London",
    "cinema camera hire London",
    "film equipment hire London",
    "video camera hire London",
    "lens hire London",
    "lighting hire London",
    "drone hire London",
    "audio equipment hire London",
    "Sony FX hire London",
    "RED camera hire London",
    "ARRI camera hire London",
    "Blackmagic camera hire London",
    "production equipment hire London",
    "camera equipment hire near me",
  ],
  applicationName: "Db Cinema Rentals",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "Db Cinema Rentals",
    title: "Camera Hire London — Pro Cinema Cameras, Lenses, Lighting & Drones",
    description:
      "Camera & lens hire across London — cinema cameras, lighting, audio and drones. Daily rates, delivered. 875+ five-star reviews.",
    locale: "en_GB",
    url: SITE_URL,
  },
  twitter: {
    card: "summary_large_image",
    title: "Camera Hire London — Db Cinema Rentals",
    description: "Cinema camera, lens, lighting & drone hire across London. Daily rates, delivered.",
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
        <a href="#main-content" className="skip-link">Skip to content</a>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(orgJsonLd) }} />
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
              {/* Outside the session provider on purpose: gear tiles subscribe
                  to focus, and the session context re-renders every second
                  while a call is running. */}
              <GafferFocusProvider>
                {/* Inside Account + Cart (its tools read both) and outside the
                    page tree, so a call survives Gaffer navigating between pages. */}
                <GafferSessionProvider>
                  <div id="main-content" tabIndex={-1} className="relative z-10">
                    {children}
                    <Footer />
                  </div>
                  <CartDrawer />
                  <CartToast />
                  <BotBubble />
                  <GearTurnOverlay />
                  <CheckoutTurnOverlay />
                  <GafferDock />
                  <MicPermission />
                  <FormSevenPrewarm />
                </GafferSessionProvider>
              </GafferFocusProvider>
            </CartProvider>
          </AccountProvider>
        </ConvexClientProvider>
        <div className="film-grain" aria-hidden />
      </body>
    </html>
  );
}
