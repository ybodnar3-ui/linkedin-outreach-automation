export interface WsEvent {
  event: string;
  data: unknown;
  ts: number;
}

type WsListener = (evt: WsEvent) => void;

class WsClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<WsListener>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  connect() {
    try {
      // In dev the frontend runs on :5173 but WS is on :3001
      // In production everything is on the same host/port (Railway)
      const isDev = window.location.hostname === 'localhost';
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = isDev ? 'localhost:3001' : window.location.host;
      // Authenticate the WS with the same JWT used for the REST API
      const token = localStorage.getItem('auth_token') || '';
      const url = `${protocol}//${host}/?token=${encodeURIComponent(token)}`;

      this.ws = new WebSocket(url);

      this.ws.onmessage = (e) => {
        try {
          const evt: WsEvent = JSON.parse(e.data as string);
          this.listeners.forEach(fn => fn(evt));
        } catch { /* ignore malformed messages */ }
      };

      this.ws.onclose = () => {
        // Reconnect after 5 seconds
        this.reconnectTimer = setTimeout(() => this.connect(), 5000);
      };

      this.ws.onerror = () => {
        this.ws?.close();
      };
    } catch (err) {
      // If WebSocket construction fails (e.g. security error), retry later
      console.warn('WebSocket connection failed:', err);
      this.reconnectTimer = setTimeout(() => this.connect(), 10000);
    }
  }

  subscribe(fn: WsListener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }
}

export const wsClient = new WsClient();
