/**
 * Standard `WebSocket` polyfill backed by the sparkling-websocket
 * native method. Install once on the background thread:
 *
 *   import { installWebSocket } from '@dollhousestudio/sparkling-websocket/polyfill'
 *   installWebSocket()
 *
 * After that, socket.io-client's websocket transport (and any library
 * reading `globalThis.WebSocket`) works unchanged on PrimJS.
 *
 * Native events fan out to instances by `socketId` through a single
 * global subscription (see ./event).
 */

import { close, connect, send } from './index';
import { onEvent, type SocketEvent } from './event';
import { base64ToBytes } from './base64';

export type ReadyState = 0 | 1 | 2 | 3;

export interface OpenEvent { type: 'open' }
export interface MessageEvent { type: 'message'; data: string | ArrayBuffer }
export interface CloseEvent { type: 'close'; code: number; reason: string; wasClean: boolean }
export interface ErrorEvent { type: 'error' }

type OpenHandler = (ev: OpenEvent) => void;
type MessageHandler = (ev: MessageEvent) => void;
type CloseHandler = (ev: CloseEvent) => void;
type ErrorHandler = (ev: ErrorEvent) => void;

const instances = new Map<string, WebSocketPolyfill>();
let unsubscribe: (() => void) | null = null;

function ensureGlobalSubscription(): void {
  if (unsubscribe) return;
  unsubscribe = onEvent((e) => {
    instances.get(e.socketId)?.__dispatch(e);
  });
}

/**
 * Minimal but complete `WebSocket` for engine.io-client's websocket
 * transport: assignment handlers + addEventListener, readyState,
 * send, close, binaryType.
 */
export class WebSocketPolyfill {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;

  readonly url: string;
  binaryType: 'blob' | 'arraybuffer' = 'arraybuffer';
  bufferedAmount = 0;
  extensions = '';
  protocol = '';

  onopen: OpenHandler | null = null;
  onmessage: MessageHandler | null = null;
  onclose: CloseHandler | null = null;
  onerror: ErrorHandler | null = null;

  private readonly openH = new Set<OpenHandler>();
  private readonly messageH = new Set<MessageHandler>();
  private readonly closeH = new Set<CloseHandler>();
  private readonly errorH = new Set<ErrorHandler>();
  private socketId: string | null = null;
  private state: ReadyState = 0;

  constructor(url: string, protocols?: string | string[]) {
    this.url = url
    ensureGlobalSubscription()
    const protoList = Array.isArray(protocols) ? protocols : protocols ? [protocols] : []
    connect({ url, protocols: protoList }, (res) => {
      // Native serialization may nest (data.socketId | data.data.socketId).
      const d = res.data as { socketId?: string; data?: { socketId?: string } } | undefined
      const socketId = d?.socketId ?? d?.data?.socketId
      if (res.code === 1 && socketId) {
        this.socketId = socketId;
        instances.set(this.socketId, this);
        // native emits 'open' next; readyState flips there
      } else {
        this.state = 3;
        this.fireError();
        this.fireClose(res.code ?? 1006, res.msg ?? 'connect failed', false);
      }
    });
  }

  get readyState(): ReadyState {
    return this.state;
  }

  send(data: string): void {
    if (this.state !== 1 || !this.socketId) {
      throw new Error('WebSocket is not in OPEN state');
    }
    send({ socketId: this.socketId, data }, () => {
      /* errors surface as 'error' events */
    });
  }

  close(code = 1000, reason?: string): void {
    if (this.state === 2 || this.state === 3) return;
    this.state = 2;
    if (this.socketId) {
      close({ socketId: this.socketId, code, reason }, () => {
        /* final 'close' arrives via the global subscription */
      });
    }
  }

  addEventListener(type: 'open', h: OpenHandler): void;
  addEventListener(type: 'message', h: MessageHandler): void;
  addEventListener(type: 'close', h: CloseHandler): void;
  addEventListener(type: 'error', h: ErrorHandler): void;
  addEventListener(type: 'open' | 'message' | 'close' | 'error', h: never): void {
    if (type === 'open') this.openH.add(h as OpenHandler);
    else if (type === 'message') this.messageH.add(h as MessageHandler);
    else if (type === 'close') this.closeH.add(h as CloseHandler);
    else this.errorH.add(h as ErrorHandler);
  }

  removeEventListener(type: 'open', h: OpenHandler): void;
  removeEventListener(type: 'message', h: MessageHandler): void;
  removeEventListener(type: 'close', h: CloseHandler): void;
  removeEventListener(type: 'error', h: ErrorHandler): void;
  removeEventListener(type: 'open' | 'message' | 'close' | 'error', h: never): void {
    if (type === 'open') this.openH.delete(h as OpenHandler);
    else if (type === 'message') this.messageH.delete(h as MessageHandler);
    else if (type === 'close') this.closeH.delete(h as CloseHandler);
    else this.errorH.delete(h as ErrorHandler);
  }

  /** @internal — called by the global event subscription. */
  __dispatch(e: SocketEvent): void {
    if (e.socketId !== this.socketId) return;
    if (e.event === 'open') {
      this.state = 1;
      this.onopen?.({ type: 'open' });
      this.openH.forEach((h) => h({ type: 'open' }));
    } else if (e.event === 'message') {
      // Binary frames (gzip RPC responses) arrive as base64; decode to
      // ArrayBuffer so engine.io (binaryType 'arraybuffer') + pako.ungzip work.
      const data: string | ArrayBuffer = e.binary
        ? (base64ToBytes(e.data ?? '').buffer as ArrayBuffer)
        : (e.data ?? '');
      const ev = { type: 'message' as const, data };
      this.onmessage?.(ev);
      this.messageH.forEach((h) => h(ev));
    } else if (e.event === 'close') {
      this.state = 3;
      instances.delete(e.socketId);
      this.fireClose(e.code ?? 1000, e.reason ?? '', true);
    } else if (e.event === 'error') {
      this.fireError();
    }
  }

  private fireError(): void {
    this.onerror?.({ type: 'error' });
    this.errorH.forEach((h) => h({ type: 'error' }));
  }

  private fireClose(code: number, reason: string, wasClean: boolean): void {
    const ev = { type: 'close' as const, code, reason, wasClean };
    this.onclose?.(ev);
    this.closeH.forEach((h) => h(ev));
  }
}

/** Register the polyfill as the global `WebSocket`. Idempotent. */
export function installWebSocket(): void {
  const g = globalThis as { WebSocket?: unknown };
  if (g.WebSocket) return;
  g.WebSocket = WebSocketPolyfill;
}
