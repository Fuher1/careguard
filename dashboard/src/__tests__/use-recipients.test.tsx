/**
 * Tests for Issue #1112 — useRecipients must surface an error state when the
 * /recipients fetch fails, instead of silently resolving to an empty list.
 *
 * Follows the per-source health pattern (#213) used for agentInfo/spending/
 * transactions, so a failed request shows up in DashboardHeader's "Data issue"
 * chip rather than looking identical to "no recipients returned".
 */

import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { useRecipients } from '../lib/use-recipients';

const recipients = [
  {
    id: 'rosa_garcia',
    name: 'Rosa Garcia',
    age: 72,
    medications: [],
    primary_doctor: null,
    insurance: null,
  },
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useRecipients — error state (Issue #1112)', () => {
  it('exposes an error when the request rejects', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('connection refused'));

    const { result } = renderHook(() => useRecipients(vi.fn()));

    await waitFor(() => expect(result.current.error).toBe('connection refused'));
    expect(result.current.recipients).toEqual([]);
  });

  it('exposes an error when the response is not ok', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('nope', { status: 503 }),
    );

    const { result } = renderHook(() => useRecipients(vi.fn()));

    await waitFor(() =>
      expect(result.current.error).toBe('Recipients returned 503'),
    );
    expect(result.current.recipients).toEqual([]);
  });

  it('stays healthy (error null) and loads data when the fetch succeeds', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(recipients), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const { result } = renderHook(() => useRecipients(vi.fn()));

    await waitFor(() => expect(result.current.recipients).toHaveLength(1));
    expect(result.current.error).toBeNull();
  });
});
