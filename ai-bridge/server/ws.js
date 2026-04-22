import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Active daemon process (shared across all WebSocket connections)
let daemonProcess = null;
let daemonReady = false;
let pendingRequests = new Map(); // id -> { resolve, reject, ws }
let requestIdCounter = 0;

function startDaemon() {
  if (daemonProcess) return;

  const daemonPath = join(__dirname, '..', 'daemon.js');
  console.log('[ws] Starting daemon:', daemonPath);

  daemonProcess = spawn(process.execPath, [daemonPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  let buffer = '';
  daemonProcess.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);

        // Daemon lifecycle events
        if (msg.type === 'daemon') {
          if (msg.event === 'ready') {
            daemonReady = true;
            console.log('[ws] Daemon ready, SDK preloaded:', msg.sdkPreloaded);
          } else if (msg.event === 'sdk_loading') {
            console.log('[ws] SDK loading:', msg.provider);
          } else if (msg.event === 'sdk_loaded') {
            console.log('[ws] SDK loaded:', msg.provider);
          }
          continue;
        }

        // Route response to waiting client
        if (msg.id && pendingRequests.has(msg.id)) {
          const { ws, resolve } = pendingRequests.get(msg.id);

          // Stream lines to the WebSocket client
          if (msg.line) {
            if (ws.readyState === 1) { // WebSocket.OPEN
              ws.send(JSON.stringify({ type: 'stream_line', id: msg.id, line: msg.line }));
            }
          }

          // Command complete
          if (msg.done) {
            if (ws.readyState === 1) {
              ws.send(JSON.stringify({
                type: msg.success ? 'stream_end' : 'stream_error',
                id: msg.id,
                error: msg.error,
              }));
            }
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
    const text = chunk.toString('utf8').trim();
    if (text) console.error('[daemon stderr]', text);
  });

  daemonProcess.on('exit', (code) => {
    console.log('[ws] Daemon exited with code:', code);
    daemonProcess = null;
    daemonReady = false;
    // Reject all pending requests
    for (const [id, { reject }] of pendingRequests.entries()) {
      reject(new Error('Daemon exited'));
    }
    pendingRequests.clear();
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
                const daemonMsg = { id, method: msg.type, params: msg };
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
