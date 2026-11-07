import type { AuthConfig } from "convex/server";

export function adminGoogleProvider(clientId: string): AuthConfig["providers"][number] {
  if (clientId.length > 200 || !/^[A-Za-z0-9-]+\.apps\.googleusercontent\.com$/.test(clientId))
    throw Error("A specific Google OAuth client ID is required.");
  return {
    type: "customJwt",
    issuer: "https://accounts.google.com",
    jwks: "https://www.googleapis.com/oauth2/v3/certs",
    algorithm: "RS256",
    applicationID: clientId,
  };
}
