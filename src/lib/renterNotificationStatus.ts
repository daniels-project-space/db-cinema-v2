export type RenterNotificationStatus = "unknown" | "active" | "inactive" | "unavailable";

export function getRenterNotificationStatus(input: {
  stateLoaded: boolean;
  configured: boolean;
  publicKey: string | null | undefined;
  supported: boolean;
  ios: boolean;
  installed: boolean;
  ready: boolean;
  setupError: boolean;
  enabled: boolean;
  connected: boolean;
  permissionGranted: boolean;
  messagesEnabled: boolean;
}): RenterNotificationStatus {
  if (!input.stateLoaded) return "unknown";
  if (!input.configured || !input.publicKey) return "unavailable";
  if (input.ios && !input.installed) return "inactive";
  if (!input.supported) return "unavailable";
  if (!input.ready) return input.setupError ? "unavailable" : "unknown";
  return input.enabled && input.connected && input.permissionGranted && input.messagesEnabled
    ? "active"
    : "inactive";
}
