import type { Role } from "../../generated/prisma";

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

export type LoginOutcome =
  | ({ status: "success" } & AuthResult)
  | {
      status: "select_business";
      selectionToken: string;
      businesses: BusinessOption[];
    };
