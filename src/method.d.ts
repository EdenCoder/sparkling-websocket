/**
 * sparkling-websocket — native WebSocket bridge for Sparkling.
 *
 * Source-of-truth method declarations. Re-run `pnpm --filter
 * @dollhousestudio/sparkling-websocket codegen` after editing to
 * regenerate the native IDL stubs (Kotlin is usable as-is; the Swift
 * stubs are templates — see ios/Source/... impls).
 */

export interface ConnectRequest {
  url: string;
  protocols?: string[];
}

export interface ConnectResponseData {
  socketId: string;
}

export interface ConnectResponse {
  /** 1 = opened, 0 = failed, negative = error. */
  code: number;
  msg: string;
  data?: ConnectResponseData;
}

declare function connect(
  params: ConnectRequest,
  callback: (result: ConnectResponse) => void,
): void;

export interface SendRequest {
  socketId: string;
  data: string;
}

export interface SendResponse {
  code: number;
  msg: string;
}

declare function send(
  params: SendRequest,
  callback: (result: SendResponse) => void,
): void;

export interface CloseRequest {
  socketId: string;
  code?: number;
  reason?: string;
}

export interface CloseResponse {
  code: number;
  msg: string;
}

declare function close(
  params: CloseRequest,
  callback: (result: CloseResponse) => void,
): void;
