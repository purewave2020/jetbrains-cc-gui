import { Router } from 'express';
import { loadConfig, saveConfig, updateConfig } from '../config-store.js';

const router = Router();

// Get full config
router.get('/', (_req, res) => {
  res.json(loadConfig());
});

// Update config (partial merge)
router.put('/', (req, res) => {
  const updated = updateConfig(req.body);
  res.json(updated);
});

// Get active provider
router.get('/active-provider', (_req, res) => {
  const config = loadConfig();
  const currentId = config.claude?.current || '';
  if (currentId && config.claude?.providers?.[currentId]) {
    res.json({ provider: config.claude.providers[currentId] });
  } else if (currentId === '__local_settings_json__') {
    res.json({ provider: { id: '__local_settings_json__', name: 'Local Settings', isLocalProvider: true } });
  } else if (currentId === '__cli_login__') {
    res.json({ provider: { id: '__cli_login__', name: 'CLI Login', isCliLoginProvider: true } });
  } else if (currentId === '__disabled__') {
    res.json({ provider: { id: '__disabled__', name: 'Disabled' } });
  } else {
    res.json({ provider: { id: 'anthropic', name: 'Anthropic', type: 'claude', apiKey: '', baseUrl: '' } });
  }
});

// Get permission mode
router.get('/mode', (_req, res) => {
  const config = loadConfig();
  res.json({ mode: config.permissionMode || 'default' });
});

// Set permission mode
router.put('/mode', (req, res) => {
  const { mode } = req.body;
  const updated = updateConfig({ permissionMode: mode });
  res.json({ mode: updated.permissionMode });
});

// Get model
router.get('/model', (_req, res) => {
  const config = loadConfig();
  res.json({ model: config.model || '' });
});

// Set model
router.put('/model', (req, res) => {
  const { model } = req.body;
  const updated = updateConfig({ model });
  res.json({ model: updated.model });
});

// Get providers list
router.get('/providers', (_req, res) => {
  const config = loadConfig();
  res.json({
    claude: {
      providers: config.claude?.providers || {},
      current: config.claude?.current || '',
      order: config.claude?.providerOrder || [],
    },
    codex: {
      providers: config.codex?.providers || {},
      current: config.codex?.current || '',
    },
  });
});

// Switch provider
router.put('/switch-provider', (req, res) => {
  const { provider, providerId } = req.body;
  const config = loadConfig();
  if (provider === 'claude') {
    config.claude = config.claude || {};
    config.claude.current = providerId;
  } else if (provider === 'codex') {
    config.codex = config.codex || {};
    config.codex.current = providerId;
  }
  saveConfig(config);
  res.json(config);
});

// Add/update provider
router.put('/provider', (req, res) => {
  const { type, provider } = req.body;
  const config = loadConfig();
  if (type === 'claude') {
    config.claude = config.claude || { providers: {}, providerOrder: [] };
    config.claude.providers[provider.id] = provider;
    if (!config.claude.providerOrder.includes(provider.id)) {
      config.claude.providerOrder.push(provider.id);
    }
  } else if (type === 'codex') {
    config.codex = config.codex || { providers: {} };
    config.codex.providers[provider.id] = provider;
  }
  saveConfig(config);
  res.json(config);
});

// Delete provider
router.delete('/provider/:type/:id', (req, res) => {
  const { type, id } = req.params;
  const config = loadConfig();
  if (type === 'claude' && config.claude?.providers) {
    delete config.claude.providers[id];
    config.claude.providerOrder = (config.claude.providerOrder || []).filter(p => p !== id);
    if (config.claude.current === id) config.claude.current = '';
  } else if (type === 'codex' && config.codex?.providers) {
    delete config.codex.providers[id];
    if (config.codex.current === id) config.codex.current = '';
  }
  saveConfig(config);
  res.json(config);
});

// Streaming enabled
router.get('/streaming', (_req, res) => {
  const config = loadConfig();
  res.json({ enabled: config.streaming?.default ?? true });
});
router.put('/streaming', (req, res) => {
  const { enabled } = req.body;
  const updated = updateConfig({ streaming: { default: enabled } });
  res.json({ enabled: updated.streaming.default });
});

// Send shortcut
router.get('/send-shortcut', (_req, res) => {
  const config = loadConfig();
  res.json({ shortcut: config.sendShortcut?.default || 'enter' });
});
router.put('/send-shortcut', (req, res) => {
  const { shortcut } = req.body;
  const updated = updateConfig({ sendShortcut: { default: shortcut } });
  res.json({ shortcut: updated.sendShortcut.default });
});

