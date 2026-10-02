import { REVIEW_PRIZE_GBP } from "../../../shared/reviewPrize";
import type { Metadata } from "next";
export const metadata: Metadata = {
  title: `Your set story · £${REVIEW_PRIZE_GBP} prize | DB Cinema Rentals`,
  description:
    `Share your honest rental review and set story for the twice-yearly DB Cinema £${REVIEW_PRIZE_GBP} story prize. Entry conditions and independent judging apply.`,
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
