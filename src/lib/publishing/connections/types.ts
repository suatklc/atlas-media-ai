import type { PublishingProviderId } from "../types";

// Which Meta-family destination a connection row represents. Kept distinct
// from the broader PlatformId (reused, not redefined) because a Meta OAuth
// grant can yield a Facebook Page connection, an Instagram professional
// account connection, or both — never a LinkedIn/Google Business row today.
export type MetaConnectionPlatform = "instagram" | "facebook";

// Client-safe shape — deliberately has NO token field and NO Vault
// reference (credential_secret_id is intentionally never included, even as
// a bare id — see query.ts). hasCredential is the only signal a
// client-rendered connection status ever needs: whether a credential is
// stored, not what it is or where. This is the only shape that should ever
// reach anything client-rendered; the raw DB row and any Vault secret id
// never leave server-only code.
export type ConnectedAccountSummary = {
  id: string;
  provider: PublishingProviderId;
  platform: MetaConnectionPlatform;
  externalAccountId: string;
  externalAccountName: string | null;
  tokenExpiresAt: string | null;
  hasCredential: boolean;
};
