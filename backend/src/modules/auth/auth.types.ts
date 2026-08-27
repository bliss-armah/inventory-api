import type { Role, OtpChannel } from "../../generated/prisma";

export type AuthenticatedUser = {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  role: Role;
};

export type AuthResult = {
  user: AuthenticatedUser;
  accessToken: string;
  refreshToken: string;
};

/** One entry in the "which business?" picker. */
export type BusinessOption = {
  tenantId: string;
  businessName: string;
  role: Role;
};

/**
 * login()/register() no longer always complete a session synchronously. A user
 * who needs 2FA gets a pending bearer token instead, and one who belongs to
 * more than one business gets another for the selection step — the caller
 * (auth.controller.ts) branches on `status` to decide whether to set the
 * refresh cookie or hand back an mfaToken for the client to continue with.
 *
 * `select_business` always comes *after* any second factor. A password alone
 * must not be enough to learn which businesses an address belongs to.
 */
export type LoginOutcome =
  | ({ status: "success"; viaRememberedDevice: boolean } & AuthResult)
  | { status: "otp_required"; mfaToken: string; channel: OtpChannel }
  | { status: "setup_required"; mfaToken: string }
  | {
      status: "select_business";
      mfaToken: string;
      businesses: BusinessOption[];
    };
