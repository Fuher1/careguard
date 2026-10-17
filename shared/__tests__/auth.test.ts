import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { Request, Response } from "express";
import { safeCompare, requireApiKey } from "../auth.ts";

describe("safeCompare", () => {
  it("should return true for identical strings", () => {
    expect(safeCompare("hello", "hello")).toBe(true);
    expect(safeCompare("", "")).toBe(true);
    expect(safeCompare("a".repeat(100), "a".repeat(100))).toBe(true);
  });

  it("should return false for different strings of the same length", () => {
    expect(safeCompare("hello", "world")).toBe(false);
    expect(safeCompare("a", "b")).toBe(false);
  });

  it("should return false for strings of different lengths", () => {
    expect(safeCompare("hello", "helloo")).toBe(false);
    expect(safeCompare("helloo", "hello")).toBe(false);
    expect(safeCompare("", "a")).toBe(false);
  });
});

interface MockResponse extends Response {
  status: any;
  setHeader: any;
  json: any;
}

function createMockResponse(): MockResponse {
  const res = {} as any;
  res.status = vi.fn().mockReturnValue(res);
  res.setHeader = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe("requireApiKey middleware", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should call next() if AGENT_API_KEY is not configured and not in production", () => {
    delete process.env.AGENT_API_KEY;
    process.env.NODE_ENV = "test";

    const req = {
      headers: {},
      query: {},
    } as unknown as Request;
    const res = createMockResponse();
    const next = vi.fn();

    requireApiKey(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("should fail-closed and return 401 if AGENT_API_KEY is not configured and in production", () => {
    delete process.env.AGENT_API_KEY;
    process.env.NODE_ENV = "production";

    const req = {
      headers: {},
      query: {},
    } as unknown as Request;
    const res = createMockResponse();
    const next = vi.fn();

    requireApiKey(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.setHeader).toHaveBeenCalledWith("WWW-Authenticate", "Bearer");
    expect(res.json).toHaveBeenCalledWith({
      error: "Unauthorized: AGENT_API_KEY is not configured",
    });
  });

  it("should call next() when the Authorization header is a valid Bearer token", () => {
    process.env.AGENT_API_KEY = "super-secret-key";

    const req = {
      headers: {
        authorization: "Bearer super-secret-key",
      },
      query: {},
    } as unknown as Request;
    const res = createMockResponse();
    const next = vi.fn();

    requireApiKey(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("should call next() when the apiKey is passed as a valid query param", () => {
    process.env.AGENT_API_KEY = "super-secret-key";

    const req = {
      headers: {},
      query: {
        apiKey: "super-secret-key",
      },
    } as unknown as Request;
    const res = createMockResponse();
    const next = vi.fn();

    requireApiKey(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("should fail and return 401 when the Authorization header is incorrect", () => {
    process.env.AGENT_API_KEY = "super-secret-key";

    const req = {
      headers: {
        authorization: "Bearer wrong-key",
      },
      query: {},
    } as unknown as Request;
    const res = createMockResponse();
    const next = vi.fn();

    requireApiKey(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.setHeader).toHaveBeenCalledWith("WWW-Authenticate", "Bearer");
    expect(res.json).toHaveBeenCalledWith({
      error: "Unauthorized: Invalid AGENT_API_KEY",
    });
  });

  it("should fail and return 401 when the query param key is incorrect", () => {
    process.env.AGENT_API_KEY = "super-secret-key";

    const req = {
      headers: {},
      query: {
        apiKey: "wrong-key",
      },
    } as unknown as Request;
    const res = createMockResponse();
    const next = vi.fn();

    requireApiKey(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.setHeader).toHaveBeenCalledWith("WWW-Authenticate", "Bearer");
    expect(res.json).toHaveBeenCalledWith({
      error: "Unauthorized: Invalid AGENT_API_KEY",
    });
  });

  it("should fail and return 401 when credentials are missing completely", () => {
    process.env.AGENT_API_KEY = "super-secret-key";

    const req = {
      headers: {},
      query: {},
    } as unknown as Request;
    const res = createMockResponse();
    const next = vi.fn();

    requireApiKey(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.setHeader).toHaveBeenCalledWith("WWW-Authenticate", "Bearer");
    expect(res.json).toHaveBeenCalledWith({
      error: "Unauthorized: Invalid AGENT_API_KEY",
    });
  });

  it("should fail and return 401 when the Authorization header is Bearer but with no key", () => {
    process.env.AGENT_API_KEY = "super-secret-key";

    const req = {
      headers: {
        authorization: "Bearer ",
      },
      query: {},
    } as unknown as Request;
    const res = createMockResponse();
    const next = vi.fn();

    requireApiKey(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("should fail and return 401 when apiKey query param is not a string", () => {
    process.env.AGENT_API_KEY = "super-secret-key";

    const req = {
      headers: {},
      query: {
        apiKey: ["key1", "key2"],
      },
    } as unknown as Request;
    const res = createMockResponse();
    const next = vi.fn();

    requireApiKey(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
