/**
 * Tests for Issue #213 — per-source health chip in DashboardHeader.
 *
 * Verifies:
 *  1. When all sources are healthy (errors = null), no health chip is shown.
 *  2. When one source is down, the red "Data issue" chip is shown.
 *  3. Hovering the chip shows a tooltip naming the failing source.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { DashboardHeader } from '../components/dashboard-header';
import type { DashboardHeaderProps } from '../components/dashboard-header';

const baseProps: DashboardHeaderProps = {
  recipient: { name: 'Rosa Martinez', age: 72 } as any,
  recipientInitials: 'RM',
  agentInfo: null,
  agentConnected: true,
  agentPaused: false,
  walletBalance: null,
  onTogglePause: vi.fn(),
};

describe('DashboardHeader — source health chip (Issue #213)', () => {
  it('does not show health chip when all sources are healthy', () => {
    render(
      <DashboardHeader
        {...baseProps}
        agentInfoError={null}
        spendingError={null}
        transactionsError={null}
      />,
    );
    expect(screen.queryByTestId('source-health-chip')).toBeNull();
  });

  it('shows red chip when agentInfo source is down', () => {
    render(
      <DashboardHeader
        {...baseProps}
        agentInfoError="fetch failed: connection refused"
        spendingError={null}
        transactionsError={null}
      />,
    );
    const chip = screen.getByTestId('source-health-chip');
    expect(chip).toBeTruthy();
    expect(chip.textContent).toContain('Data issue');
  });

  it('shows chip when spending source is down', () => {
    render(
      <DashboardHeader
        {...baseProps}
        agentInfoError={null}
        spendingError="Spending returned 503"
        transactionsError={null}
      />,
    );
    expect(screen.getByTestId('source-health-chip')).toBeTruthy();
  });

  it('shows chip when transactions source is down', () => {
    render(
      <DashboardHeader
        {...baseProps}
        agentInfoError={null}
        spendingError={null}
        transactionsError="Transactions returned 500"
      />,
    );
    expect(screen.getByTestId('source-health-chip')).toBeTruthy();
  });

  it('tooltip names the failing source on hover', () => {
    render(
      <DashboardHeader
        {...baseProps}
        agentInfoError={null}
        spendingError="Spending returned 503"
        transactionsError={null}
      />,
    );
    const chip = screen.getByTestId('source-health-chip');
    fireEvent.mouseEnter(chip);
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip.textContent).toContain('Spending');
    expect(tooltip.textContent).toContain('Spending returned 503');
  });

  it('tooltip lists all failing sources when multiple are down', () => {
    render(
      <DashboardHeader
        {...baseProps}
        agentInfoError="Agent unavailable"
        spendingError="Spending returned 503"
        transactionsError={null}
      />,
    );
    fireEvent.mouseEnter(screen.getByTestId('source-health-chip'));
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip.textContent).toContain('Agent');
    expect(tooltip.textContent).toContain('Spending');
  });

  it('tooltip disappears on mouse leave', () => {
    render(
      <DashboardHeader
        {...baseProps}
        agentInfoError="Agent unavailable"
        spendingError={null}
        transactionsError={null}
      />,
    );
    const chip = screen.getByTestId('source-health-chip');
    fireEvent.mouseEnter(chip);
    expect(screen.getByRole('tooltip')).toBeTruthy();
    fireEvent.mouseLeave(chip);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
