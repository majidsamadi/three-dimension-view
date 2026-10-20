/** SHA-256 helpers for component descriptors and presigned PUT checksum headers (Web Crypto, no dependency). */
export async function sha256Bytes(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>))
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return Array.from(await sha256Bytes(bytes), byte => byte.toString(16).padStart(2, '0')).join('')
}

export function hexToBase64(hex: string): string {
  const pairs = hex.match(/../g) || []
  return btoa(String.fromCharCode(...pairs.map(pair => parseInt(pair, 16))))
}
