import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { gracefulShutdown, DEFAULT_SHUTDOWN_TIMEOUT_MS } from "../graceful-shutdown.ts";

function fakeLogger() {
  return { info: vi.fn(), error: vi.fn() };
}

/** A server whose close() never invokes its callback — simulates a hung drain. */
function hangingServer() {
  return { close: vi.fn() };
}

/** A server whose close() invokes its callback synchronously — simulates a clean drain. */
function cleanServer() {
  return { close: vi.fn((cb: () => void) => cb()) };
}

beforeEach(() => {
  vi.useFakeTimers();
  delete process.env.SHUTDOWN_TIMEOUT_MS;
});

afterEach(() => {
  process.removeAllListeners("SIGTERM");
  vi.useRealTimers();
});

describe("gracefulShutdown", () => {
  it("force-exits after the configured timeout when close() hangs", () => {
    const server = hangingServer();
    const logger = fakeLogger();
    const exit = vi.fn();

    gracefulShutdown({ server, logger, exit, timeoutMs: 5000 });
    process.emit("SIGTERM");

    expect(exit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5000);

    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(logger.error).toHaveBeenCalledWith("Graceful shutdown timeout. Forcing exit.");
  });

  it("does not force-exit before the configured timeout elapses", () => {
    const server = hangingServer();
    const exit = vi.fn();

    gracefulShutdown({ server, logger: fakeLogger(), exit, timeoutMs: 5000 });
    process.emit("SIGTERM");
    vi.advanceTimersByTime(4999);

    expect(exit).not.toHaveBeenCalled();
  });

  it("defaults the timeout to 30000ms when no override or env var is set", () => {
    const server = hangingServer();
    const exit = vi.fn();

    gracefulShutdown({ server, logger: fakeLogger(), exit });
    process.emit("SIGTERM");

    vi.advanceTimersByTime(DEFAULT_SHUTDOWN_TIMEOUT_MS - 1);
    expect(exit).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("honors SHUTDOWN_TIMEOUT_MS from the environment when no explicit override is given", () => {
    process.env.SHUTDOWN_TIMEOUT_MS = "1000";
    const server = hangingServer();
    const exit = vi.fn();

    gracefulShutdown({ server, logger: fakeLogger(), exit });
    process.emit("SIGTERM");
    vi.advanceTimersByTime(1000);

    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it.each(["abc", "-100", "0", ""])(
    "falls back to the default timeout when SHUTDOWN_TIMEOUT_MS is malformed (%s)",
    (raw) => {
      process.env.SHUTDOWN_TIMEOUT_MS = raw;
      const server = hangingServer();
      const exit = vi.fn();

      gracefulShutdown({ server, logger: fakeLogger(), exit });
      process.emit("SIGTERM");

      vi.advanceTimersByTime(DEFAULT_SHUTDOWN_TIMEOUT_MS - 1);
      expect(exit).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    }
  );

  it("exits cleanly with code 0 once close() completes, without waiting for the timeout", () => {
    const server = cleanServer();
    const exit = vi.fn();

    gracefulShutdown({ server, logger: fakeLogger(), exit, timeoutMs: 5000 });
    process.emit("SIGTERM");

    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
    expect(server.close).toHaveBeenCalledTimes(1);
  });

  it("calls onDrainStart before draining begins", () => {
    const server = hangingServer();
    const onDrainStart = vi.fn(() => {
      expect(server.close).not.toHaveBeenCalled();
    });

    gracefulShutdown({ server, logger: fakeLogger(), exit: vi.fn(), onDrainStart, timeoutMs: 5000 });
    process.emit("SIGTERM");

    expect(onDrainStart).toHaveBeenCalledTimes(1);
    expect(server.close).toHaveBeenCalledTimes(1);
  });

  it("uses process.on, not .once — a second SIGTERM re-runs the handler, matching every original handler's behavior", () => {
    const server = cleanServer();
    const exit = vi.fn();

    gracefulShutdown({ server, logger: fakeLogger(), exit, timeoutMs: 5000 });
    process.emit("SIGTERM");
    process.emit("SIGTERM");

    expect(server.close).toHaveBeenCalledTimes(2);
    expect(exit).toHaveBeenCalledTimes(2);
  });
});
