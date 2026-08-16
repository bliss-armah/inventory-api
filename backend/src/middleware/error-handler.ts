import type { NextFunction, Request, Response } from "express";
import { ZodError, z } from "zod";
import { AppError } from "../shared/errors";
import { isProduction } from "../config/env";

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
}

// Express 5 forwards rejected promises from async handlers to this middleware
// automatically, so route handlers never need a manual try/catch wrapper.
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
) {
  if (err instanceof ZodError) {
    const { fieldErrors, formErrors } = z.flattenError(err);
    res.status(400).json({
      success: false,
      // Form-level issues carry an empty path, so they never land in
      // fieldErrors — a strictObject rejecting an unknown key is exactly that.
      // Reporting only fieldErrors left the client with "Validation failed" and
      // no clue which key it sent was wrong, so surface them in the message.
      message: formErrors.length > 0 ? formErrors.join("; ") : "Validation failed",
      errors: fieldErrors,
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      message: err.message,
      errors: err.errors,
    });
    return;
  }

  console.error(err);
  res.status(500).json({
    success: false,
    message: isProduction ? "Internal server error" : (err as Error)?.message,
  });
}
