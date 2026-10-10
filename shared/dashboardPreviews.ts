/** One preview contract for the admin query and the cards it supplies. */
export const DASHBOARD_PREVIEW_COUNT = 4;

export function dashboardVerificationPending(rental: {
  verification: string;
  requiresDroneLicence: boolean;
  droneVerification: string | null;
  verificationReady?: boolean;
}): boolean {
  return rental.verificationReady === false || rental.verification !== "verified" ||
    rental.requiresDroneLicence && rental.droneVerification !== "approved";
}
