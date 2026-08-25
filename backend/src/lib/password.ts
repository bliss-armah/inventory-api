import bcrypt from "bcryptjs";
import { env } from "../config/env.ts";

const SALT_ROUNDS = env.NODE_ENV === "test" ? 4 : 12;

// A valid cost-12 hash of an arbitrary string, used only so a login attempt
// against a nonexistent email takes the same amount of time as one against
// a real account — otherwise the response-time difference is a user
// enumeration oracle.
const DUMMY_HASH =
  env.NODE_ENV === "test"
    ? "$2b$04$ESvGJiIzDZbk8fjDz861hOaUOcLG7GfbV5iuTW2E7ykeNGfC/Mbla"
    : "$2b$12$yzTYF9/dHlYsg2qkFGZ1wO6Rfhq3u24J4GOtT/D5PJPieZn0I/i4S";

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** Call on the "user not found" branch of login so both branches take the same time. */
export function verifyPasswordTimingSafeNoop(plain: string): Promise<boolean> {
  return bcrypt.compare(plain, DUMMY_HASH);
}
