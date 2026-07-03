/**
 * JS↔native pipe wrappers for the Websocket method.
 *
 * Hand-authored (the codegen'd wrappers in v2.0.1 emit a bad
 * `import pipe from '<packageName>'` and a syntax error). Each method
 * is one request → one response; socket events stream out-of-band via
 * `pipe.on('Websocket.event', …)` (see ./event.ts).
 */

import pipe from 'sparkling-method';

import type {
  CloseRequest,
  CloseResponse,
  ConnectRequest,
  ConnectResponse,
  SendRequest,
  SendResponse,
} from './method.d';

export function connect(
  params: ConnectRequest,
  callback: (result: ConnectResponse) => void,
): void {
  if (typeof callback !== 'function') {
    console.error('[websocket] connect: callback must be a function');
    return;
  }
  if (!params?.url || typeof params.url !== 'string') {
    callback({ code: -1, msg: 'connect: url must be a non-empty string' });
    return;
  }
  pipe.call(
    'Websocket.connect',
    { url: params.url, protocols: params.protocols ?? [] },
    (raw: unknown) => {
      const r = raw as Partial<ConnectResponse> | undefined;
      callback({
        code: r?.code ?? -1,
        msg: r?.msg ?? '',
        data: r?.data,
      });
    },
  );
}

export function send(
  params: SendRequest,
  callback: (result: SendResponse) => void,
): void {
  if (typeof callback !== 'function') {
    console.error('[websocket] send: callback must be a function');
    return;
  }
  if (!params?.socketId || typeof params.data !== 'string') {
    callback({ code: -1, msg: 'send: socketId and data required' });
    return;
  }
  pipe.call(
    'Websocket.send',
    { socketId: params.socketId, data: params.data },
    (raw: unknown) => {
      const r = raw as Partial<SendResponse> | undefined;
      callback({ code: r?.code ?? -1, msg: r?.msg ?? '' });
    },
  );
}

export function close(
  params: CloseRequest,
  callback: (result: CloseResponse) => void,
): void {
  if (typeof callback !== 'function') {
    console.error('[websocket] close: callback must be a function');
    return;
  }
  if (!params?.socketId) {
    callback({ code: -1, msg: 'close: socketId required' });
    return;
  }
  pipe.call(
    'Websocket.close',
    { socketId: params.socketId, code: params.code, reason: params.reason },
    (raw: unknown) => {
      const r = raw as Partial<CloseResponse> | undefined;
      callback({ code: r?.code ?? -1, msg: r?.msg ?? '' });
    },
  );
}

export type {
  CloseRequest,
  CloseResponse,
  ConnectRequest,
  ConnectResponse,
  ConnectResponseData,
  SendRequest,
  SendResponse,
} from './method.d';

export { onEvent } from './event';
export type { SocketEvent, SocketEventHandler } from './event';
