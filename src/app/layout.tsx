import type { Metadata } from "next";
import { Inter, Outfit } from "next/font/google";
import "./globals.css";
import { ConvexClientProvider } from "@/components/ConvexClientProvider";
import { CartProvider } from "@/components/cart/CartProvider";
import { CartDrawer } from "@/components/cart/CartDrawer";
import { Footer } from "@/components/Footer";

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
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${outfit.variable}`}>
      <body className="font-sans antialiased bg-charcoal-950 text-white/90">
        <ConvexClientProvider>
          <CartProvider>
            {children}
            <Footer />
            <CartDrawer />
          </CartProvider>
        </ConvexClientProvider>
        <div className="film-grain" aria-hidden />
      </body>
    </html>
  );
}
