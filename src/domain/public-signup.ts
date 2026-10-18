/**
 * Public account creation is a separate release decision from business
 * registration. Neither a logged-out browser nor Host headers control it.
 */
export type PublicSignupConfig = {
  enabled: boolean;
  emailRedirectTo: string | null;
};

export function resolvePublicSignupConfig(
  flag: string | undefined,
  configuredOrigin: string | undefined,
): PublicSignupConfig {
  if (flag !== "true" || !configuredOrigin) {
    return { enabled: false, emailRedirectTo: null };
  }
  try {
    const origin = new URL(configuredOrigin);
    const local =
      origin.protocol === "http:" &&
      (origin.hostname === "localhost" || origin.hostname === "127.0.0.1");
    if (
      !(origin.protocol === "https:" || local) ||
      origin.username ||
      origin.password ||
      origin.search ||
      origin.hash ||
      origin.pathname !== "/"
    ) {
      return { enabled: false, emailRedirectTo: null };
    }
    // A fixed allowlisted return route: never accept a caller's ?next or
    // request Host header as email-confirmation redirect destination.
    return {
      enabled: true,
      emailRedirectTo: new URL(
        "/sign-in?next=%2Fbusinesses",
        origin,
      ).toString(),
    };
  } catch {
    return { enabled: false, emailRedirectTo: null };
  }
}

export function publicSignupConfig(): PublicSignupConfig {
  return resolvePublicSignupConfig(
    process.env.DEPOTFLOW_PUBLIC_SIGNUP_ENABLED,
    process.env.DEPOTFLOW_SIGNUP_REDIRECT_ORIGIN,
  );
}
