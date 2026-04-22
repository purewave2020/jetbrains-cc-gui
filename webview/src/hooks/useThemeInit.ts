import { useEffect, useState } from 'react';
import { sendBridgeEvent } from '../utils/bridge';

/**
 * Manages IDE theme initialization and synchronization.
 * Handles font scaling, background color, and theme mode detection.
 */
export function useThemeInit() {
  // IDE theme state - prefer initial theme injected by Java
  const [ideTheme, setIdeTheme] = useState<'light' | 'dark' | null>(() => {
    const injectedTheme = (window as any).__INITIAL_IDE_THEME__;
    if (injectedTheme === 'light' || injectedTheme === 'dark') {
      return injectedTheme;
    }
    return null;
  });

  // Initialize theme and font scaling
  useEffect(() => {
    // Register IDE theme received callback
    window.onIdeThemeReceived = (jsonStr: string) => {
      try {
        const themeData = JSON.parse(jsonStr);
        const theme = themeData.isDark ? 'dark' : 'light';
        setIdeTheme(theme);
      } catch {
        // Failed to parse IDE theme response
      }
    };

    // Listen for IDE theme changes (when user switches theme in the IDE)
    window.onIdeThemeChanged = (jsonStr: string) => {
      try {
        const themeData = JSON.parse(jsonStr);
        const theme = themeData.isDark ? 'dark' : 'light';
        setIdeTheme(theme);
      } catch {
        // Failed to parse IDE theme change
      }
    };

    // Initialize font scaling
    const savedLevel = localStorage.getItem('fontSizeLevel');
    const level = savedLevel ? parseInt(savedLevel, 10) : 2; // Default level 2 (90%)
    const fontSizeLevel = (level >= 1 && level <= 6) ? level : 2;

    // Map level to scale ratio
    const fontSizeMap: Record<number, number> = {
      1: 0.8,   // 80%
      2: 0.9,   // 90% (default)
      3: 1.0,   // 100%
      4: 1.1,   // 110%
      5: 1.2,   // 120%
      6: 1.4,   // 140%
    };
    const scale = fontSizeMap[fontSizeLevel] || 1.0;
    document.documentElement.style.setProperty('--font-scale', scale.toString());

    // Initialize chat background color (validate hex format before applying)
    const isValidHexColor = (c: string) => /^#[0-9a-fA-F]{6}$/.test(c);
    const savedChatBgColor = localStorage.getItem('chatBgColor');
    if (savedChatBgColor && isValidHexColor(savedChatBgColor)) {
      document.documentElement.style.setProperty('--bg-chat', savedChatBgColor);
    }

    // Initialize user message bubble color
    const savedUserMsgColor = localStorage.getItem('userMsgColor');
    if (savedUserMsgColor && isValidHexColor(savedUserMsgColor)) {
      document.documentElement.style.setProperty('--color-message-user-bg', savedUserMsgColor);
    }

    // Request IDE theme
    const requestIdeTheme = () => {
      sendBridgeEvent('get_ide_theme');
    };

    setTimeout(requestIdeTheme, 100);
  }, []);

  // Re-apply theme when IDE theme changes (if user chose "Follow IDE")
  useEffect(() => {
    const savedTheme = localStorage.getItem('theme');

    // Only process after ideTheme has been loaded
    if (ideTheme === null) {
      return;
    }

    // If user selected "Follow IDE" mode
    if (savedTheme === null || savedTheme === 'system') {
      document.documentElement.setAttribute('data-theme', ideTheme);
    }
  }, [ideTheme]);

  return { ideTheme };
}
