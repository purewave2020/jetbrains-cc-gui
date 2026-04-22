/**
 * settingsBootstrap.ts
 *
 * Handles initial configuration requests sent to the Java backend and the
 * processing of any values that arrived before the callbacks were registered
 * (stored in window.__pending* slots by main.tsx).
 */

import { sendBridgeEvent } from '../../utils/bridge';

/**
 * Fire the three settings queries to the backend.
 */
export const startInitialSettingsRequest = (): void => {
  setTimeout(() => {
    sendBridgeEvent('get_streaming_enabled');
    sendBridgeEvent('get_send_shortcut');
    sendBridgeEvent('get_auto_open_file_enabled');
  }, 200);
};

/**
 * Request the active provider configuration.  Retries until sendToJava is
 * available.
 */
export const startActiveProviderRequest = (): void => {
  setTimeout(() => {
    sendBridgeEvent('get_active_provider');
  }, 200);
};

/**
 * Request the current permission mode from the backend.
 */
export const startModeRequest = (): void => {
  setTimeout(() => {
    sendBridgeEvent('get_mode');
  }, 200);
};

/**
 * Request the thinking-enabled setting from the backend.
 */
export const startThinkingEnabledRequest = (): void => {
  setTimeout(() => {
    sendBridgeEvent('get_thinking_enabled');
  }, 200);
};

/**
 * Drain any pending window.__pending* values captured by main.tsx before
 * the React callbacks were registered.  Must be called after the corresponding
 * window.updateXxx / window.onXxx callbacks have been assigned.
 */
export const drainPendingSettings = (): void => {
  const w = window as unknown as Record<string, unknown>;

  if (w.__pendingStreamingEnabled) {
    const pending = w.__pendingStreamingEnabled as string;
    delete w.__pendingStreamingEnabled;
    window.updateStreamingEnabled?.(pending);
  }

  if (w.__pendingSendShortcut) {
    const pending = w.__pendingSendShortcut as string;
    delete w.__pendingSendShortcut;
    window.updateSendShortcut?.(pending);
  }

  if (w.__pendingAutoOpenFileEnabled) {
    const pending = w.__pendingAutoOpenFileEnabled as string;
    delete w.__pendingAutoOpenFileEnabled;
    window.updateAutoOpenFileEnabled?.(pending);
  }

  if (w.__pendingModeReceived) {
    const pending = w.__pendingModeReceived as string;
    delete w.__pendingModeReceived;
    window.onModeReceived?.(pending);
  }
};

/**
 * Drain any dependency-status payload that arrived before the callback was
 * registered, then trigger a fresh fetch.
 */
export const drainAndRequestDependencyStatus = (): void => {
  const w = window as unknown as Record<string, unknown>;

  if (w.__pendingDependencyStatus) {
    const pending = w.__pendingDependencyStatus as string;
    delete w.__pendingDependencyStatus;
    window.updateDependencyStatus?.(pending);
  }

  sendBridgeEvent('get_dependency_status');
};
