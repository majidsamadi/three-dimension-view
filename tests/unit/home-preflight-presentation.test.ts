import { describe, expect, it } from 'vitest'
import fixtureJson from '../fixtures/home-preflight/d-p06-states.json'
import type { HomePreflightSnapshot } from '@/home/preflight'
import {
  describeHomePreflight,
  type HomePreflightPresentationOptions,
  type HomePreflightStatus,
} from '@/home/preflight-presentation'

// HSA-02.1–02.3 / HSA-08.1 state coverage over D P06 journey_002 transcriptions plus synthetic cases.
interface FixtureCase {
  id: string
  origin: string
  snapshot: HomePreflightSnapshot
  observedContextRevision?: number
  options?: HomePreflightPresentationOptions
  expected: { status: HomePreflightStatus; textIncludes: string[] }
}

const fixture = fixtureJson as unknown as {
  source: { packet: string; record: string }
  cases: FixtureCase[]
}

describe('Home preflight presentation states (fixture-driven)', () => {
  it('records its off-repo source and covers every required status', () => {
    expect(fixture.source.packet).toBe('WiseStay_Team_D_P06_Home_Entry_Preflight_v1.0.zip')
    expect(fixture.source.record).toContain('D-P06-HOME-ENTRY-PREFLIGHT-PROTOTYPE-01')
    expect(fixture.cases.filter(item => item.id.startsWith('d-'))).toHaveLength(8)
    const statuses = new Set(fixture.cases.map(item => item.expected.status))
    for (const status of ['loading', 'empty', 'denied', 'unsupported', 'offline', 'conflict', 'stale', 'ready-unqualified']) {
      expect(statuses.has(status as HomePreflightStatus), status).toBe(true)
    }
  })

  it.each(fixture.cases.map(item => [item.id, item] as const))('%s', (_id, item) => {
    const result = describeHomePreflight(item.snapshot, item.observedContextRevision, item.options)
    expect(result.status).toBe(item.expected.status)
    expect(result.headline.length).toBeGreaterThan(0)
    for (const text of item.expected.textIncludes) expect(result.textAlternative).toContain(text)
    // Every fact carries a visible text label and state text, never only a colour or icon.
    expect(result.facts.map(fact => fact.label)).toEqual([
      'Central identity', 'Canonical property', 'Capture', 'Viewing', 'Measurement',
      'Offline / local readiness', 'Camera permission', 'Storage', 'Local assets',
    ])
    for (const fact of result.facts) {
      expect(fact.state.length).toBeGreaterThan(0)
      expect(fact.text.length).toBeGreaterThan(0)
    }
    // No plain "ready" status exists while device capture is unqualified (Q04).
    expect(result.status).not.toBe('ready')
    if (item.snapshot.identity.userId) expect(result.textAlternative).not.toContain(item.snapshot.identity.userId)
  })

  it('treats staleness as revision-based only and does not mutate the snapshot', () => {
    const item = fixture.cases.find(entry => entry.id === 'synthetic-stale')!
    const before = JSON.stringify(item.snapshot)
    expect(describeHomePreflight(item.snapshot, item.snapshot.contextRevision).status).not.toBe('stale')
    expect(describeHomePreflight(item.snapshot).status).not.toBe('stale')
    expect(describeHomePreflight(item.snapshot, item.snapshot.contextRevision - 1).status).toBe('stale')
    expect(JSON.stringify(item.snapshot)).toBe(before)
  })

  it('applies the documented precedence: loading before stale before conflict before denied', () => {
    const denied = fixture.cases.find(entry => entry.id === 'd-05-camera-denied')!.snapshot
    const conflicting = { ...denied, intent: { ...denied.intent, canonicalPropertyRef: 'PROP-SYNTH-MISSING' } }
    expect(describeHomePreflight(conflicting).status).toBe('conflict')
    expect(describeHomePreflight(conflicting, conflicting.contextRevision + 1).status).toBe('stale')
    expect(describeHomePreflight({ ...conflicting, loading: true }, conflicting.contextRevision + 1).status).toBe('loading')
  })
})
