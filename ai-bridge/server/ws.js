import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));

let daemonProcess = null;
let daemonReady = false;
let pendingRequests = new Map();
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
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);

        if (msg.type === 'daemon') {
          if (msg.event === 'ready') {
            daemonReady = true;
            console.log('[ws] Daemon ready, SDK preloaded:', msg.sdkPreloaded);
          }
          continue;
        }

        if (msg.id && pendingRequests.has(msg.id)) {
          const { ws, resolve } = pendingRequests.get(msg.id);

          if (msg.line) {
            console.log('[ws] Daemon line for id=', msg.id, 'line=', msg.line.substring(0, 80));
            ws.send(JSON.stringify({ type: 'stream_line', id: msg.id, line: msg.line }));
          }

          if (msg.done) {
            console.log('[ws] Daemon done for id=', msg.id, 'success=', msg.success, 'error=', msg.error);
            ws.send(JSON.stringify({
              type: msg.success ? 'stream_end' : 'stream_error',
              id: msg.id,
              error: msg.error,
            }));
            resolve(msg);
            pendingRequests.delete(msg.id);
          }
        } else if (msg.id) {
          console.log('[ws] Daemon response for unknown id=', msg.id, 'pendingIds=', [...pendingRequests.keys()].join(','));
        }
      } catch (e) {
        // Non-JSON lines (daemon debug logs) are safe to skip
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

export function createWsHandler(wss) {
  startDaemon();

  return {
    handleConnection(ws, request) {
      console.log('[ws] Client connected from:', request.socket.remoteAddress);
      const clientId = randomUUID();

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

        console.log('[ws] Received message type:', msg.type, 'keys:', Object.keys(msg).join(','));

        try {
          switch (msg.type) {
            case 'send_message': {
              // Frontend sends {text, agent: {id, name, prompt}, fileTags, permissionMode, cwd}
              // Daemon expects {message, agentPrompt, fileTags, permissionMode, cwd}
              const { text, agent, fileTags, permissionMode, cwd, streaming } = msg;
              console.log('[ws] send_message: text=', JSON.stringify(text)?.substring(0, 80), 'agent=', !!agent, 'fileTags=', !!fileTags, 'permissionMode=', permissionMode, 'cwd=', cwd, 'streaming=', streaming);
              const daemonRequest = {
                method: 'claude.send',
                params: {
                  message: text || '',
                  agentPrompt: agent?.prompt || null,
                  fileTags,
                  permissionMode: permissionMode || 'default',
                  streaming: streaming !== false,
                  ...(cwd ? { cwd } : {}),
                },
              };

              const id = String(++requestIdCounter);
              daemonRequest.id = id;
              pendingRequests.set(id, { resolve: () => {}, reject: () => {}, ws });

              console.log('[ws] Forwarding to daemon, id=', id, 'daemonReady=', daemonReady, 'daemonProcess=', !!daemonProcess);
              if (daemonProcess && daemonReady) {
                const payload = JSON.stringify(daemonRequest) + '\n';
                console.log('[ws] Writing to daemon stdin, payload length=', payload.length);
                daemonProcess.stdin.write(payload);
              } else {
                console.error('[ws] Daemon not ready! daemonProcess=', !!daemonProcess, 'daemonReady=', daemonReady);
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