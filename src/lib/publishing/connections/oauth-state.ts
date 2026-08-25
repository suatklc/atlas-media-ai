// CSRF protection for the Meta OAuth redirect round-trip (/api/meta/connect
// -> Meta's consent dialog -> /api/meta/callback). Per Meta's own documented
// guidance, `state` "should be used for preventing Cross-Site Request
// Forgery" — connect/route.ts generates and stores it in a short-lived
// httpOnly cookie; callback/route.ts must verify the callback's `state`
// query param matches before treating `code` (or `error`) as legitimate.
// The cookie itself, not the value inside it, is what makes this a CSRF
// defense: only a browser that actually visited /api/meta/connect on this
// origin will hold it, so an attacker cannot forge a valid callback request
// by luring a victim to a crafted URL containing a stolen/guessed code.

export const META_OAUTH_STATE_COOKIE = "atlas_meta_oauth_state";

// Long enough to cover the Meta consent dialog, short enough to keep the
// replay window small. Single-use regardless: callback/route.ts deletes the
// cookie as soon as it reads it, whether verification succeeds or fails.
const STATE_MAX_AGE_SECONDS = 600;

export function createOAuthState(): string {
  return crypto.randomUUID();
}

export function oauthStateCookieOptions() {
  return {
    httpOnly: true as const,
    // http://localhost is exempt from Secure-cookie restrictions by
    // browsers, so this stays true in every deployed (HTTPS) environment
    // without breaking local development.
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/api/meta",
    maxAge: STATE_MAX_AGE_SECONDS,
  };
}

// A plain equality check is sufficient here: `state` is a CSRF binding
// token, not a secret whose value grants access on its own (unlike the
// authorization code or any access token), so there is no timing-attack
// surface worth defending with a constant-time comparison. Both sides
// missing must never be treated as a match.
export function isValidOAuthState(cookieValue: string | undefined, paramValue: string | null): boolean {
  return typeof cookieValue === "string" && cookieValue.length > 0 && cookieValue === paramValue;
}
