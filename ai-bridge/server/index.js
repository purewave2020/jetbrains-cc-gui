import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { corsMiddleware } from './middleware/cors.js';
import { createWsHandler } from './ws.js';
import settingsRouter from './routes/settings.js';
import sessionsRouter from './routes/sessions.js';
import historyRouter from './routes/history.js';
import agentsRouter from './routes/agents.js';
import promptsRouter from './routes/prompts.js';
import skillsRouter from './routes/skills.js';
import mcpRouter from './routes/mcp.js';
import dependenciesRouter from './routes/dependencies.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3001', 10);

const app = express();
app.use(corsMiddleware);
app.use(express.json());

// API routes
app.use('/api/settings', settingsRouter);
app.use('/api/sessions', sessionsRouter);
app.use('/api/history', historyRouter);
app.use('/api/agents', agentsRouter);
app.use('/api/prompts', promptsRouter);
app.use('/api/skills', skillsRouter);
app.use('/api/mcp', mcpRouter);
app.use('/api/dependencies', dependenciesRouter);

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

const HOST = process.env.HOST || '0.0.0.0';

server.listen(PORT, HOST, () => {
  console.log(`[cc-gui] Server running at http://localhost:${PORT}`);
  console.log(`[cc-gui] WebSocket at ws://localhost:${PORT}/api/chat`);
});
