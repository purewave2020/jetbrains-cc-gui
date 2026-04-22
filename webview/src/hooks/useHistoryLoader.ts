import { useEffect } from 'react';
import { sendBridgeEvent } from '../utils/bridge';

export interface UseHistoryLoaderOptions {
  currentView: 'chat' | 'history' | 'settings';
  currentProvider: string;
}

export function useHistoryLoader(options: UseHistoryLoaderOptions): void {
  const { currentView, currentProvider } = options;

  useEffect(() => {
    if (currentView !== 'history') {
      return;
    }

    let currentTimer: ReturnType<typeof setTimeout> | null = null;

    const requestHistoryData = () => {
      sendBridgeEvent('load_history_data', currentProvider);
    };

    currentTimer = setTimeout(requestHistoryData, 50);

    return () => {
      if (currentTimer) {
        clearTimeout(currentTimer);
      }
    };
  }, [currentView, currentProvider]);
}
