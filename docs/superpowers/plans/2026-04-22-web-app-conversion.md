# CC GUI Web App Conversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the JetBrains IDEA plugin into a standalone web app by adding an Express HTTP server to ai-bridge and replacing the JCEF JS bridge with HTTP/WebSocket communication.

**Architecture:** ai-bridge becomes the web server, serving the React webview as static files and providing REST + WebSocket APIs. The webview's `sendBridgeEvent()` calls are redirected through HTTP/WebSocket. All Java/IntelliJ code is deleted.

**Tech Stack:** Node.js, Express, ws (WebSocket), React 19, Vite, TypeScript

---

## File Structure

### New Files (ai-bridge server)

| File | Responsibility |
|------|---------------|
| `ai-bridge/server/index.js` | Express app entry: HTTP server, static files, WebSocket upgrade |
| `ai-bridge/server/routes/chat.js` | WebSocket handler for real-time chat streaming |
| `ai-bridge/server/routes/sessions.js` | REST: session CRUD |
| `ai-bridge/server/routes/settings.js` | REST: config read/write, provider/model management |
| `ai-bridge/server/routes/history.js` | REST: history list, load, delete, export, favorites |
| `ai-bridge/server/routes/mcp.js` | REST + WS: MCP server status, tools, toggle |
| `ai-bridge/server/routes/agents.js` | REST: agent CRUD |
| `ai-bridge/server/routes/prompts.js` | REST: prompt CRUD |
| `ai-bridge/server/routes/dependencies.js` | REST: SDK status, install/uninstall |
| `ai-bridge/server/routes/skills.js` | REST: skill list, import, toggle, delete |
| `ai-bridge/server/ws.js` | WebSocket connection manager (upgrade, message dispatch, heartbeat) |
| `ai-bridge/server/config-store.js` | Read/write `~/.cc-gui/settings.json` |
| `ai-bridge/server/session-store.js` | Session state management (in-memory + persistence) |
| `ai-bridge/server/middleware/cors.js` | CORS middleware for dev mode |

### New Files (webview bridge adapter)

| File | Responsibility |
|------|---------------|
| `webview/src/utils/ws-client.ts` | WebSocket client: connect, reconnect, message dispatch |
| `webview/src/utils/bridge-http.ts` | HTTP/WS implementation of bridge interface |
| `webview/src/global-web.d.ts` | Window type declarations for web mode |

### Modified Files

| File | Change |
|------|--------|
| `webview/src/utils/bridge.ts` | Add web mode detection, delegate to bridge-http |
| `webview/src/main.tsx` | Conditional bridge init (web vs JCEF) |
| `webview/vite.config.ts` | Add dev proxy, remove singlefile plugin |
| `webview/package.json` | Add proxy config, update scripts |
| `ai-bridge/package.json` | Add express, ws, cors dependencies |
| Root `package.json` (new) | Workspace monorepo config |

### Deleted Files/Directories

| Target | Reason |
|--------|--------|
| `src/` (entire Java source tree) | No longer an IntelliJ plugin |
| `test/` (Java tests) | No longer needed |
| `build.gradle`, `settings.gradle`, `gradle.properties` | Gradle build no longer needed |
| `gradlew`, `gradlew.bat`, `gradle/` | Gradle wrapper no longer needed |
| `checkstyle.xml`, `sandbox-idea.properties`, `local.properties.example` | IntelliJ build artifacts |
| `.idea/` | IDE project config |
| `build/` | Gradle build output |

---

## Task 1: Root Monorepo Setup

**Files:**
- Create: `package.json`

- [ ] **Step 1: Create root package.json with workspace config**

```json
{
  "name": "cc-gui",
  "version": "0.3.5",
  "private": true,
  "workspaces": ["webview", "ai-bridge"],
  "scripts": {
    "dev": "concurrently -n server,web -c blue,green \"npm run dev -w ai-bridge\" \"npm run dev -w webview\"",
    "build": "npm run build -w webview",
    "start": "npm run start -w ai-bridge"
  },
  "devDependencies": {
    "concurrently": "^9.1.0"
  }
}
```

- [ ] **Step 2: Install root dependencies**

Run: `cd E:/GitStore/jetbrains-cc-gui && npm install`
Expected: `node_modules` created, workspaces linked

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add root monorepo package.json with workspace config"
```

---

## Task 2: ai-bridge Express Server Skeleton

**Files:**
- Create: `ai-bridge/server/index.js`
- Create: `ai-bridge/server/middleware/cors.js`
- Modify: `ai-bridge/package.json`

- [ ] **Step 1: Update ai-bridge/package.json — add server dependencies and scripts**

Add to `dependencies`:
```json
"express": "^4.21.0",
"ws": "^8.18.0",
"cors": "^2.8.5"
```

Add to `scripts`:
```json
"dev": "node --watch server/index.js",
"start": "node server/index.js"
```

- [ ] **Step 2: Create ai-bridge/server/middleware/cors.js**

```js
import cors from 'cors';

export const corsMiddleware = cors({
  origin: ['http://localhost:5173', 'http://localhost:3001'],
  credentials: true,
});
```

- [ ] **Step 3: Create ai-bridge/server/index.js — Express app with static file serving and placeholder routes**

```js
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { corsMiddleware } from './middleware/cors.js';
import { createWsHandler } from './ws.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3001', 10);

const app = express();
app.use(corsMiddleware);
app.use(express.json());

// API routes (registered in later tasks)
// app.use('/api/sessions', sessionsRouter);
// app.use('/api/settings', settingsRouter);
// app.use('/api/history', historyRouter);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// Serve webview static files in production
const webviewDistPath = join(__dirname, '..', '..', 'webview', 'dist');
app.use(express.static(webviewDistPath));
app.get('*', (_req, res) => {
  res.sendFile(join(webviewDistPath, 'index.html'));
});

