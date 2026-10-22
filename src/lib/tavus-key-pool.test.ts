import { describe, expect, it } from 'vitest'
import { chooseTavusSlot, configuredTavusSlots, type SlotUsage } from './tavus-key-pool'
import type { Env } from '../../worker'

describe('Tavus key selection', () => {
  it('uses every key once before any key gets a second call', () => {
    const usage: SlotUsage[] = [1, 2, 3].map((slot) => ({ slot, used: 0, pending: 0, disabled: false }))
    const picked: number[] = []
    for (let i = 0; i < 9; i++) {
      const slot = chooseTavusSlot(usage)
      expect(slot).not.toBeNull()
      picked.push(slot!)
      usage[slot! - 1].used++
    }
    expect(picked).toEqual([1, 2, 3, 1, 2, 3, 1, 2, 3])
  })

  it('counts in-flight reservations and stops at the per-key cap', () => {
    const usage: SlotUsage[] = [
      { slot: 1, used: 4, pending: 1, disabled: false },
      { slot: 2, used: 4, pending: 0, disabled: false },
      { slot: 3, used: 0, pending: 0, disabled: true },
    ]
    expect(chooseTavusSlot(usage)).toBe(2)
    usage[1].pending = 1
    expect(chooseTavusSlot(usage)).toBeNull()
  })

  it('temporarily skips a rate-limited slot', () => {
    const usage: SlotUsage[] = [
      { slot: 1, used: 0, pending: 0, disabled: false, cooldownUntil: 70_000 },
      { slot: 2, used: 1, pending: 0, disabled: false },
    ]
    expect(chooseTavusSlot(usage, 5, 60_000)).toBe(2)
    expect(chooseTavusSlot(usage, 5, 70_000)).toBe(1)
  })

  it('ignores duplicate or empty secret slots', () => {
    const env = {
      TAVUS_API_KEY_1: 'first',
      TAVUS_API_KEY_2: 'first',
      TAVUS_API_KEY_3: 'third',
      TAVUS_API_KEY_4: ' ',
    } as Env
    expect(configuredTavusSlots(env)).toEqual([1, 3])
  })
})
