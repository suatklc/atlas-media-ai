import type { PlatformId } from "../ai/platform/config";

// Phase 1 of Publishing: shared, provider-neutral contract only. No live
// provider is called from anywhere in this package yet — see providers/meta.ts.

// The service that actually knows how to talk to a platform's publishing
// API. Multiple PlatformIds can share one provider (Instagram + Facebook
// both go through Meta) — this is the seam a future LinkedIn/Google
// Business provider slots into later without touching this file's shape.
export type PublishingProviderId = "meta";

export type PublishRequest = {
  platform: PlatformId;
  caption: string;
  imageUrl: string;
  // The connected destination's own id (an Instagram professional
  // account id today; a Facebook Page id once that provider is
  // implemented) — required now that a real provider call exists to
  // address.
  externalAccountId: string;
  // The already-decrypted credential for this connection, resolved by the
  // caller through the sanctioned Vault path (connections/credentials.ts's
  // getConnectedAccountCredential) BEFORE building this request. This
  // package makes no Supabase/Vault call of its own — see
  // publishGeneratedPost.ts for where this is resolved. Never logged,
  // never included in a PublishResult, never passed to console.error.
  accessToken: string;
};

export type PublishResult =
  | {
      success: true;
      platform: PlatformId;
      externalPostId?: string;
      externalPostUrl?: string;
    }
  | {
      success: false;
      platform: PlatformId;
      error: string;
    };
