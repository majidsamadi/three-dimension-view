import { ref } from 'vue'
import { errorMessage } from '@/domain/validation'
import type { ServiceAccount } from '@/service/compositions'

export type AccountState = 'none' | 'checking' | 'signed-in' | 'signed-out'

/** Message for a WebSession failure (CSRF, session or network), naming its closed code. */
export function sessionErrorMessage(error: unknown): string {
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined
  return typeof code === 'string' && /^[a-z0-9_]{1,100}$/.test(code)
    ? `Your WiseStay session could not be used (${code}). Try signing in again.`
    : errorMessage(error)
}

/**
 * Live-mode WiseStay sign-in state for the service views (plan §6.3.1). `none` outside live mode.
 * A 401 from the service or the BFF moves the state to `signed-out`.
 */
export function useServiceAccount(report: (message: string) => void) {
  const state = ref<AccountState>('none')
  const busy = ref(false)
  let current: ServiceAccount | undefined
  let unsubscribe: (() => void) | undefined
  async function attach(account: ServiceAccount | undefined): Promise<void> {
    unsubscribe?.()
    unsubscribe = undefined
    current = account
    if (!account) { state.value = 'none'; return }
    state.value = 'checking'
    unsubscribe = account.onSignedOut(() => { if (current === account) state.value = 'signed-out' })
    try {
      const signedIn = await account.restore()
      if (current === account) state.value = signedIn ? 'signed-in' : 'signed-out'
    } catch (error) {
      if (current !== account) return
      state.value = 'signed-out'
      report(sessionErrorMessage(error))
    }
  }
  async function signIn(returnPath: string): Promise<void> {
    if (!current || busy.value) return
    busy.value = true
    try { await current.signIn(returnPath) } catch (error) { report(sessionErrorMessage(error)) } finally { busy.value = false }
  }
  async function signOut(): Promise<void> {
    if (!current || busy.value) return
    busy.value = true
    try {
      await current.signOut()
      state.value = 'signed-out'
    } catch (error) {
      state.value = 'signed-out'
      report(sessionErrorMessage(error))
    } finally { busy.value = false }
  }
  function dispose(): void { unsubscribe?.(); unsubscribe = undefined; current = undefined }
  return { state, busy, attach, signIn, signOut, dispose }
}
