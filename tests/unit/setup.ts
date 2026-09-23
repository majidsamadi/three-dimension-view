import 'fake-indexeddb/auto'
import { Blob, File } from 'node:buffer'
import { webcrypto } from 'node:crypto'
import { TextDecoder, TextEncoder } from 'node:util'
import { vi } from 'vitest'
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
Object.defineProperty(globalThis, 'Blob', { value: Blob, configurable: true })
Object.defineProperty(globalThis, 'File', { value: File, configurable: true })
Object.defineProperty(globalThis, 'TextEncoder', { value: TextEncoder, configurable: true })
Object.defineProperty(globalThis, 'TextDecoder', { value: TextDecoder, configurable: true })
Object.defineProperty(window, 'matchMedia', { value: vi.fn((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() })) })
Object.defineProperty(globalThis, 'BroadcastChannel', { value: undefined, configurable: true })
