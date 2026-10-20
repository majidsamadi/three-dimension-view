import {
  CONTRACT,
  WebSession,
  WebSessionError,
  type Receipt,
} from '@/vendor/account-centre/web-session.mjs'
import {
  unavailableIdentity,
  unavailableProperties,
  type HomePreflightAdapters,
  type IdentityFact,
  type IdentityFactsAdapter,
} from './preflight'
import { ExistingCapabilityFactsAdapter } from './preflight-adapters'

function unknownIdentity(detail: string): IdentityFact {
  return { state: 'unknown', detail }
}

/**
 * Process-local receipt currentness: the exact receipt object the session holds now, while it is
 * authenticated. Not a resource or action grant. (The canonical client at the wave 3 pin has no
 * `isCurrent()`, so Home keeps the same check locally.)
 */
export function isCurrentReceipt(session: WebSession, receipt: Receipt | null): boolean {
  return receipt !== null && receipt === session.receipt && session.authenticated
}
function validCurrentReceipt(session: WebSession, receipt: Receipt): receipt is Receipt & {
  authenticated: true
  user_id: string
  identity_contract: string
  expires_at: number
} {
  return receipt.authenticated === true &&
    receipt.contract === CONTRACT &&
    receipt.identity_contract === 'wisestay.identity.v1' &&
    typeof receipt.user_id === 'string' &&
    receipt.user_id.length > 0 &&
    Number.isSafeInteger(receipt.expires_at) &&
    (receipt.expires_at || 0) * 1000 > Date.now() &&
    isCurrentReceipt(session, receipt)
}

function restoreFailure(error: unknown): IdentityFact {
  if (error instanceof WebSessionError) {
    const detail = `Canonical WebSession could not verify current identity (${error.code}).`
    return error.status === 401 ? unavailableIdentity(detail) : unknownIdentity(detail)
  }
  return unknownIdentity('Canonical WebSession could not verify current identity.')
}

/**
 * Adapt the canonical Account Centre WebSession into Home's identity-only preflight seam.
 *
 * This adapter never calls start(), logout() or service fetch(). It exposes no CSRF,
 * expiry, organization, property, role or action authority. The injected WebSession
 * remains responsible for validating its canonical receipt and session generation.
 */
export function createCanonicalHomeIdentityAdapter(session: WebSession): IdentityFactsAdapter {
  return {
    async readCurrent(): Promise<IdentityFact> {
      if (!session.enabled) {
        return unavailableIdentity('Canonical WebSession is disabled for this application/origin; no identity request was made.')
      }
      if (session.blocked) {
        return unavailableIdentity('Canonical WebSession is blocked; no current verified identity is available.')
      }
      try {
        const receipt = await session.restore()
        if (!receipt?.authenticated) {
          return unavailableIdentity('Canonical WebSession has no authenticated current identity.')
        }
        if (!validCurrentReceipt(session, receipt)) {
          return unknownIdentity('Canonical WebSession returned identity data that is not a current valid canonical receipt.')
        }
        return {
          state: 'available',
          userId: receipt.user_id,
          identityContract: receipt.identity_contract,
          detail: 'Current canonical Account Centre identity verified by the injected WebSession.',
        }
      } catch (error) {
        return restoreFailure(error)
      }
    },
  }
}

/**
 * Optional composition for a future explicitly approved Home first-party session.
 * The default application composition remains createDefaultHomePreflightAdapters().
 * Canonical property/current-action authority remains disconnected here.
 */
export function createCanonicalHomePreflightAdapters(session: WebSession): HomePreflightAdapters {
  return {
    identity: createCanonicalHomeIdentityAdapter(session),
    properties: {
      async readForIntent() {
        return unavailableProperties('Canonical property/current-action provider is not connected in this Home identity adapter.')
      },
    },
    capabilities: new ExistingCapabilityFactsAdapter(),
  }
}
