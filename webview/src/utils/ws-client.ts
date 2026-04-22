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
            const handlers = this.handlers.get(type);
            if (handlers) {
              handlers.forEach(handler => handler(data));
            }
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
    this.reconnectTimer = setTimeout(() => {
      this.connect().catch(() => {});
    }, delay);
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

const wsUrl = import.meta.env.VITE_WS_URL || (import.meta.env.DEV
  ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/api/chat`
  : `ws://${window.location.hostname}:3001/api/chat`
);
export const wsClient = new WsClient(wsUrl);
export default wsClient;
