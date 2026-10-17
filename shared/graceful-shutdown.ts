import type { Server } from "node:http";
import { logger as defaultLogger } from "./logger.ts";

/** Force-exit grace period if SHUTDOWN_TIMEOUT_MS is unset or invalid. */
export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 30000;

/**
 * Resolve the force-exit timeout: explicit `override` > `SHUTDOWN_TIMEOUT_MS` env var >
 * `DEFAULT_SHUTDOWN_TIMEOUT_MS`. A malformed or non-positive env value falls back to the
 * default rather than producing an effectively-immediate force exit.
 */
function resolveTimeoutMs(override: number | undefined): number {
  if (override !== undefined) return override;
  const raw = process.env.SHUTDOWN_TIMEOUT_MS;
  if (raw === undefined || raw.trim() === "") return DEFAULT_SHUTDOWN_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_SHUTDOWN_TIMEOUT_MS;
  return parsed;
}

export interface GracefulShutdownOptions {
  /** The HTTP server to drain — anything exposing Node's `http.Server#close` signature. */
  server: Pick<Server, "close">;
  /** Called synchronously when SIGTERM is received, before `server.close()` — e.g. to flip a readiness flag so `/ready` starts returning 503. */
  onDrainStart?: () => void;
  /** Overrides `SHUTDOWN_TIMEOUT_MS` / the 30000ms default. */
  timeoutMs?: number;
  /** Overrides the shared logger — mainly for tests. */
  logger?: Pick<typeof defaultLogger, "info" | "error">;
  /** Overrides `process.exit` — mainly for tests. */
  exit?: (code: number) => void;
}

/**
 * Registers a SIGTERM handler implementing the drain-then-force-exit pattern previously
 * duplicated across agent/server.ts, server.ts, services/pharmacy-payment/server.ts, and
 * services/drug-interaction-api/server.ts: on SIGTERM, drain `server` via `close()`, exiting
 * cleanly once it completes, or force-exiting after `timeoutMs` if `close()` hasn't finished
 * by then.
 *
 * Uses `process.on`, not `.once` — matching every original handler's behavior exactly, and
 * per Node's own guidance, `.once` is unsafe for signal handlers: after the listener
 * auto-removes on the first signal, a second SIGTERM would fall through to the OS's default
 * disposition (immediate termination) instead of running this handler again.
 */
export function gracefulShutdown(options: GracefulShutdownOptions): void {
  const { server, onDrainStart, logger = defaultLogger, exit = (code: number) => process.exit(code) } = options;
  const timeoutMs = resolveTimeoutMs(options.timeoutMs);

  process.on("SIGTERM", () => {
    logger.info("SIGTERM received. Draining server...");
    onDrainStart?.();

    server.close(() => {
      logger.info("Server closed. Exiting process.");
      exit(0);
    });

    setTimeout(() => {
      logger.error("Graceful shutdown timeout. Forcing exit.");
      exit(1);
    }, timeoutMs);
  });
}
