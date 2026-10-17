import type { Request, Response, NextFunction } from "express";
import { safeCompare } from "./auth.ts";

/**
 * Shared Bearer-token admin check for pharmacy-admin routes.
 * Used by both the standalone pharmacy-api service and the unified server
 * so a single implementation (and a single safeCompare fix) covers both.
 */
export function createPharmacyAdminAuth(adminToken?: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!adminToken) {
      res.status(503).json({ error: "PHARMACY_ADMIN_TOKEN not configured" });
      return;
    }

    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      res
        .status(401)
        .setHeader("WWW-Authenticate", "Bearer")
        .json({ error: "Missing admin token" });
      return;
    }

    if (!safeCompare(auth.slice("Bearer ".length), adminToken)) {
      res.status(403).json({ error: "Invalid admin token" });
      return;
    }

    next();
  };
}
