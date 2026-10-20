import type { InjectionKey } from 'vue'
import { getCapabilities } from '@/services/capabilities'
import {
  unavailableIdentity,
  unavailableProperties,
  type CapabilityFact,
  type HomeCapabilityFacts,
  type HomePreflightAdapters,
} from './preflight'

const fact = (state: CapabilityFact['state'], detail: string): CapabilityFact => ({ state, detail })

export class ExistingCapabilityFactsAdapter {
  async inspect(): Promise<HomeCapabilityFacts> {
    const source = await getCapabilities()
    const nativeSupported = Boolean(source.native?.available && source.native.support === 'supported')
    const nativeNeedsCheck = Boolean(source.native?.available && source.native.support === 'needs-check')
    const capture = nativeSupported || source.xr
      ? fact('available', nativeSupported ? `Native capture reports available: ${source.native?.reason || 'supported bridge'}` : 'Browser immersive AR is available; depth support is still verified only when capture starts.')
      : nativeNeedsCheck
        ? fact('unknown', source.native?.reason || 'Native capture requires a further device check.')
        : fact('unavailable', 'No current native-supported or immersive-browser capture path was reported by the existing capability check.')

    const viewing = source.webgl
      ? fact('available', 'The existing WebGL2 viewer path is available in this runtime.')
      : fact('unavailable', 'The existing WebGL2 viewer path is unavailable in this runtime; project data is not deleted.')

    const measurement = source.webgl
      ? fact('unqualified', 'Measurement UI can be presented with the existing viewer, but dimensions remain estimates and are not survey-qualified.')
      : fact('unknown', 'Measurement presentation cannot be qualified from this check alone.')

    const storageDetail = source.storage?.usage !== undefined || source.storage?.quota !== undefined
      ? `Browser storage estimate reported usage=${source.storage?.usage ?? 'unknown'} and quota=${source.storage?.quota ?? 'unknown'} bytes. No pressure threshold is inferred.`
      : 'Browser storage estimate was not supplied. No pressure threshold is inferred.'

    return {
      capture,
      viewing,
      measurement,
      offline: fact('unknown', source.platform === 'web'
        ? 'Local capture processing exists, but browser offline readiness also depends on the application shell and platform components already being available.'
        : 'Native capture processing is local, but required platform components and installed application state are separate prerequisites.'),
      cameraPermission: fact('unknown', source.camera
        ? 'A browser camera API exists, but this preflight does not request or infer permission.'
        : 'No browser camera API is exposed in this runtime; native permission state is not inferred.'),
      storage: fact('unknown', storageDetail),
      assets: fact('unknown', 'The local project record is readable; geometry/photo asset completeness is not checked by this entry preflight.'),
    }
  }
}

export function createDefaultHomePreflightAdapters(): HomePreflightAdapters {
  return {
    identity: { async readCurrent() { return unavailableIdentity() } },
    properties: { async readForIntent() { return unavailableProperties() } },
    capabilities: new ExistingCapabilityFactsAdapter(),
  }
}

export const HOME_PREFLIGHT_ADAPTERS: InjectionKey<HomePreflightAdapters> = Symbol('HOME_PREFLIGHT_ADAPTERS')
