import { AsyncLocalStorage } from "async_hooks";
import { randomUUID } from "crypto";
import type { RequestHandler } from "express";
import { log } from "./logger.ts";

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      _requestLifecycleMounted?: boolean;
    }
  }
}

interface RequestContext {
  requestId: string;
  agentRunId?: string;
}

const als = new AsyncLocalStorage<RequestContext>();

export function withRequestContext<T>(id: string, fn: () => T): T {
  return als.run({ requestId: id }, fn);
}

export function getRequestId(): string | undefined {
  return als.getStore()?.requestId;
}

export function setAgentRunId(agentRunId: string): void {
  const store = als.getStore();
  if (store) store.agentRunId = agentRunId;
}

export function getAgentRunId(): string | undefined {
  return als.getStore()?.agentRunId;
}

const SENSITIVE_PATHS = new Set(["/agent/run", "/bill/audit", "/pharmacy/order"]);

export function requestLifecycleMiddleware(): RequestHandler {
  return (req, res, next) => {
    if (req._requestLifecycleMounted) {
      throw new Error("requestLifecycleMiddleware mounted more than once on request");
    }
    req._requestLifecycleMounted = true;

    const id = (req.headers["x-request-id"] as string | undefined) || randomUUID();
    req.requestId = id;
    res.setHeader("X-Request-ID", id);

    const start = Date.now();

    res.on("finish", () => {
      const duration_ms = Date.now() - start;
      const { method } = req;
      const path = req.path || req.url;
      const status = res.statusCode;

      const data = { method, path, status, duration_ms };

      if (status >= 500) {
        log.error(data, "http");
      } else if (status >= 400 && SENSITIVE_PATHS.has(path)) {
        log.warn(data, "http");
      } else {
        log.info(data, "http");
      }
    });

    als.run({ requestId: id }, () => next());
  };
}