const server = createServer(app);

// WebSocket server
const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (request, socket, head) => {
  if (request.url === '/api/chat') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

const wsHandler = createWsHandler(wss);
wss.on('connection', (ws, request) => {
  wsHandler.handleConnection(ws, request);
});

server.listen(PORT, () => {
  console.log(`[cc-gui] Server running at http://localhost:${PORT}`);
  console.log(`[cc-gui] WebSocket at ws://localhost:${PORT}/api/chat`);
});
```

- [ ] **Step 4: Create minimal ai-bridge/server/ws.js — WebSocket handler stub**

```js
export function createWsHandler(wss) {
  return {
    handleConnection(ws, request) {
      console.log('[ws] Client connected');
      ws.on('message', (data) => {
        console.log('[ws] Received:', data.toString());
        ws.send(JSON.stringify({ type: 'connected', timestamp: Date.now() }));
      });
      ws.on('close', () => {
        console.log('[ws] Client disconnected');
      });
    },
  };
}
```

- [ ] **Step 5: Install ai-bridge dependencies and verify server starts**

Run: `cd E:/GitStore/jetbrains-cc-gui && npm install -w ai-bridge`
Run: `cd E:/GitStore/jetbrains-cc-gui/ai-bridge && node server/index.js &`
Expected: Server starts on port 3001, health check at `/api/health` returns `{"status":"ok"}`

- [ ] **Step 6: Commit**

```bash
git add ai-bridge/server/ ai-bridge/package.json ai-bridge/package-lock.json
git commit -m "feat: add Express server skeleton to ai-bridge with WebSocket support"
```

---

## Task 3: Config Store (Settings Persistence)

**Files:**
- Create: `ai-bridge/server/config-store.js`

- [ ] **Step 1: Create ai-bridge/server/config-store.js — read/write `~/.cc-gui/settings.json`**

```js
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
```

- [ ] **Step 2: Commit**

```bash
git add ai-bridge/server/config-store.js
git commit -m "feat: add config store for web app settings persistence"
```

---

## Task 4: Session Store

**Files:**
- Create: `ai-bridge/server/session-store.js`

- [ ] **Step 1: Create ai-bridge/server/session-store.js — in-memory session state with persistence via ai-bridge daemon**

```js
import { randomUUID } from 'crypto';

const sessions = new Map();

export function createSession(provider = 'claude') {
  const id = randomUUID();
  const session = {
    id,
    provider,
    model: null,
    permissionMode: 'default',
    reasoningEffort: 'medium',
    createdAt: Date.now(),
    channelId: null,
    busy: false,
  };
  sessions.set(id, session);
  return session;
}

export function getSession(id) {
  return sessions.get(id) || null;
}

export function updateSession(id, updates) {
  const session = sessions.get(id);
  if (!session) return null;
  Object.assign(session, updates);
  return session;
}

export function deleteSession(id) {
  return sessions.delete(id);
}

export function listSessions() {
  return Array.from(sessions.values());
}

export function getActiveSession() {
  // Return the most recently created session
  const all = listSessions();
  return all.length > 0 ? all[all.length - 1] : null;
}
```

- [ ] **Step 2: Commit**

```bash
git add ai-bridge/server/session-store.js
git commit -m "feat: add session store for web app session management"
```

---

## Task 5: Settings REST API

**Files:**
- Create: `ai-bridge/server/routes/settings.js`
- Modify: `ai-bridge/server/index.js`

- [ ] **Step 1: Create ai-bridge/server/routes/settings.js**

```js
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
  const provider = config.claude?.current || config.codex?.current || '';
  res.json({ provider });
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
  const { type, provider } = req.body; // type: 'claude' | 'codex'
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

export default router;
```

- [ ] **Step 2: Register settings route in ai-bridge/server/index.js**

Add after `app.use(express.json());`:
```js
import settingsRouter from './routes/settings.js';
app.use('/api/settings', settingsRouter);
```

- [ ] **Step 3: Test settings API**

Run: `cd E:/GitStore/jetbrains-cc-gui/ai-bridge && node server/index.js &`
Run: `curl http://localhost:3001/api/settings`
Expected: JSON config response with default values

Run: `curl -X PUT http://localhost:3001/api/settings/mode -H "Content-Type: application/json" -d '{"mode":"plan"}'`
Expected: `{"mode":"plan"}`

- [ ] **Step 4: Commit**

```bash
git add ai-bridge/server/routes/settings.js ai-bridge/server/index.js
git commit -m "feat: add settings REST API routes"
```

---

## Task 6: Sessions REST API

**Files:**
- Create: `ai-bridge/server/routes/sessions.js`
- Modify: `ai-bridge/server/index.js`

- [ ] **Step 1: Create ai-bridge/server/routes/sessions.js**

```js
import { Router } from 'express';
import { createSession, getSession, deleteSession, listSessions } from '../session-store.js';

const router = Router();

// List sessions
router.get('/', (_req, res) => {
  res.json(listSessions());
});

// Create session
router.post('/', (req, res) => {
  const { provider } = req.body || {};
  const session = createSession(provider || 'claude');
  res.status(201).json(session);
});

// Get session
router.get('/:id', (req, res) => {
  const session = getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json(session);
});

// Delete session
router.delete('/:id', (req, res) => {
  const deleted = deleteSession(req.params.id);
  if (!deleted) return res.status(404).json({ error: 'Session not found' });
  res.json({ success: true });
});

export default router;
```

- [ ] **Step 2: Register sessions route in index.js**

Add import and route registration:
```js
import sessionsRouter from './routes/sessions.js';
app.use('/api/sessions', sessionsRouter);
```

- [ ] **Step 3: Commit**

```bash
git add ai-bridge/server/routes/sessions.js ai-bridge/server/index.js
git commit -m "feat: add sessions REST API routes"
```

---

## Task 7: History REST API

**Files:**
- Create: `ai-bridge/server/routes/history.js`
- Modify: `ai-bridge/server/index.js`

- [ ] **Step 1: Create ai-bridge/server/routes/history.js**

This reads Claude/Codex session history from their existing file locations (`~/.claude/projects/` and `~/.codex/sessions/`).

```js
import { Router } from 'express';
import { readdir, readFile, stat, unlink } from 'fs/promises';
import { join, homedir } from 'path';
import { existsSync } from 'fs';

const router = Router();

const CLAUDE_SESSIONS_DIR = join(homedir(), '.claude', 'projects');
const CODEX_SESSIONS_DIR = join(homedir(), '.codex', 'sessions');

async function listClaudeSessions() {
  if (!existsSync(CLAUDE_SESSIONS_DIR)) return [];
  const sessions = [];
  try {
    const projectDirs = await readdir(CLAUDE_SESSIONS_DIR);
    for (const projectDir of projectDirs) {
      const sessionsDir = join(CLAUDE_SESSIONS_DIR, projectDir, 'sessions');
      if (!existsSync(sessionsDir)) continue;
      const files = await readdir(sessionsDir);
      for (const file of files) {
        if (!file.endsWith('.jsonl')) continue;
        const filePath = join(sessionsDir, file);
        try {
          const s = await stat(filePath);
          sessions.push({
            id: file.replace('.jsonl', ''),
            provider: 'claude',
            project: projectDir,
            lastModified: s.mtimeMs,
            size: s.size,
          });
        } catch { /* skip unreadable files */ }
      }
    }
  } catch { /* skip unreadable dirs */ }
  return sessions.sort((a, b) => b.lastModified - a.lastModified);
}

async function listCodexSessions() {
  if (!existsSync(CODEX_SESSIONS_DIR)) return [];
  const sessions = [];
  try {
    const dirs = await readdir(CODEX_SESSIONS_DIR);
    for (const dir of dirs) {
      const dirPath = join(CODEX_SESSIONS_DIR, dir);
      try {
        const s = await stat(dirPath);
        if (!s.isDirectory()) continue;
        sessions.push({
          id: dir,
          provider: 'codex',
          lastModified: s.mtimeMs,
        });
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return sessions.sort((a, b) => b.lastModified - a.lastModified);
}

// List all history sessions
router.get('/', async (req, res) => {
  const provider = req.query.provider || 'all';
  try {
    let sessions = [];
    if (provider === 'all' || provider === 'claude') {
      sessions = sessions.concat(await listClaudeSessions());
    }
    if (provider === 'all' || provider === 'codex') {
      sessions = sessions.concat(await listCodexSessions());
    }
    res.json(sessions);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get session detail
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  const { provider } = req.query;
  try {
    if (provider === 'claude') {
      // Search across project directories for the session file
      if (!existsSync(CLAUDE_SESSIONS_DIR)) return res.status(404).json({ error: 'Not found' });
      const projectDirs = await readdir(CLAUDE_SESSIONS_DIR);
      for (const projectDir of projectDirs) {
        const filePath = join(CLAUDE_SESSIONS_DIR, projectDir, 'sessions', `${id}.jsonl`);
        if (existsSync(filePath)) {
          const content = await readFile(filePath, 'utf8');
          const messages = content.trim().split('\n').map(line => {
            try { return JSON.parse(line); } catch { return null; }
          }).filter(Boolean);
          return res.json({ id, provider: 'claude', messages });
        }
      }
    }
    res.status(404).json({ error: 'Session not found' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Delete session
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const { provider, project } = req.query;
  try {
    if (provider === 'claude' && project) {
      const filePath = join(CLAUDE_SESSIONS_DIR, project, 'sessions', `${id}.jsonl`);
      if (existsSync(filePath)) {
        await unlink(filePath);
        return res.json({ success: true });
      }
    }
    res.status(404).json({ error: 'Session not found' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
```

- [ ] **Step 2: Register history route in index.js**

```js
import historyRouter from './routes/history.js';
app.use('/api/history', historyRouter);
```

- [ ] **Step 3: Commit**

```bash
git add ai-bridge/server/routes/history.js ai-bridge/server/index.js
git commit -m "feat: add history REST API routes"
```

---

## Task 8: WebSocket Chat Handler

**Files:**
- Modify: `ai-bridge/server/ws.js`

This is the core task: wire WebSocket messages through to the existing ai-bridge daemon (which manages Claude/Codex SDK sessions via persistent-query-service).

- [ ] **Step 1: Replace ai-bridge/server/ws.js with full implementation**

```js
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Active daemon process (shared across connections for now)
let daemonProcess = null;
let daemonReady = false;
let pendingRequests = new Map(); // id -> { resolve, reject, ws }
let requestIdCounter = 0;

function startDaemon() {
  if (daemonProcess) return;

  const daemonPath = join(__dirname, '..', 'daemon.js');
  daemonProcess = spawn(process.execPath, [daemonPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  let buffer = '';
  daemonProcess.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep incomplete line

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);

        // Daemon lifecycle events
        if (msg.type === 'daemon') {
          if (msg.event === 'ready') {
            daemonReady = true;
            console.log('[ws] Daemon ready, SDK preloaded:', msg.sdkPreloaded);
          }
          continue;
        }

        // Route response to waiting client
        if (msg.id && pendingRequests.has(msg.id)) {
          const { ws, resolve } = pendingRequests.get(msg.id);

          // Stream lines to the WebSocket client
          if (msg.line) {
            ws.send(JSON.stringify({ type: 'stream_line', id: msg.id, line: msg.line }));
          }

          // Command complete
          if (msg.done) {
            ws.send(JSON.stringify({
              type: msg.success ? 'stream_end' : 'stream_error',
              id: msg.id,
              error: msg.error,
            }));
            resolve(msg);
            pendingRequests.delete(msg.id);
          }
        }
      } catch (e) {
        console.error('[ws] Failed to parse daemon output:', line.substring(0, 200));
      }
    }
  });

  daemonProcess.stderr.on('data', (chunk) => {
    console.error('[daemon stderr]', chunk.toString('utf8').trim());
  });

  daemonProcess.on('exit', (code) => {
    console.log('[ws] Daemon exited with code:', code);
    daemonProcess = null;
    daemonReady = false;
  });
}

function sendToDaemon(request) {
  return new Promise((resolve, reject) => {
    if (!daemonProcess || !daemonReady) {
      reject(new Error('Daemon not ready'));
      return;
    }
    const id = String(++requestIdCounter);
    request.id = id;
    daemonProcess.stdin.write(JSON.stringify(request) + '\n');
    // resolve/reject handled in stdout handler
    // We don't set timeout here — the caller (ws handler) manages lifecycle
    pendingRequests.set(id, { resolve, reject, ws: null });
  });
}

export function createWsHandler(wss) {
  // Start daemon on first WS handler creation
  startDaemon();

  return {
    handleConnection(ws, request) {
      console.log('[ws] Client connected from:', request.socket.remoteAddress);
      const clientId = randomUUID();

      // Send connection confirmation
      ws.send(JSON.stringify({
        type: 'connected',
        clientId,
        daemonReady,
      }));

      ws.on('message', async (data) => {
        let msg;
        try {
          msg = JSON.parse(data.toString());
        } catch {
          ws.send(JSON.stringify({ type: 'error', error: 'Invalid JSON' }));
          return;
        }

        try {
          switch (msg.type) {
            case 'send_message': {
              const { content, provider = 'claude', sessionId, model, permissionMode, cwd, attachments } = msg;
              const method = attachments
                ? `${provider}.sendWithAttachments`
                : `${provider}.send`;

              const daemonRequest = {
                method,
                params: {
                  prompt: content,
                  sessionId: sessionId || '',
                  model: model || '',
                  permissionMode: permissionMode || 'default',
                  cwd: cwd || process.cwd(),
                  ...(attachments ? { attachments } : {}),
                },
              };

              const id = String(++requestIdCounter);
              daemonRequest.id = id;
              pendingRequests.set(id, { resolve: () => {}, reject: () => {}, ws });

              if (daemonProcess && daemonReady) {
                daemonProcess.stdin.write(JSON.stringify(daemonRequest) + '\n');
              } else {
                ws.send(JSON.stringify({ type: 'stream_error', id, error: 'Daemon not ready' }));
                pendingRequests.delete(id);
              }
              break;
            }

            case 'interrupt': {
              if (daemonProcess && daemonReady) {
                daemonProcess.stdin.write(JSON.stringify({ id: String(++requestIdCounter), method: 'abort' }) + '\n');
              }
              ws.send(JSON.stringify({ type: 'interrupted' }));
              break;
            }

            case 'heartbeat': {
              ws.send(JSON.stringify({ type: 'heartbeat_ack', timestamp: Date.now() }));
              break;
            }

            case 'permission_decision':
            case 'ask_user_question_response':
            case 'plan_approval_response': {
              // Forward permission/decision responses to daemon via stdin
              if (daemonProcess && daemonReady) {
                const id = String(++requestIdCounter);
                const daemonMsg = { id, method: `${msg.type}`, params: msg };
                daemonProcess.stdin.write(JSON.stringify(daemonMsg) + '\n');
              }
              break;
            }

            default:
              ws.send(JSON.stringify({ type: 'error', error: `Unknown message type: ${msg.type}` }));
          }
        } catch (e) {
          ws.send(JSON.stringify({ type: 'error', error: e.message }));
        }
      });

      ws.on('close', () => {
        console.log('[ws] Client disconnected:', clientId);
        // Clean up any pending requests for this client
        for (const [id, entry] of pendingRequests.entries()) {
          if (entry.ws === ws) {
            pendingRequests.delete(id);
          }
        }
      });

      ws.on('error', (err) => {
        console.error('[ws] WebSocket error:', err.message);
      });
    },
  };
}
```

- [ ] **Step 2: Test WebSocket connection**

Run: `cd E:/GitStore/jetbrains-cc-gui/ai-bridge && node server/index.js`
In another terminal, use `wscat -c ws://localhost:3001/api/chat` and send `{"type":"heartbeat"}`
Expected: `{"type":"heartbeat_ack","timestamp":...}`

- [ ] **Step 3: Commit**

```bash
git add ai-bridge/server/ws.js
git commit -m "feat: implement WebSocket chat handler with daemon bridge"
```

---

## Task 9: Webview WebSocket Client

**Files:**
- Create: `webview/src/utils/ws-client.ts`

- [ ] **Step 1: Create webview/src/utils/ws-client.ts**

```typescript
type MessageHandler = (data: any) => void;

class WsClient {
  private ws: WebSocket | null = null;
  private url: string;
  private handlers: Map<string, Set<MessageHandler>> = new Map();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;

  constructor(url: string) {
    this.url = url;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
          console.log('[ws-client] Connected to', this.url);
          this.reconnectAttempts = 0;
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data as string);
            const type = data.type;
            // Dispatch to type-specific handlers
            const handlers = this.handlers.get(type);
            if (handlers) {
              handlers.forEach(handler => handler(data));
            }
            // Also dispatch to '*' (wildcard) handlers
            const wildcardHandlers = this.handlers.get('*');
            if (wildcardHandlers) {
              wildcardHandlers.forEach(handler => handler(data));
            }
          } catch (e) {
            console.error('[ws-client] Failed to parse message:', e);
          }
        };

        this.ws.onclose = () => {
          console.log('[ws-client] Disconnected');
          this.scheduleReconnect();
        };

        this.ws.onerror = (err) => {
          console.error('[ws-client] Error:', err);
          reject(new Error('WebSocket connection failed'));
        };
      } catch (e) {
        reject(e);
      }
    });
  }

  private scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[ws-client] Max reconnect attempts reached');
      return;
    }
    const delay = this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts);
    this.reconnectAttempts++;
    console.log(`[ws-client] Reconnecting in ${Math.round(delay)}ms (attempt ${this.reconnectAttempts})`);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  send(data: any) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    } else {
      console.warn('[ws-client] Cannot send, WebSocket not open');
    }
  }

  on(type: string, handler: MessageHandler) {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);
  }

  off(type: string, handler: MessageHandler) {
    this.handlers.get(type)?.delete(handler);
  }

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }
}

// Singleton instance
const wsUrl = import.meta.env.VITE_WS_URL || `ws://${window.location.hostname}:3001/api/chat`;
export const wsClient = new WsClient(wsUrl);
export default wsClient;
```

- [ ] **Step 2: Commit**

```bash
git add webview/src/utils/ws-client.ts
git commit -m "feat: add WebSocket client for webview"
```

---

## Task 10: Webview HTTP Bridge Adapter

**Files:**
- Create: `webview/src/utils/bridge-http.ts`
- Modify: `webview/src/utils/bridge.ts`

This is the critical adapter. It replaces the JCEF `window.sendToJava` bridge with HTTP fetch + WebSocket, keeping the same `sendBridgeEvent` API so the rest of the webview code doesn't need to change.

- [ ] **Step 1: Create webview/src/utils/bridge-http.ts**

```typescript
import wsClient from './ws-client';

const API_BASE = import.meta.env.VITE_API_BASE_URL || `http://${window.location.hostname}:3001`;

/** Detect if running in web mode (not JCEF) */
export const isWebMode = (): boolean => {
  return !window.sendToJava;
};

/** HTTP bridge: send event to server via REST or WebSocket */
export const sendBridgeEventHttp = async (event: string, content: string = ''): Promise<boolean> => {
  try {
    // Route different events to REST or WebSocket
    switch (event) {
      // --- WebSocket events (real-time) ---
      case 'send_message':
      case 'send_message_with_attachments':
      case 'interrupt_session':
      case 'permission_decision':
      case 'ask_user_question_response':
      case 'plan_approval_response':
      case 'heartbeat': {
        let parsed = {};
        try { parsed = content ? JSON.parse(content) : {}; } catch { parsed = { text: content }; }
        wsClient.send({ type: event.replace('_session', '').replace('send_message_with_attachments', 'send_message'), ...parsed });
        return true;
      }

      // --- Session management ---
      case 'create_new_session': {
        const res = await fetch(`${API_BASE}/api/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
        const session = await res.json();
        window.setSessionId?.(session.id);
        return true;
      }

      case 'load_session': {
        // Triggered by history loading — handled via WebSocket in future
        return true;
      }

      // --- Settings via REST ---
      case 'get_active_provider': {
        const res = await fetch(`${API_BASE}/api/settings/active-provider`);
        const data = await res.json();
        window.updateActiveProvider?.(data.provider);
        return true;
      }

      case 'get_mode': {
        const res = await fetch(`${API_BASE}/api/settings/mode`);
        const data = await res.json();
        window.onModeReceived?.(data.mode);
        return true;
      }

      case 'set_mode': {
        await fetch(`${API_BASE}/api/settings/mode`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: content }) });
        return true;
      }

      case 'set_model': {
        await fetch(`${API_BASE}/api/settings/model`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: content }) });
        return true;
      }

      case 'set_provider': {
        await fetch(`${API_BASE}/api/settings/switch-provider`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: content === 'codex' ? 'codex' : 'claude', providerId: content }) });
        return true;
      }

      case 'get_thinking_enabled': {
        const res = await fetch(`${API_BASE}/api/settings/streaming`);
        const data = await res.json();
        window.updateThinkingEnabled?.(JSON.stringify({ enabled: data.enabled }));
        return true;
      }

      case 'set_thinking_enabled': {
        const { enabled } = JSON.parse(content);
        await fetch(`${API_BASE}/api/settings/streaming`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) });
        return true;
      }

      case 'set_streaming_enabled': {
        const { enabled } = JSON.parse(content);
        await fetch(`${API_BASE}/api/settings/streaming`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) });
        return true;
      }

      case 'set_send_shortcut': {
        const { shortcut } = JSON.parse(content);
        await fetch(`${API_BASE}/api/settings/send-shortcut`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shortcut }) });
        return true;
      }

      case 'set_auto_open_file_enabled': {
        const { enabled } = JSON.parse(content);
        await fetch(`${API_BASE}/api/settings/auto-open-file`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) });
        return true;
      }

      case 'update_provider': {
        const provider = JSON.parse(content);
        await fetch(`${API_BASE}/api/settings/provider`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(provider) });
        return true;
      }

      // --- History ---
      case 'load_history_data': {
        const res = await fetch(`${API_BASE}/api/history?provider=${encodeURIComponent(content)}`);
        const data = await res.json();
        window.setHistoryData?.(data);
        return true;
      }

      case 'delete_session': {
        await fetch(`${API_BASE}/api/history/${encodeURIComponent(content)}?provider=claude`, { method: 'DELETE' });
        return true;
      }

      case 'export_session': {
        // Export handled client-side in web mode
        return true;
      }

      case 'toggle_favorite':
      case 'update_title':
      case 'deep_search_history': {
        // TODO: Implement favorites/titles in config store
        return true;
      }

      // --- Agent/Prompt/Skill/MCP ---
      case 'get_selected_agent':
      case 'set_selected_agent': {
        // Agent management via future API
        return true;
      }

      case 'set_reasoning_effort': {
        await fetch(`${API_BASE}/api/settings/reasoning-effort`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ effort: content }) });
        return true;
      }

      // --- Tab/window ---
      case 'create_new_tab':
      case 'frontend_ready':
      case 'refresh_slash_commands':
      case 'get_dependency_status':
      case 'tab_loading_changed':
      case 'tab_status_changed':
      case 'write_clipboard':
        // No-op or handled differently in web mode
        return true;

      // --- File operations (no-op in web mode) ---
      case 'open_file':
      case 'open_browser':
      case 'refresh_file':
      case 'show_diff':
      case 'show_editable_diff':
      case 'show_edit_preview_diff':
      case 'show_edit_full_diff':
      case 'show_interactive_diff':
      case 'undo_file_changes':
      case 'rewind_files':
        // File/diff operations not available in pure web mode
        return true;

      default:
        console.warn('[bridge-http] Unhandled event:', event);
        return true;
    }
  } catch (e) {
    console.error('[bridge-http] Error sending event:', event, e);
    return false;
  }
};

/** Initialize web mode: connect WebSocket, register message handlers */
export const initWebBridge = async () => {
  try {
    await wsClient.connect();
  } catch (e) {
    console.error('[bridge-http] Failed to connect WebSocket:', e);
  }

  // Route WebSocket messages to window callbacks (same as JCEF callbacks)
  wsClient.on('stream_line', (data) => {
    const { line } = data;
    if (!line) return;

    // Parse the line tag to determine which callback to invoke
    if (line.startsWith('[STREAM_START]')) {
      window.onStreamStart?.();
    } else if (line.startsWith('[CONTENT_DELTA]')) {
      const delta = line.substring('[CONTENT_DELTA] '.length).trim();
      try {
        const parsed = JSON.parse(delta);
        window.onContentDelta?.(parsed.text || delta);
      } catch {
        window.onContentDelta?.(delta);
      }
    } else if (line.startsWith('[THINKING_DELTA]')) {
      const delta = line.substring('[THINKING_DELTA] '.length).trim();
      try {
        const parsed = JSON.parse(delta);
        window.onThinkingDelta?.(parsed.text || delta);
      } catch {
        window.onThinkingDelta?.(delta);
      }
    } else if (line.startsWith('[STREAM_END]')) {
      window.onStreamEnd?.();
    } else if (line.startsWith('[MESSAGE]')) {
      const json = line.substring('[MESSAGE] '.length).trim();
      window.updateMessages?.(json);
    } else if (line.startsWith('[STATUS]')) {
      const text = line.substring('[STATUS] '.length).trim();
      window.updateStatus?.(text);
    } else if (line.startsWith('[PERMISSION_REQUEST]')) {
      const json = line.substring('[PERMISSION_REQUEST] '.length).trim();
      window.showPermissionDialog?.(json);
    } else if (line.startsWith('[ASK_USER_QUESTION]')) {
      const json = line.substring('[ASK_USER_QUESTION] '.length).trim();
      window.showAskUserQuestionDialog?.(json);
    } else if (line.startsWith('[PLAN_APPROVAL]')) {
      const json = line.substring('[PLAN_APPROVAL] '.length).trim();
      window.showPlanApprovalDialog?.(json);
    } else if (line.startsWith('[USAGE]')) {
      const json = line.substring('[USAGE] '.length).trim();
      window.updateUsageStatistics?.(json);
    } else if (line.startsWith('[SESSION_ID]')) {
      const id = line.substring('[SESSION_ID] '.length).trim();
      window.setSessionId?.(id);
    } else if (line.startsWith('[MODE]')) {
      const mode = line.substring('[MODE] '.length).trim();
      window.onModeChanged?.(mode);
    } else if (line.startsWith('[MODEL]')) {
      const model = line.substring('[MODEL] '.length).trim();
      window.onModelChanged?.(model);
    } else if (line.startsWith('[ADD_MESSAGE]')) {
      const json = line.substring('[ADD_MESSAGE] '.length).trim();
      window.addHistoryMessage?.(JSON.parse(json));
    }
  });

  wsClient.on('stream_end', () => {
    window.onStreamEnd?.();
  });

  wsClient.on('stream_error', (data) => {
    window.addErrorMessage?.(data.error || 'Stream error');
    window.onStreamEnd?.();
  });

  wsClient.on('connected', () => {
    console.log('[bridge-http] WebSocket connected');
  });

  wsClient.on('heartbeat_ack', () => {
    // Heartbeat acknowledged
  });

  // Start heartbeat
  setInterval(() => {
    if (wsClient.connected) {
      wsClient.send({ type: 'heartbeat' });
    }
  }, 30000);
};
```

- [ ] **Step 2: Modify webview/src/utils/bridge.ts to delegate to bridge-http in web mode**

Replace the entire content of `bridge.ts` with:

```typescript
import { isWebMode, sendBridgeEventHttp, initWebBridge } from './bridge-http';

const BRIDGE_UNAVAILABLE_WARNED = new Set<string>();

const PATH_TRAVERSAL_REGEX = /(^|[\\/])\.\.($|[\\/])/;

const isValidPath = (filePath: string): boolean => {
  if (!filePath) return false;
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(filePath);
  } catch {
    return false;
  }
  return !PATH_TRAVERSAL_REGEX.test(filePath) && !PATH_TRAVERSAL_REGEX.test(decodedPath);
};

const callBridgeJcef = (payload: string) => {
  if (window.sendToJava) {
    window.sendToJava(payload);
    return true;
  }
  BRIDGE_UNAVAILABLE_WARNED.add(payload);
  return false;
};

export const sendBridgeEvent = (event: string, content = '') => {
  if (isWebMode()) {
    sendBridgeEventHttp(event, content);
    return true;
  }
  return callBridgeJcef(`${event}:${content}`);
};

export const openFile = (filePath?: string, lineStart?: number, lineEnd?: number) => {
  if (!filePath || !isValidPath(filePath)) return;
  let path = filePath;
  if (lineStart !== undefined && Number.isFinite(lineStart) && lineStart > 0) {
    path = (lineEnd !== undefined && Number.isFinite(lineEnd) && lineEnd > 0)
      ? `${filePath}:${lineStart}-${lineEnd}`
      : `${filePath}:${lineStart}`;
  }
  sendBridgeEvent('open_file', path);
};

export const openBrowser = (url?: string) => {
  if (!url) return;
  sendBridgeEvent('open_browser', url);
};

export const sendToJava = (message: string, payload: any = {}) => {
  const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
  sendBridgeEvent(message, payloadStr);
};

export const refreshFile = (filePath: string) => {
  if (!filePath) return;
  sendToJava('refresh_file', { filePath });
};

export const showDiff = (filePath: string, oldContent: string, newContent: string, title?: string) => {
  sendToJava('show_diff', { filePath, oldContent, newContent, title });
};

export const showMultiEditDiff = (
  filePath: string,
  edits: Array<{ oldString: string; newString: string; replaceAll?: boolean }>,
  currentContent?: string
) => {
  sendToJava('show_multi_edit_diff', { filePath, edits, currentContent });
};

export const showEditableDiff = (
  filePath: string,
  operations: Array<{ oldString: string; newString: string; replaceAll?: boolean }>,
  status: 'A' | 'M'
) => {
  if (!isValidPath(filePath)) return;
  sendToJava('show_editable_diff', { filePath, operations, status });
};

export const showEditPreviewDiff = (
  filePath: string,
  edits: Array<{ oldString: string; newString: string; replaceAll?: boolean }>,
  title?: string
) => {
  if (!isValidPath(filePath)) return;
  sendToJava('show_edit_preview_diff', { filePath, edits, title });
};

export const showEditFullDiff = (
  filePath: string,
  oldString: string,
  newString: string,
  originalContent?: string,
  replaceAll?: boolean,
  title?: string
) => {
  if (!isValidPath(filePath)) return;
  sendToJava('show_edit_full_diff', { filePath, oldString, newString, originalContent, replaceAll, title });
};

export const showInteractiveDiff = (
  filePath: string,
  newFileContents: string,
  tabName?: string,
  isNewFile?: boolean
) => {
  if (!isValidPath(filePath)) return;
  sendToJava('show_interactive_diff', { filePath, newFileContents, tabName, isNewFile: isNewFile ?? false });
};

export const rewindFiles = (sessionId: string, userMessageId: string) => {
  sendToJava('rewind_files', { sessionId, userMessageId });
};

export const undoFileChanges = (
  filePath: string,
  status: 'A' | 'M',
  operations: Array<{ oldString: string; newString: string; replaceAll?: boolean }>
) => {
  if (!isValidPath(filePath)) return;
  sendToJava('undo_file_changes', { filePath, status, operations });
};

// Re-export web bridge init for main.tsx
export { initWebBridge, isWebMode };
```

- [ ] **Step 3: Commit**

```bash
git add webview/src/utils/bridge-http.ts webview/src/utils/bridge.ts
git commit -m "feat: add HTTP/WS bridge adapter for web mode"
```

---

## Task 11: Webview Main Entry Adaptation

**Files:**
- Modify: `webview/src/main.tsx`

- [ ] **Step 1: Add web mode initialization in main.tsx**

Find the existing initialization code (near the `frontend_ready` event) and add web bridge init before it. Add this import at the top:

```typescript
import { initWebBridge, isWebMode } from './utils/bridge';
```

Then, before the existing `sendBridgeEvent('frontend_ready')` call, add:

```typescript
// Initialize web bridge if not running in JCEF
if (isWebMode()) {
  initWebBridge().then(() => {
    sendBridgeEvent('frontend_ready');
  });
} else {
  sendBridgeEvent('frontend_ready');
}
```

- [ ] **Step 2: Commit**

```bash
git add webview/src/main.tsx
git commit -m "feat: add web mode initialization in main entry"
```

---

## Task 12: Vite Config for Web Mode

**Files:**
- Modify: `webview/vite.config.ts`
- Modify: `webview/package.json`

- [ ] **Step 1: Update webview/vite.config.ts — add dev proxy, remove singlefile in dev**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    // Only use singleFile for build (IntelliJ plugin compatibility during transition)
    command === 'build' && viteSingleFile(),
  ].filter(Boolean),
  build: {
    minify: 'esbuild',
    esbuild: {
      drop: ['console', 'debugger'],
    },
    assetsInlineLimit: 1024 * 1024,
    cssCodeSplit: false,
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        ws: true,
      },
    },
  },
})));
```

- [ ] **Step 2: Update webview/package.json — add env vars for dev mode**

Add to `scripts.dev`:
```json
"dev": "VITE_API_BASE_URL=http://localhost:3001 VITE_WS_URL=ws://localhost:3001/api/chat vite",
```

- [ ] **Step 3: Commit**

```bash
git add webview/vite.config.ts webview/package.json
git commit -m "feat: add Vite dev proxy and web mode config"
```

---

## Task 13: Additional API Routes (Agents, Prompts, Skills, MCP, Dependencies)

**Files:**
- Create: `ai-bridge/server/routes/agents.js`
- Create: `ai-bridge/server/routes/prompts.js`
- Create: `ai-bridge/server/routes/skills.js`
- Create: `ai-bridge/server/routes/mcp.js`
- Create: `ai-bridge/server/routes/dependencies.js`
- Modify: `ai-bridge/server/index.js`

- [ ] **Step 1: Create ai-bridge/server/routes/agents.js**

```js
import { Router } from 'express';
import { readFile, writeFile, mkdirSync, existsSync } from 'fs';
import { join, homedir } from 'path';

