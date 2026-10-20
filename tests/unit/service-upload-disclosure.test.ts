import { describe, expect, it } from 'vitest'
import { LEAVING_CATEGORIES, describeUploadDisclosure } from '@/service/upload-disclosure'

describe('HSA-05.1 upload disclosure', () => {
  it('HSA-05.1 raw capture never listed as leaving device', () => {
    const disclosure = describeUploadDisclosure({ name: 'Synthetic kitchen', sceneCount: 2, photoCount: 3 })
    const leaving = disclosure.leavesDevice.map(item => `${item.category} ${item.detail}`).join(' ')
    expect(disclosure.leavesDevice.map(item => item.category)).toEqual(['Processed 3D model (GLB)', 'Asset envelope'])
    expect(LEAVING_CATEGORIES).toEqual(['processed_glb', 'asset_envelope'])
    for (const word of [/raw/i, /RGB/, /depth/i, /IMU/, /photo/i, /note/i]) expect(leaving).not.toMatch(word)
    const local = disclosure.staysLocal.map(item => item.category)
    expect(local).toEqual(expect.arrayContaining(['Raw camera frames (RGB)', 'Depth data', 'Motion sensor (IMU) data', 'Photos', 'Notes, annotations and measurements', 'Other projects on this device']))
    expect(disclosure.staysLocal.find(item => item.category === 'Photos')?.detail).toBe('3 photos stay on this device.')
    expect(disclosure.retention.join(' ')).toMatch(/7 days/)
    expect(disclosure.retention.join(' ')).toMatch(/30 days/)
    expect(disclosure.retention.join(' ')).toMatch(/provisional \(Q08\)/)
    // HSA-05.3 cloud work is DISABLED (Q02): a static "not offered" note.
    expect(disclosure.cloudProcessing).toMatch(/^Cloud processing is not offered\./)
    expect(disclosure.captureQualification).toMatch(/not qualified/)
  })
})
