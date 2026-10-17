import "@testing-library/jest-dom/vitest";
import { vi, afterEach } from "vitest";
import path from "path";
import fs from "fs";

process.env.LOG_LEVEL = "silent";
process.env.CAREGIVER_TOKEN = process.env.CAREGIVER_TOKEN || "test-caregiver-token";
process.env.AGENT_SECRET_KEY = process.env.AGENT_SECRET_KEY || "SAQDKF5AKPWQZRXGHLH523VC7DU46U7IEQNOALOUO2A2UR55NWPVDRGF";
process.env.MOCK_NETWORK = "1";
process.env.STELLAR_NETWORK = "testnet";
process.env.PHARMACY_1_PUBLIC_KEY = process.env.PHARMACY_1_PUBLIC_KEY || "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
process.env.BILL_PROVIDER_PUBLIC_KEY = process.env.BILL_PROVIDER_PUBLIC_KEY || "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
process.env.MPP_SECRET_KEY = process.env.MPP_SECRET_KEY || "mock-secret";
process.env.LLM_API_KEY = process.env.LLM_API_KEY || "mock-api-key";

const workerId = process.env.VITEST_WORKER_ID || Math.random().toString(36).slice(2);
process.env.DATA_DIR = path.join(__dirname, `data-test-env-${workerId}`);

export function scrubEnv(...keys: string[]) {
  const snapshot: Record<string, string | undefined> = {};
  for (const key of keys) {
    snapshot[key] = process.env[key];
  }
  return {
    restore: () => {
      for (const key of keys) {
        if (snapshot[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = snapshot[key];
        }
      }
    },
  };
}

export function createFetchMock() {
  const mock = vi.fn();
  vi.stubGlobal("fetch", mock);
  return mock;
}

export function createHorizonMock() {
  return {
    Horizon: {
      Server: class {
        transactions() {
          return {
            transaction: () => ({
              call: async () => ({ successful: true }),
            }),
          };
        }
        loadAccount() {
          return Promise.resolve({ balances: [] });
        }
      },
    },
  };
}

vi.mock("next/navigation", () => {
  const searchParams = new URLSearchParams();
  return {
    useSearchParams: () => searchParams,
    usePathname: () => "/",
    useRouter: () => ({
      push: vi.fn(),
      replace: vi.fn(),
      prefetch: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
      refresh: vi.fn(),
    }),
  };
});

afterEach(() => {
  const dir = process.env.DATA_DIR;
  if (dir && fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

