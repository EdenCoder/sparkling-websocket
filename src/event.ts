/**
 * Native → JS event stream.
 *
 * Native emits `Websocket.event` through Lynx's GlobalEventEmitter for
 * every socket lifecycle event; JS subscribes via `pipe.on`. Payload:
 *
 *   { socketId, event: 'open'|'message'|'close'|'error',
 *     data?: string, code?: number, reason?: string }
 */

import pipe from 'sparkling-method';

export interface SocketEvent {
  socketId: string
  event: 'open' | 'message' | 'close' | 'error'
  data?: string
  /** `true` when `data` is base64-encoded binary (gzip RPC responses). */
  binary?: boolean
  code?: number
  reason?: string
}

export type SocketEventHandler = (event: SocketEvent) => void;

/** Subscribe to all Websocket events. Returns an unsubscribe fn. */
export function onEvent(handler: SocketEventHandler): () => void {
  const listener = (raw: unknown) => handler(unwrap(raw))
  pipe.on('Websocket.event', listener)
  return () => pipe.off('Websocket.event', listener)
}

function unwrap(raw: unknown): SocketEvent {
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>
    if (typeof r.socketId === 'string') return r as unknown as SocketEvent
    const d = r.data as Record<string, unknown> | undefined
    if (d && typeof d.socketId === 'string') return d as unknown as SocketEvent
    if (Array.isArray(r)) return unwrap(r[0])
  }
  return raw as SocketEvent
}
