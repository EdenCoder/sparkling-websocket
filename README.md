# @dollhousestudio/sparkling-websocket

Native WebSocket bridge for Sparkling / ReactLynx, so `socket.io-client`
(the Parcae `SocketTransport`) runs on Lynx PrimJS unchanged.

## How it fits

```
                       ┌─ pipe.call('Websocket.connect'/'send'/'close') ──┐
JS (PrimJS, bg thread) │                                                  ▼
  installWebSocket()   │   ┌─────────────── native ────────────────┐
   globalThis.WebSocket│   │  Android: OkHttp WebSocket             │
        ▲              │   │  iOS:     URLSessionWebSocketTask      │
        │              │   └───────────────┬───────────────────────┘
        └─ pipe.on('Websocket.event') ◀── emit bridge.ln(event, json)
```

- **JS side (verified):** `WebSocketPolyfill` implements the standard
  `WebSocket` interface, backed by the three native methods. Socket events
  stream back through Lynx's `GlobalEventEmitter` (`pipe.on`). The Parcae
  SDK client in `apps/mobile/src/lib/client.ts` calls `installWebSocket()`
  before `createClient({ transports: ['websocket'] })`. The build isolates
  socket.io into a background chunk — the main-thread Lepus compiler never
  sees socket.io's regexes.
- **Native side (UNVERIFIED — needs Mac/Android):** the codegen'd Kotlin
  IDL is valid; the codegen'd Swift IDL is empty in v2.0.1 and must be
  hand-written. See `android/.../WebsocketMethods.kt` and
  `ios/.../WebsocketCenter.swift`.

## Status — verified on the Android emulator

| Layer | Verified |
|---|---|
| JS pipe wrappers (`src/index.ts`, `src/event.ts`) | ✅ typecheck + build |
| `WebSocketPolyfill` (`src/polyfill.ts`) + base64 (`src/base64.ts`) | ✅ runtime |
| socket.io on the background thread, main bundle clean | ✅ `sparkling build` |
| Kotlin impl (OkHttp) connects to dev-api (`onOpen 101`) | ✅ emulator |
| Binary gzip RPC responses → `pako.ungzip` → `Project.find()` returns rows | ✅ emulator |
| Swift impl (iOS) | ❌ needs Xcode 16+ (codegen Swift stubs are empty; hand-written) |

Verified end-to-end: the Parcae `SocketTransport` connects to
`wss://dev-api.dollhouse.world/ws`, completes the socket.io handshake + `hello`,
and a `Project.find()` RPC returns rows through the gzip+compress-json binary path.

## Key native API (verified against sparkling-method 2.0.1)

- Override `handle(params, callback: CompletionBlock<OUTPUT>, type: BridgePlatformType)`.
- Return success with `callback.onSuccess(resultModel, msg)`. Result models are
  generated interfaces (`code`, `msg`, `data.socketId`); instantiate them as
  anonymous `object`s and implement `convert()` + `toJSON()`.
- Emit a JS event (received by `pipe.on`) via the **view** event bus:
  ```kotlin
  getSDKContext()?.bridge?.sendEvent("Websocket.event", jsonObject)
  ```
  (`sendJSRuntimeEvent` targets the background runtime, but `pipe.on` binds the
  view's `GlobalEventEmitter` in this setup — `sendEvent` is what delivers.)
- Binary frames: OkHttp's `onMessage(bytes: ByteString)` → `bytes.base64()` in
  the event JSON with `binary: true`; the JS polyfill decodes to `ArrayBuffer`.

## PrimJS compatibility (apps/mobile/src/lib/primjs-compat.ts)

socket.io-client / engine.io-client / @parcae/sdk assume browser-or-node globals
that PrimJS lacks. The shim (imported before `@parcae/sdk`) mirrors PrimJS's bare
timers onto `globalThis` and provides `performance`, `process`, `queueMicrotask`,
and `structuredClone` (used by the SDK's FrontendAdapter).

## Build & wire into the app (on a Mac / Android box)

```bash
nvm use 24
pnpm --filter @dollhousestudio/sparkling-websocket codegen   # regenerate native IDL
pnpm --filter @dollhousestudio/sparkling-websocket build      # build dist/
pnpm --filter @dollhousestudio/mobile autolink                # wire android/ios deps
pnpm --filter @dollhousestudio/mobile run:android             # or run:ios
```

Autolink updates `android/settings.gradle.kts` + `app/build.gradle.kts` and
the `Podfile`, and regenerates `SparklingAutolink.kt` / `SparklingAutolink.swift`.
Confirm the three `Websocket*Method` classes are registered in the global
method table (mirror the router/storage registrations in
`SPKServiceRegistrar.swift` / `SparklingAutolink.kt`).

## Verifying on device

1. Point at dev API: `DOLLHOUSE_API_URL=https://dev-api.dollhouse.world`.
2. Open the app — `apps/mobile` `main` page logs socket connection state.
3. Watch for `Websocket.connect` → `open` → socket.io `hello`/`resync` round-trips.
4. `useQuery` live diffs should flow once the SDK reconnects.
