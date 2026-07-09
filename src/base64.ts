/**
 * Base64 → bytes. PrimJS lacks `atob`, so a tiny decoder is needed for
 * the binary WebSocket frames (gzip + compress-json RPC responses that
 * the Parcae server emits).
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '')
  const len = clean.length
  // Round the group count UP: padded input ('=' stripped above) leaves
  // len % 4 == 2 or 3, whose tail still decodes to 1-2 bytes. Sizing by
  // `len >> 2` dropped those trailing bytes (out-of-range Uint8Array
  // writes are silently ignored), which truncated the gzip stream and
  // broke its final length check.
  const out = new Uint8Array((((len + 3) >> 2) >>> 0) * 3)
  let p = 0
  for (let i = 0; i < len; i += 4) {
    const c0 = ALPHABET.indexOf(clean[i]!)
    const c1 = ALPHABET.indexOf(clean[i + 1]!)
    // Index 0 ('A') is valid — guard with >= 0, not truthiness.
    const c2 = i + 2 < len ? ALPHABET.indexOf(clean[i + 2]!) : -1
    const c3 = i + 3 < len ? ALPHABET.indexOf(clean[i + 3]!) : -1
    if (c0 < 0 || c1 < 0) break
    out[p++] = (c0 << 2) | (c1 >> 4)
    if (c2 >= 0) out[p++] = ((c1 & 15) << 4) | (c2 >> 2)
    if (c3 >= 0) out[p++] = ((c2 & 3) << 6) | c3
  }
  // Copy into a tightly-sized buffer — `.buffer` of a subarray would
  // expose the over-allocated tail and corrupt the gzip stream.
  const decoded = new Uint8Array(p)
  decoded.set(out.subarray(0, p))
  return decoded
}
