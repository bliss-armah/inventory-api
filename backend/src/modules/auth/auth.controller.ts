import type { Request, Response } from "express";
import { created, ok } from "../../shared/api-response.ts";
import { env } from "../../config/env.ts";
import { ForbiddenError, UnauthorizedError } from "../../shared/errors.ts";
import { requireParam } from "../../shared/params.ts";
import {
  setRefreshCookie,
  clearRefreshCookie,
  REFRESH_COOKIE_NAME,
} from "../../lib/cookies.ts";
import * as authService from "./auth.service.ts";
import * as authRepository from "./auth.repository.ts";
import type { LoginOutcome } from "./auth.types.ts";
import {
  acceptInviteSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  selectBusinessSchema,
} from "./auth.validators.ts";

function respondWithOutcome(
  res: Response,
  outcome: LoginOutcome,
  send: (res: Response, body: unknown) => void = ok,
) {
  if (outcome.status === "success") {
    setRefreshCookie(res, outcome.refreshToken);
    send(res, {
      status: "success",
      user: outcome.user,
      accessToken: outcome.accessToken,
    });
    return;
  }
  send(res, {
    status: outcome.status,
    selectionToken: outcome.selectionToken,
    businesses: outcome.businesses,
  });
}

export async function register(req: Request, res: Response) {
  // Checked before validation on purpose: when signup is closed the caller
  // should hear "not allowed", not a critique of the payload they sent.
  if (!env.ALLOW_PUBLIC_REGISTRATION) {
    throw new ForbiddenError(
      "Public registration is disabled. Businesses are created by the platform administrator.",
    );
  }

  const input = registerSchema.parse(req.body);
  respondWithOutcome(res, await authService.register(input, req.ip), created);
}

export async function login(req: Request, res: Response) {
  const input = loginSchema.parse(req.body);
  respondWithOutcome(res, await authService.login(input, req.ip));
}

/**
 * The final step for someone who works in more than one business. Reached only
 * with a pending-login token — see authenticateBusinessSelection.
 */
export async function selectBusiness(req: Request, res: Response) {
  const { tenantId } = selectBusinessSchema.parse(req.body);
  const result = await authService.selectBusiness(
    req.auth!.userId,
    tenantId,
    req.auth!.pendingAuthId!,
    req.ip,
  );
  setRefreshCookie(res, result.refreshToken);
  ok(res, {
    status: "success",
    user: result.user,
    accessToken: result.accessToken,
  });
}

/** Moves an existing session to another of the caller's businesses. */
export async function switchBusiness(req: Request, res: Response) {
  const { tenantId } = selectBusinessSchema.parse(req.body);
  const result = await authService.switchBusiness(req.auth!.userId, tenantId);
  setRefreshCookie(res, result.refreshToken);
  ok(res, { user: result.user, accessToken: result.accessToken });
}

// ---------------------------------------------------------------------------
// Staff invitations
// ---------------------------------------------------------------------------

/**
 * Unauthenticated on purpose: the token came from an email sent to the address
 * it describes, so holding it already establishes who the reader is.
 */
export async function describeInvite(req: Request, res: Response) {
  ok(res, await authService.describeInvite(requireParam(req, "token")));
}

export async function acceptInvite(req: Request, res: Response) {
  const input = acceptInviteSchema.parse(req.body);
  respondWithOutcome(res, await authService.acceptInvite(input, req.ip), created);
}

export async function refresh(req: Request, res: Response) {
  const token = req.cookies?.[REFRESH_COOKIE_NAME];
  if (!token) {
    throw new UnauthorizedError("Missing refresh token");
  }
  const result = await authService.refresh(token);
  setRefreshCookie(res, result.refreshToken);
  ok(res, { user: result.user, accessToken: result.accessToken });
}

export async function logout(req: Request, res: Response) {
  const token = req.cookies?.[REFRESH_COOKIE_NAME];
  if (token) {
    await authService.logout(token);
  }
  clearRefreshCookie(res);
  ok(res, null);
}

export async function resetPassword(req: Request, res: Response) {
  const input = resetPasswordSchema.parse(req.body);
  await authService.resetPassword(input);
  ok(res, null, "Password reset successfully");
}

export async function me(req: Request, res: Response) {
  const user = await authRepository.findUserById(req.auth!.userId);
  if (!user) {
    throw new UnauthorizedError();
  }
  // tenantId and role describe *this session*, so they come from the token,
  // not the identity — the same person can be an OWNER in one business and a
  // CASHIER in another. `businesses` is what the in-app switcher renders.
  const businesses = await authService.listBusinesses(user.id);
  ok(res, {
    id: user.id,
    tenantId: req.auth!.tenantId,
    name: user.name,
    email: user.email,
    role: req.auth!.role,
    phone: user.phone,
    businesses,
  });
}
