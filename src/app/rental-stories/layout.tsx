import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Your set story · £250 prize | DB Cinema Rentals",
  description:
    "Share your honest rental review and set story for the twice-yearly DB Cinema £250 story prize. Entry conditions and independent judging apply.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
