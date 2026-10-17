/**
 * Per-button copy state.
 *
 * The two copy buttons in the dashboard live in WalletTab ("wallet-address")
 * and SettingsTab ("settings-wallet"). app/page.tsx mounts only the active tab
 * panel, so a single Dashboard render can never show both buttons — the tabs are
 * rendered directly here instead, with the shared next/navigation mock kept in
 * place for any transitive import of it.
 */
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WalletTab } from '../components/tabs/wallet-tab';
import { SettingsTab } from '../components/tabs/settings-tab';

// Shared next/navigation mock used by the other page-level tests.
vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/'),
  useSearchParams: vi.fn(() => ({ get: vi.fn(() => null) })),
}));

const WALLET_ADDRESS = 'TEST_WALLET_ADDRESS_123456789';

// copyText() only takes the clipboard path in a secure context, which jsdom does
// not provide, so both halves of that precondition are stubbed here.
const writeText = vi.fn().mockResolvedValue(undefined);
Object.assign(navigator, { clipboard: { writeText } });
Object.defineProperty(window, 'isSecureContext', {
  value: true,
  configurable: true,
});

const agentInfo = {
  service: 'CareGuard AI Agent',
  agentWallet: WALLET_ADDRESS,
  network: 'stellar:testnet',
  llm: 'groq/llama-3.3',
} as any;

function renderCopyButtons() {
  return render(
    <>
      <WalletTab
        agentInfo={agentInfo}
        walletBalance="42.50"
        walletXlm="10.20"
        walletBalanceState="ok"
      />
      <SettingsTab
        recipient={{ name: 'Rosa Garcia', age: 78 } as any}
        caregiver={{ name: 'Maria Garcia' } as any}
        agentInfo={agentInfo}
        agentPaused={false}
        onTogglePause={vi.fn()}
        onUpdateProfile={vi.fn().mockResolvedValue(undefined)}
      />
    </>,
  );
}

describe('Per-button Copy State', () => {
  beforeEach(() => {
    writeText.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should track copy state per button ID', async () => {
    renderCopyButtons();

    const copyButtons = screen.getAllByText('Copy');
    expect(copyButtons).toHaveLength(2);

    // Clicking the wallet button flips only that button's label.
    fireEvent.click(copyButtons[0]);
    await waitFor(() => {
      expect(copyButtons[0]).toHaveTextContent('Copied');
    });
    expect(copyButtons[1]).toHaveTextContent('Copy');

    // The settings button tracks its own state, keyed by its own button ID.
    fireEvent.click(copyButtons[1]);
    await waitFor(() => {
      expect(copyButtons[1]).toHaveTextContent('Copied');
    });
    expect(copyButtons[0]).toHaveTextContent('Copied');
  });

  it('should reset copy state after 2 seconds', async () => {
    // shouldAdvanceTime keeps waitFor's own polling alive under fake timers.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderCopyButtons();

    const copyButton = screen.getAllByText('Copy')[0];
    fireEvent.click(copyButton);

    await waitFor(() => {
      expect(copyButton).toHaveTextContent('Copied');
    });

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(copyButton).toHaveTextContent('Copy');
  });

  it('should call clipboard API with correct text', async () => {
    renderCopyButtons();

    fireEvent.click(screen.getAllByText('Copy')[0]);

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(WALLET_ADDRESS);
    });
    expect(writeText).toHaveBeenCalledTimes(1);
  });
});
