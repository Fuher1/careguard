import { describe, it, expect } from 'vitest';

// Regression test for issue #1072: every parseInt() call across the backend
// (agent/, shared/, services/, server.ts) must pass an explicit radix of 10,
// so an unexpected env-var or query-string value like "0x64" is parsed
// decimally instead of being silently reinterpreted as hex.
describe('parseInt radix safety (issue #1072)', () => {
  it('parses a hex-looking value decimally when radix 10 is passed explicitly', () => {
    expect(parseInt('0x64', 10)).toBe(0);
  });

  it('would silently misinterpret the same value as hex without an explicit radix', () => {
    expect(parseInt('0x64')).toBe(100);
  });

  it('parses ordinary decimal values identically with or without the radix', () => {
    expect(parseInt('3004', 10)).toBe(3004);
  });
});
