import { REVIEW_PRIZE_GBP } from "./reviewPrize";

export function reviewIncentiveDisclosure(review: {
  incentivized?: boolean;
  encoreReward?: boolean;
  prizeEntry?: boolean;
}) {
  const details = [
    review.encoreReward === true ? "Encore benefit" : null,
    review.prizeEntry === true ? `£${REVIEW_PRIZE_GBP} story-prize entrant` : null,
  ].filter((detail): detail is string => detail !== null);
  if (!review.incentivized && details.length === 0) return null;
  return details.length ? `${details.join(" + ")} · incentivised review` : "Incentivised review";
}
