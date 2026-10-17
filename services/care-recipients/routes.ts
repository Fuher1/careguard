import { Router, type Request, type Response, type NextFunction } from "express";
import type { CareRecipientsStore, CareRecipientEntity } from "./db.ts";
import { registerKnownNames } from "../../shared/redact.ts";

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const list: Record<string, string> = {};
  if (!cookieHeader) return list;
  cookieHeader.split(";").forEach((cookie) => {
    const parts = cookie.split("=");
    list[parts.shift()!.trim()] = decodeURIComponent(parts.join("="));
  });
  return list;
}

export function requireCaregiverToken(caregiverToken: string) {
  return function (req: Request, res: Response, next: NextFunction) {
    const auth = req.headers.authorization;
    let token: string | undefined;

    if (auth?.startsWith("Bearer ")) {
      token = auth.slice("Bearer ".length);
    } else {
      const cookies = parseCookies(req.headers.cookie);
      token = cookies["caregiver_token"];

      if (token) {
        const csrfHeader = req.headers["x-csrf-token"];
        const csrfCookie = cookies["csrf_token"];
        if (!csrfHeader || !csrfCookie || csrfHeader !== csrfCookie) {
          res.status(403).json({ error: "CSRF token mismatch or missing" });
          return;
        }
      }
    }

    if (!token) {
      res.status(401).setHeader("WWW-Authenticate", "Bearer").json({ error: "Missing caregiver token" });
      return;
    }
    if (token !== caregiverToken) {
      res.status(403).json({ error: "Invalid caregiver token" });
      return;
    }
    next();
  };
}

/**
 * Care recipients CRUD routes, extracted from server.ts (Issue #791) so they
 * can be exercised via supertest against a real CareRecipientsStore without
 * booting the full unified server (Sentry/Stellar/LLM/agent runtime).
 */
export function createCareRecipientsRouter(store: CareRecipientsStore, caregiverToken: string): Router {
  const router = Router();
  const auth = requireCaregiverToken(caregiverToken);

  router.get("/recipients", auth, (_req, res) => {
    res.json(store.list());
  });

  router.post("/recipients", auth, (req, res) => {
    const body = req.body as Partial<CareRecipientEntity>;
    if (!body?.name || typeof body.name !== "string" || !body.name.trim()) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    const created = store.create({
      name: body.name.trim(),
      age: typeof body.age === "number" ? body.age : null,
      medications: Array.isArray(body.medications) ? body.medications : [],
      primary_doctor: typeof body.primary_doctor === "string" ? body.primary_doctor : null,
      insurance: typeof body.insurance === "string" ? body.insurance : null,
      caregiver_user_id: null,
    });
    registerKnownNames([created.name]);
    res.status(201).json(created);
  });

  return router;
}
