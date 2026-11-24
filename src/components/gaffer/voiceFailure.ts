type VoiceDisconnectDetails = {
  reason?: unknown;
  message?: unknown;
  closeCode?: unknown;
  closeReason?: unknown;
  context?: {
    type?: unknown;
    reason?: unknown;
    code?: unknown;
  };
};

export const VOICE_PROVIDER_SETUP_MESSAGE =
  "Gaffer voice is unavailable right now. Please use chat or contact the team while we check the call setup.";

const providerAccessFailure = /\b(?:401|403|404|4401|4403)\b|unauthori[sz]ed|forbidden|access denied|not authorized|authentication failed|invalid (?:api )?key|invalid token|token expired|unknown agent|private agent|agent (?:not found|does not exist|unavailable|not available|disabled)|quota exceeded|insufficient (?:credits|balance)|account (?:is )?(?:suspended|disabled)/i;

function detailText(value: unknown): string {
  if (typeof value === "string") return value.slice(0, 1000);
  if (!value || typeof value !== "object") return "";
  const details = value as VoiceDisconnectDetails;
  return [
    details.reason,
    details.message,
    details.closeReason,
    details.context?.type,
    details.context?.reason,
  ].filter((part): part is string => typeof part === "string").join(" ").slice(0, 2000);
}

/** Provider authorization/configuration failures will not improve on a reconnect. */
export function isVoiceProviderSetupFailure(...values: unknown[]): boolean {
  return values.some(value => {
    const text = detailText(value);
    if (providerAccessFailure.test(text)) return true;
    if (!value || typeof value !== "object") return false;
    const details = value as VoiceDisconnectDetails;
    return [details.closeCode, details.context?.code].some(code =>
      typeof code === "number" && [401, 403, 404, 4401, 4403].includes(code),
    );
  });
}
