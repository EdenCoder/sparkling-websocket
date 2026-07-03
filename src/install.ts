/**
 * Side-effect entry: installs the native-backed `WebSocket` polyfill on
 * `globalThis` at import time. Import this BEFORE `@parcae/sdk` —
 * engine.io-client captures the `WebSocket` reference at module-eval, so
 * the polyfill must be in place before that import runs.
 *
 *   import '@dollhousestudio/sparkling-websocket/install'
 *   import { createClient } from '@parcae/sdk'
 */

import { installWebSocket } from './polyfill'

installWebSocket()
