import type { HomeCapabilityFacts, HomePreflightSnapshot } from './preflight'

/**
 * HSA-02.1–02.3 presentation state for the Home entry preflight (P06).
 *
 * A pure derivation of one summary status plus a text alternative from a preflight snapshot.
 * There is deliberately no `ready` status: device capture is not qualified (Q04), so the
 * best outcome is `ready-unqualified`. Staleness is revision-based only; no time threshold
 * is chosen (Q03/Q09).
 */
export type HomePreflightStatus =
  | 'loading'
  | 'empty'
  | 'denied'
  | 'unsupported'
  | 'offline'
  | 'conflict'
  | 'stale'
  | 'ready-unqualified'

export interface HomePreflightPresentationFact {
  label: string
  state: string
  text: string
}

export interface HomePreflightPresentation {
  status: HomePreflightStatus
  headline: string
  textAlternative: string
  facts: HomePreflightPresentationFact[]
}

export interface HomePreflightPresentationOptions {
  /** The caller knows the external account context changed since facts were last read. */
  accountChanged?: boolean
}

const STATE_LABELS: Record<string, string> = {
  available: 'Available',
  unavailable: 'Unavailable',
  unknown: 'Unknown',
  pressure: 'Pressure reported',
  unqualified: 'Available · unqualified',
  ready: 'Ready fact',
  'pending-review': 'Pending review',
  'virtual-research': 'Virtual / research',
}

export const HOME_PREFLIGHT_STATUS_LABELS: Record<HomePreflightStatus, string> = {
  loading: 'Loading',
  empty: 'No property context',
  denied: 'Camera permission unavailable',
  unsupported: 'Capture unsupported',
  offline: 'Offline readiness unavailable',
  conflict: 'Context conflict',
  stale: 'Facts out of date',
  'ready-unqualified': 'Facts read · not qualified',
}

const CAPABILITY_LABELS: Array<[keyof HomeCapabilityFacts, string]> = [
  ['capture', 'Capture'],
  ['viewing', 'Viewing'],
  ['measurement', 'Measurement'],
  ['offline', 'Offline / local readiness'],
  ['cameraPermission', 'Camera permission'],
  ['storage', 'Storage'],
  ['assets', 'Local assets'],
]

const ACTIONS_DISABLED = 'Real actions stay disabled.'

function label(state: string): string {
  return STATE_LABELS[state] || state
}

function presentationFacts(snapshot: HomePreflightSnapshot): HomePreflightPresentationFact[] {
  const selected = snapshot.propertyFacts.contexts.find(context => context.reference === snapshot.selectedPropertyRef)
  return [
    // Identity text never includes the canonical user ID; it is shown only in its own card.
    { label: 'Central identity', state: label(snapshot.identity.state), text: snapshot.identity.detail },
    selected
      ? { label: 'Canonical property', state: label(selected.state), text: selected.detail }
      : { label: 'Canonical property', state: 'No canonical association', text: snapshot.propertyFacts.detail },
    ...CAPABILITY_LABELS.map(([key, name]) => ({
      label: name,
      state: label(snapshot.capabilities[key].state),
      text: snapshot.capabilities[key].detail,
    })),
  ]
}

function missingPropertyRef(snapshot: HomePreflightSnapshot): string | undefined {
  const known = new Set(snapshot.propertyFacts.contexts.map(context => context.reference))
  return [snapshot.intent.canonicalPropertyRef, snapshot.selectedPropertyRef].find(ref => ref !== undefined && ref !== '' && !known.has(ref))
}

function derive(
  snapshot: HomePreflightSnapshot,
  observedContextRevision: number | undefined,
  options: HomePreflightPresentationOptions,
): { status: HomePreflightStatus; headline: string; explanation: string } {
  if (snapshot.loading) {
    return { status: 'loading', headline: 'Reading preflight facts.', explanation: 'Identity, property and capability facts are being read. Nothing is started while this runs.' }
  }
  if (observedContextRevision !== undefined && observedContextRevision !== snapshot.contextRevision) {
    return {
      status: 'stale',
      headline: 'These facts are out of date.',
      explanation: `The account or return context changed after the shown facts were read (read at revision ${observedContextRevision}, current revision ${snapshot.contextRevision}). Re-read facts before relying on them. ${ACTIONS_DISABLED}`,
    }
  }
  const missing = missingPropertyRef(snapshot)
  if (missing) {
    return {
      status: 'conflict',
      headline: 'The requested property does not match the supplied facts.',
      explanation: `The requested canonical property ${missing} is not among the properties supplied by the adapter. No property is substituted or created. ${ACTIONS_DISABLED}`,
    }
  }
  if (options.accountChanged && snapshot.identity.state === 'unavailable') {
    return {
      status: 'conflict',
      headline: 'The account changed.',
      explanation: `The current identity is unavailable after an account change. Earlier account and property facts no longer apply. ${ACTIONS_DISABLED}`,
    }
  }
  if (snapshot.capabilities.cameraPermission.state === 'unavailable') {
    return { status: 'denied', headline: 'Camera permission is unavailable.', explanation: `Capture stays blocked. This screen did not request camera permission and makes no device support conclusion. ${ACTIONS_DISABLED}` }
  }
  if (snapshot.capabilities.capture.state === 'unavailable') {
    return { status: 'unsupported', headline: 'Capture is not supported in this runtime.', explanation: `No supported capture path was reported. Existing local projects stay readable. ${ACTIONS_DISABLED}` }
  }
  if (snapshot.capabilities.offline.state === 'unavailable') {
    return { status: 'offline', headline: 'Offline readiness is unavailable.', explanation: `Required local or platform components were reported unavailable. Existing local data is not changed. ${ACTIONS_DISABLED}` }
  }
  if (snapshot.propertyFacts.contexts.length === 0) {
    return { status: 'empty', headline: 'No canonical property context is available.', explanation: `The local project stays unmatched. No property is created from its name or location. ${ACTIONS_DISABLED}` }
  }
  return {
    status: 'ready-unqualified',
    headline: 'Facts read. Device capture is not qualified.',
    explanation: `Preflight facts are present, but device capture is not qualified for this device (Q04). Review each fact below. ${ACTIONS_DISABLED}`,
  }
}

export function describeHomePreflight(
  snapshot: HomePreflightSnapshot,
  observedContextRevision?: number,
  options: HomePreflightPresentationOptions = {},
): HomePreflightPresentation {
  const facts = presentationFacts(snapshot)
  const { status, headline, explanation } = derive(snapshot, observedContextRevision, options)
  const summary = facts.map(fact => `${fact.label}: ${fact.state}.`).join(' ')
  return { status, headline, textAlternative: `${explanation} ${summary}`, facts }
}
