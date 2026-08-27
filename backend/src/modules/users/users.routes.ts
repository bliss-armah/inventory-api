import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { PERMISSIONS } from "../../shared/permissions";
import * as usersController from "./users.controller";

export const usersRoutes = Router();

usersRoutes.use(authenticate, authorize(...PERMISSIONS.users.manage));

usersRoutes.get("/", usersController.list);
// Adding a staff member is an invitation, not an account creation: the person
// may already have an identity in another business, and nobody here gets to
// set a password on it.
usersRoutes.post("/", usersController.invite);
usersRoutes.delete("/invites/:id", usersController.revokeInvite);
// `:id` is a membership id — what an owner can change is this person's access
// to *this* business, never their identity.
usersRoutes.patch("/:id", usersController.update);
usersRoutes.delete("/:id", usersController.remove);
