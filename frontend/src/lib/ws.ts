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
    const url = `ws://${window.location.hostname}:3001`;
    this.ws = new WebSocket(url);

    this.ws.onmessage = (e) => {
      try {
        const evt: WsEvent = JSON.parse(e.data as string);
        this.listeners.forEach(fn => fn(evt));
      } catch { /* ignore malformed messages */ }
    };

    this.ws.onclose = () => {
      this.reconnectTimer = setTimeout(() => this.connect(), 3000);
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
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
