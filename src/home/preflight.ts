export type Availability = 'available' | 'unavailable' | 'unknown' | 'pressure' | 'unqualified'
export type PropertyContextState = 'ready' | 'pending-review' | 'virtual-research' | 'unavailable'
export type PropertyKind = 'real' | 'virtual' | 'unknown'

export interface LocalProjectContext {
  id: string
  revision: number
  name: string
  location: string
}

export interface HomeReturnIntent {
  action: 'scan'
  localProjectId: string
  canonicalPropertyRef?: string
}

export interface IdentityFact {
  state: 'available' | 'unavailable' | 'unknown'
  userId?: string
  identityContract?: string
  detail: string
}

export interface CanonicalPropertyContext {
  reference: string
  name: string
  kind: PropertyKind
  state: PropertyContextState
  detail: string
}

export interface PropertyFactSet {
  state: 'available' | 'unavailable' | 'unknown'
  contexts: CanonicalPropertyContext[]
  detail: string
}

export interface CapabilityFact {
  state: Availability
  detail: string
}

export interface HomeCapabilityFacts {
  capture: CapabilityFact
  viewing: CapabilityFact
  measurement: CapabilityFact
  offline: CapabilityFact
  cameraPermission: CapabilityFact
  storage: CapabilityFact
  assets: CapabilityFact
}

export interface IdentityFactsAdapter {
  readCurrent(): Promise<IdentityFact>
}

export interface PropertyFactsAdapter {
  readForIntent(intent: HomeReturnIntent, identity: IdentityFact): Promise<PropertyFactSet>
}

export interface CapabilityFactsAdapter {
  inspect(): Promise<HomeCapabilityFacts>
}

export interface HomePreflightAdapters {
  identity: IdentityFactsAdapter
  properties: PropertyFactsAdapter
  capabilities: CapabilityFactsAdapter
}

export interface HomePreflightSnapshot {
  localProject: LocalProjectContext
  intent: HomeReturnIntent
  identity: IdentityFact
  propertyFacts: PropertyFactSet
  selectedPropertyRef?: string
  capabilities: HomeCapabilityFacts
  loading: boolean
  contextRevision: number
}

const unknown = (detail: string): CapabilityFact => ({ state: 'unknown', detail })

export function unknownCapabilities(): HomeCapabilityFacts {
  return {
    capture: unknown('Capture capability has not been checked for this context.'),
    viewing: unknown('Viewing capability has not been checked for this context.'),
    measurement: unknown('Measurement presentation has not been qualified for this context.'),
    offline: unknown('Offline readiness has not been established for this context.'),
    cameraPermission: unknown('Camera permission has not been requested.'),
    storage: unknown('Storage pressure has not been established.'),
    assets: unknown('Local asset completeness has not been checked.'),
  }
}

export function unavailableIdentity(detail = 'Central identity adapter is not connected in this build.'): IdentityFact {
  return { state: 'unavailable', detail }
}

export function unavailableProperties(detail = 'Canonical property adapter is not connected in this build.'): PropertyFactSet {
  return { state: 'unavailable', contexts: [], detail }
}

function copySnapshot(value: HomePreflightSnapshot): HomePreflightSnapshot {
  return {
    ...value,
    localProject: { ...value.localProject },
    intent: { ...value.intent },
    identity: { ...value.identity },
    propertyFacts: { ...value.propertyFacts, contexts: value.propertyFacts.contexts.map(context => ({ ...context })) },
    capabilities: {
      capture: { ...value.capabilities.capture },
      viewing: { ...value.capabilities.viewing },
      measurement: { ...value.capabilities.measurement },
      offline: { ...value.capabilities.offline },
      cameraPermission: { ...value.capabilities.cameraPermission },
      storage: { ...value.capabilities.storage },
      assets: { ...value.capabilities.assets },
    },
  }
}

function safeIdentity(result: PromiseSettledResult<IdentityFact>): IdentityFact {
  if (result.status === 'fulfilled') return { ...result.value }
  return unavailableIdentity('Central identity facts could not be read. No sign-in was attempted by this preflight.')
}

function safeProperties(result: PromiseSettledResult<PropertyFactSet>): PropertyFactSet {
  if (result.status === 'fulfilled') {
    return { ...result.value, contexts: result.value.contexts.map(context => ({ ...context })) }
  }
  return unavailableProperties('Canonical property facts could not be read. The local project remains unmatched.')
}

