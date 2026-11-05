import { generatePassword } from "../../lib/password-generator.ts";
import { hashPassword } from "../../lib/password.ts";
import * as authRepository from "./auth.repository.ts";

export type AdminPasswordResult = {
  generated: boolean;
  password: string | null;
};

export async function setPasswordForUser(
  userId: string,
  requested?: string,
): Promise<AdminPasswordResult> {
  const generated = requested === undefined;
  const password = requested ?? generatePassword();
  await authRepository.updatePassword(userId, await hashPassword(password));
  await authRepository.revokeAllRefreshTokensForUser(userId);
  return { generated, password: generated ? password : null };
}