const router = Router();
const AGENTS_FILE = join(homedir(), '.cc-gui', 'agent.json');

function loadAgents() {
  try {
    if (existsSync(AGENTS_FILE)) return JSON.parse(readFile(AGENTS_FILE, 'utf8'));
  } catch {}
  return { agents: [] };
}

function saveAgents(data) {
  const dir = join(homedir(), '.cc-gui');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFile(AGENTS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

router.get('/', (_req, res) => res.json(loadAgents()));
router.put('/', (req, res) => { saveAgents(req.body); res.json(req.body); });

export default router;
```

- [ ] **Step 2: Create ai-bridge/server/routes/prompts.js**

```js
import { Router } from 'express';
import { readFile, writeFile, mkdirSync, existsSync } from 'fs';
import { join, homedir } from 'path';

const router = Router();
const PROMPTS_FILE = join(homedir(), '.cc-gui', 'prompt.json');

function loadPrompts() {
  try {
    if (existsSync(PROMPTS_FILE)) return JSON.parse(readFile(PROMPTS_FILE, 'utf8'));
  } catch {}
  return { prompts: [], globalPrompts: [], projectPrompts: [] };
}

function savePrompts(data) {
  const dir = join(homedir(), '.cc-gui');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFile(PROMPTS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

router.get('/', (_req, res) => res.json(loadPrompts()));
router.put('/', (req, res) => { savePrompts(req.body); res.json(req.body); });

export default router;
```

- [ ] **Step 3: Create ai-bridge/server/routes/skills.js**

```js
import { Router } from 'express';
import { readFile, writeFile, mkdirSync, existsSync } from 'fs';
import { join, homedir } from 'path';

const router = Router();
const SKILLS_FILE = join(homedir(), '.cc-gui', 'skills.json');

function loadSkills() {
  try {
    if (existsSync(SKILLS_FILE)) return JSON.parse(readFile(SKILLS_FILE, 'utf8'));
  } catch {}
  return { skills: [] };
}

function saveSkills(data) {
  const dir = join(homedir(), '.cc-gui');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFile(SKILLS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

router.get('/', (_req, res) => res.json(loadSkills()));
router.put('/', (req, res) => { saveSkills(req.body); res.json(req.body); });

export default router;
```

- [ ] **Step 4: Create ai-bridge/server/routes/mcp.js**

```js
import { Router } from 'express';

const router = Router();

// MCP status — delegates to ai-bridge's existing mcp-status service
router.get('/status', async (_req, res) => {
  // TODO: Wire to ai-bridge/services/claude/mcp-status
  res.json({ servers: [] });
});

router.get('/tools', async (_req, res) => {
  res.json({ tools: [] });
});

export default router;
```

- [ ] **Step 5: Create ai-bridge/server/routes/dependencies.js**

```js
import { Router } from 'express';
import { getSdkStatus } from '../../utils/sdk-loader.js';

const router = Router();

router.get('/status', (_req, res) => {
  res.json(getSdkStatus());
});

export default router;
```

- [ ] **Step 6: Register all routes in ai-bridge/server/index.js**

Add imports and route registrations after existing routes:
```js
import agentsRouter from './routes/agents.js';
import promptsRouter from './routes/prompts.js';
import skillsRouter from './routes/skills.js';
import mcpRouter from './routes/mcp.js';
import dependenciesRouter from './routes/dependencies.js';

app.use('/api/agents', agentsRouter);
app.use('/api/prompts', promptsRouter);
app.use('/api/skills', skillsRouter);
app.use('/api/mcp', mcpRouter);
app.use('/api/dependencies', dependenciesRouter);
```

- [ ] **Step 7: Commit**

```bash
git add ai-bridge/server/routes/ ai-bridge/server/index.js
git commit -m "feat: add agents, prompts, skills, MCP, and dependencies API routes"
```

---

## Task 14: Delete Java/IntelliJ Code

**Files:**
- Delete: `src/`, `test/`, `build.gradle`, `settings.gradle`, `gradle.properties`, `gradlew`, `gradlew.bat`, `gradle/`, `checkstyle.xml`, `sandbox-idea.properties`, `local.properties.example`, `build/`

- [ ] **Step 1: Delete all Java source code and Gradle build files**

```bash
cd E:/GitStore/jetbrains-cc-gui
rm -rf src/ test/ build/ gradle/ .gradle/
rm -f build.gradle settings.gradle gradle.properties gradlew gradlew.bat
rm -f checkstyle.xml sandbox-idea.properties local.properties.example
```

- [ ] **Step 2: Update .gitignore — remove IntelliJ-specific entries, add Node.js entries**

Read the existing `.gitignore` and update it to remove Gradle/IntelliJ entries and ensure Node.js entries are present.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: remove Java/IntelliJ plugin code and Gradle build system"
```

---

## Task 15: Update Documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README.md to reflect web app project**

Replace IntelliJ plugin instructions with:
- Project description: standalone web app for Claude Code / Codex
- Prerequisites: Node.js 18+
- Quick start: `npm install && npm run dev`
- Architecture: webview (React) + ai-bridge (Express + Claude/Codex SDK)
- Configuration: `~/.cc-gui/settings.json`

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: update README for web app project"
```

---

## Task 16: End-to-End Smoke Test

**Files:**
- No new files

- [ ] **Step 1: Install all dependencies**

```bash
cd E:/GitStore/jetbrains-cc-gui && npm install
```

- [ ] **Step 2: Start the web app**

```bash
npm run dev
```

Expected: Both ai-bridge server (port 3001) and Vite dev server (port 5173) start.

- [ ] **Step 3: Open browser and verify**

Open `http://localhost:5173` in a browser.
Expected: React app loads, shows chat UI, no console errors about missing bridge.

- [ ] **Step 4: Verify API health check**

```bash
curl http://localhost:3001/api/health
```
Expected: `{"status":"ok","timestamp":...}`

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix: address smoke test issues"
```
