import { describe, expect, it } from 'vitest'
import { buildGreeting, buildSystemPrompt, interviewDuration, remainingConversationSeconds } from './tavus'

describe('five-minute interview configuration', () => {
  it('never advertises a behavioral duration longer than the Tavus call limit', () => {
    expect(interviewDuration('behavioral', 7)).toBe(5)
    expect(interviewDuration('behavioral', 10)).toBe(5)
    expect(interviewDuration('behavioral', 12)).toBe(5)
    expect(interviewDuration('coding')).toBe(5)
    expect(interviewDuration('system-design')).toBe(5)
  })

  it('asks for a private, role-specific evidence plan instead of fixed questions', () => {
    const prompt = buildSystemPrompt(
      'Product Manager',
      'behavioral',
      { difficulty: 'mid' },
      'Lead cross-functional launches and resolve stakeholder conflict.',
      undefined,
      5,
    )
    expect(prompt).toContain('five-minute')
    expect(prompt).toContain('private interview plan')
    expect(prompt).toContain('stakeholder conflict')
    expect(prompt).toContain('follow-up')
    expect(prompt).not.toContain('fixed list')
    expect(buildGreeting('Product Manager', 'behavioral', 5)).toContain('start briefly')
  })

  it('counts down from Tavus conversation creation rather than candidate join', () => {
    const createdAt = Date.parse('2026-09-30T03:52:17Z')
    expect(remainingConversationSeconds(createdAt, 5, createdAt + 20_000)).toBe(280)
    expect(remainingConversationSeconds(createdAt, 5, createdAt + 300_000)).toBe(0)
  })
})
