import { createRemoteJWKSet, jwtVerify } from "jose";

/** Audience requested by `.github/workflows/health-check.yml`. */
export const GITHUB_OIDC_AUDIENCE = "bigbrother-cron";

const ISSUER = "https://token.actions.githubusercontent.com";
const JWKS = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks`));

/**
 * Accept GitHub Actions OIDC tokens so the health-check workflow does not
 * need a duplicated CRON_SECRET Actions secret.
 *
 * Expected claims (see GitHub docs for `ACTIONS_ID_TOKEN_REQUEST_URL`):
 *   iss = https://token.actions.githubusercontent.com
 *   aud = bigbrother-cron
 *   repository = odkiii/bigbrother (override via GITHUB_OIDC_REPOSITORY)
 *   workflow_ref contains .github/workflows/health-check.yml
 */
export async function verifyGitHubActionsOidc(
  token: string | null | undefined,
): Promise<boolean> {
  if (!token || token.split(".").length !== 3) return false;

  const allowedRepo =
    process.env.GITHUB_OIDC_REPOSITORY?.trim() || "odkiii/bigbrother";
  const audience =
    process.env.GITHUB_OIDC_AUDIENCE?.trim() || GITHUB_OIDC_AUDIENCE;

  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: ISSUER,
      audience,
      clockTolerance: 30,
    });

    if (payload.repository !== allowedRepo) return false;

    const workflowRef = String(payload.workflow_ref ?? "");
    if (!workflowRef.includes("/.github/workflows/health-check.yml@")) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}
