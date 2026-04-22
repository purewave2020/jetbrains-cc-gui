import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, homedir } from 'path';

const CONFIG_DIR = join(homedir(), '.cc-gui');
const CONFIG_FILE = join(CONFIG_DIR, 'settings.json');

const DEFAULT_CONFIG = {
  version: 2,
  claude: {
    current: '',
    providers: {},
    providerOrder: [],
  },
  codex: {
    current: '',
    providers: {},
    localConfigAuthorized: false,
  },
  streaming: { default: true },
  autoOpenFile: { default: false },
  sendShortcut: { default: 'enter' },
  soundNotification: {
    enabled: false,
    onlyWhenUnfocused: false,
    selectedSound: 'default',
  },
};

function ensureConfigDir() {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function loadConfig() {
  try {
    if (existsSync(CONFIG_FILE)) {
      const raw = readFileSync(CONFIG_FILE, 'utf8');
      return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    }
  } catch (e) {
    console.error('[config-store] Failed to load config:', e.message);
  }
  return { ...DEFAULT_CONFIG };
}

export function saveConfig(config) {
  ensureConfigDir();
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
}

export function updateConfig(partial) {
  const config = loadConfig();
  const merged = deepMerge(config, partial);
  saveConfig(merged);
  return merged;
}

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === 'object' &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}