function safeCapabilities(result: PromiseSettledResult<HomeCapabilityFacts>): HomeCapabilityFacts {
  if (result.status === 'fulfilled') {
    return {
      capture: { ...result.value.capture },
      viewing: { ...result.value.viewing },
      measurement: { ...result.value.measurement },
      offline: { ...result.value.offline },
      cameraPermission: { ...result.value.cameraPermission },
      storage: { ...result.value.storage },
      assets: { ...result.value.assets },
    }
  }
  return unknownCapabilities()
}

export class HomePreflightController {
  private epoch = 0
  private state: HomePreflightSnapshot

  constructor(
    localProject: LocalProjectContext,
    intent: HomeReturnIntent,
    private readonly adapters: HomePreflightAdapters,
  ) {
    if (intent.localProjectId !== localProject.id) throw new Error('Return intent must stay bound to the same local project.')
    this.state = {
      localProject: { ...localProject },
      intent: { ...intent },
      identity: unavailableIdentity(),
      propertyFacts: unavailableProperties(),
      selectedPropertyRef: intent.canonicalPropertyRef,
      capabilities: unknownCapabilities(),
      loading: false,
      contextRevision: 0,
    }
  }

  snapshot(): HomePreflightSnapshot {
    return copySnapshot(this.state)
  }

  async refresh(): Promise<HomePreflightSnapshot> {
    const requestEpoch = ++this.epoch
    this.state = { ...this.state, loading: true, contextRevision: this.state.contextRevision + 1 }

    const identityPromise = this.adapters.identity.readCurrent()
    const capabilityPromise = this.adapters.capabilities.inspect()
    const identityResult = await Promise.allSettled([identityPromise])
    if (requestEpoch !== this.epoch) return this.snapshot()

    const identity = safeIdentity(identityResult[0])
    const propertyPromise = this.adapters.properties.readForIntent({ ...this.state.intent }, identity)
    const [propertyResult, capabilityResult] = await Promise.allSettled([propertyPromise, capabilityPromise])
    if (requestEpoch !== this.epoch) return this.snapshot()

    const propertyFacts = safeProperties(propertyResult)
    const requested = this.state.selectedPropertyRef || this.state.intent.canonicalPropertyRef
    const selectedPropertyRef = requested && propertyFacts.contexts.some(context => context.reference === requested)
      ? requested
      : undefined

    this.state = {
      ...this.state,
      identity,
      propertyFacts,
      selectedPropertyRef,
      capabilities: safeCapabilities(capabilityResult),
      loading: false,
    }
    return this.snapshot()
  }

  selectProperty(reference?: string): HomePreflightSnapshot {
    if (reference && !this.state.propertyFacts.contexts.some(context => context.reference === reference)) {
      throw new Error('Selected canonical property must come from the current adapter facts.')
    }
    this.state = { ...this.state, selectedPropertyRef: reference }
    return this.snapshot()
  }

  replaceIntent(intent: HomeReturnIntent): HomePreflightSnapshot {
    if (intent.localProjectId !== this.state.localProject.id) throw new Error('Return intent cannot switch the local project.')
    this.epoch++
    this.state = {
      ...this.state,
      intent: { ...intent },
      selectedPropertyRef: intent.canonicalPropertyRef,
      identity: unavailableIdentity('Current identity must be re-read for the changed return context.'),
      propertyFacts: unavailableProperties('Canonical property facts must be re-read for the changed return context.'),
      loading: false,
      contextRevision: this.state.contextRevision + 1,
    }
    return this.snapshot()
  }

  invalidateAccountContext(detail = 'Account context changed; current identity and property facts must be re-read.'): HomePreflightSnapshot {
    this.epoch++
    this.state = {
      ...this.state,
      identity: unavailableIdentity(detail),
      propertyFacts: unavailableProperties('Property facts were cleared with the external account context.'),
      selectedPropertyRef: undefined,
      loading: false,
      contextRevision: this.state.contextRevision + 1,
    }
    return this.snapshot()
  }

  selectedProperty(): CanonicalPropertyContext | undefined {
    return this.state.propertyFacts.contexts.find(context => context.reference === this.state.selectedPropertyRef)
  }
}
