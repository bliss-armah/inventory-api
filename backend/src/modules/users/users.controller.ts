import type { Request, Response } from "express";
import { created, ok } from "../../shared/api-response";
import { logActivity } from "../../lib/activity-logger";
import { requireParam } from "../../shared/params";
import * as usersService from "./users.service";
import { inviteStaffSchema, updateMembershipSchema } from "./users.validators";

export async function list(req: Request, res: Response) {
  const result = await usersService.list(req.auth!.tenantId, req.query);
  ok(res, result);
}

export async function invite(req: Request, res: Response) {
  const input = inviteStaffSchema.parse(req.body);
  const invitation = await usersService.invite(
    req.auth!.tenantId,
    req.auth!.userId,
    input,
  );
  await logActivity({
    tenantId: req.auth!.tenantId,
    userId: req.auth!.userId,
    action: "STAFF_INVITED",
    description: `Invitation sent to ${invitation.email} (${invitation.role})`,
  });
  created(res, invitation);
}

export async function revokeInvite(req: Request, res: Response) {
  const invitation = await usersService.revokeInvite(
    req.auth!.tenantId,
    requireParam(req, "id"),
  );
  await logActivity({
    tenantId: req.auth!.tenantId,
    userId: req.auth!.userId,
    action: "STAFF_INVITE_REVOKED",
    description: `Invitation to ${invitation.email} was revoked`,
  });
  ok(res, null, "Invitation revoked");
}

export async function update(req: Request, res: Response) {
  const input = updateMembershipSchema.parse(req.body);
  const membership = await usersService.update(
    req.auth!.tenantId,
    requireParam(req, "id"),
    input,
  );
  await logActivity({
    tenantId: req.auth!.tenantId,
    userId: req.auth!.userId,
    action: "USER_UPDATED",
    description: `Staff access updated for ${membership.user.email}`,
  });
  ok(res, membership);
}

export async function remove(req: Request, res: Response) {
  const membership = await usersService.remove(
    req.auth!.tenantId,
    requireParam(req, "id"),
  );
  await logActivity({
    tenantId: req.auth!.tenantId,
    userId: req.auth!.userId,
    action: "USER_REMOVED",
    description: `${membership.user.email} was removed from this business`,
  });
  ok(res, null, "Staff member removed");
}