// Auto open file
router.get('/auto-open-file', (_req, res) => {
  const config = loadConfig();
  res.json({ enabled: config.autoOpenFile?.default ?? true });
});
router.put('/auto-open-file', (req, res) => {
  const { enabled } = req.body;
  const updated = updateConfig({ autoOpenFile: { default: enabled } });
  res.json({ enabled: updated.autoOpenFile.default });
});

// Sound notification
router.get('/sound-notification', (_req, res) => {
  const config = loadConfig();
  const sn = config.soundNotification || {};
  res.json({ enabled: sn.enabled ?? false, onlyWhenUnfocused: sn.onlyWhenUnfocused ?? false, selectedSound: sn.selectedSound || 'default', customSoundPath: sn.customSoundPath || '' });
});
router.put('/sound-notification', (req, res) => {
  const updated = updateConfig({ soundNotification: req.body });
  const sn = updated.soundNotification;
  res.json({ enabled: sn.enabled ?? false, onlyWhenUnfocused: sn.onlyWhenUnfocused ?? false, selectedSound: sn.selectedSound || 'default', customSoundPath: sn.customSoundPath || '' });
});

// Commit generation
router.get('/commit-generation', (_req, res) => {
  const config = loadConfig();
  res.json({ enabled: config.commitGeneration?.enabled ?? true, prompt: config.commitGeneration?.prompt || '' });
});
router.put('/commit-generation', (req, res) => {
  const updated = updateConfig({ commitGeneration: req.body });
  res.json({ enabled: updated.commitGeneration.enabled ?? true, prompt: updated.commitGeneration.prompt || '' });
});

// Codex sandbox mode
router.get('/codex-sandbox-mode', (_req, res) => {
  const config = loadConfig();
  res.json({ sandboxMode: config.codex?.sandboxMode || 'workspace-write' });
});
router.put('/codex-sandbox-mode', (req, res) => {
  const config = loadConfig();
  config.codex = config.codex || {};
  config.codex.sandboxMode = req.body.sandboxMode;
  saveConfig(config);
  res.json({ sandboxMode: config.codex.sandboxMode });
});

// Node path
router.get('/node-path', (_req, res) => {
  const config = loadConfig();
  res.json({ path: config.nodePath || '', version: null });
});
router.put('/node-path', (req, res) => {
  const updated = updateConfig({ nodePath: req.body.path });
  res.json({ path: updated.nodePath || '', version: null });
});

// Working directory
router.get('/working-directory', (_req, res) => {
  const config = loadConfig();
  res.json({ customWorkingDir: config.workingDirectory || '' });
});
router.put('/working-directory', (req, res) => {
  const updated = updateConfig({ workingDirectory: req.body.customWorkingDir });
  res.json({ customWorkingDir: updated.workingDirectory || '' });
});

// Status bar widget
router.get('/status-bar-widget', (_req, res) => {
  const config = loadConfig();
  res.json({ enabled: config.statusBarWidget?.enabled ?? true });
});
router.put('/status-bar-widget', (req, res) => {
  const updated = updateConfig({ statusBarWidget: { enabled: req.body.enabled } });
  res.json({ enabled: updated.statusBarWidget.enabled });
});

// Reasoning effort
router.get('/reasoning-effort', (_req, res) => {
  const config = loadConfig();
  res.json({ effort: config.reasoningEffort || 'medium' });
});
router.put('/reasoning-effort', (req, res) => {
  const updated = updateConfig({ reasoningEffort: req.body.effort });
  res.json({ effort: updated.reasoningEffort });
});

// Selected agent
router.get('/selected-agent', (_req, res) => {
  const config = loadConfig();
  res.json({ agentId: config.selectedAgent || '' });
});
router.put('/selected-agent', (req, res) => {
  const updated = updateConfig({ selectedAgent: req.body.agentId });
  res.json({ agentId: updated.selectedAgent });
});

// Provider sort order
router.put('/sort-providers', (req, res) => {
  const { type, order } = req.body;
  const config = loadConfig();
  if (type === 'claude') {
    config.claude = config.claude || {};
    config.claude.providerOrder = order;
  } else if (type === 'codex') {
    config.codex = config.codex || {};
    config.codex.providerOrder = order;
  }
  saveConfig(config);
  res.json({ success: true });
});

export default router;
