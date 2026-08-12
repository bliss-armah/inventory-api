import type { Role, OtpChannel } from "../../generated/prisma/enums.ts";

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

/**
 * login()/register() no longer always complete a session synchronously —
 * a user who needs 2FA gets a pending bearer token instead, and the caller
 * (auth.controller.ts) branches on `status` to decide whether to set the
 * refresh cookie or hand back an mfaToken for the client to continue with.
 */
export type LoginOutcome =
  | ({ status: "success"; viaRememberedDevice: boolean } & AuthResult)
  | { status: "otp_required"; mfaToken: string; channel: OtpChannel }
  | { status: "setup_required"; mfaToken: string };
