import type { Request } from "express";
import { BadRequestError } from "./errors";

/**
 * Express 5's route params are typed `string | string[] | undefined` because
 * path-to-regexp v8 allows repeated param segments. Every route in this app
 * uses single, non-repeating params, so this narrows back to `string`.
 */
export function requireParam(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== "string") {
    throw new BadRequestError(`Missing route parameter: ${name}`);
  }
  return value;
}
