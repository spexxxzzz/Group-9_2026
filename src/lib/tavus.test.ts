import { describe, expect, it } from 'vitest'
import { behavioralTimeGuidance, buildGreeting, buildSystemPrompt, interviewDuration, remainingConversationSeconds } from './tavus'

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
    expect(prompt).toContain('final 20–30 seconds')
    expect(prompt).toContain('optionally invite')
    expect(prompt).not.toContain('final 60–90 seconds')
    expect(prompt).not.toContain('fixed list')
    expect(buildGreeting('Product Manager', 'behavioral', 5)).toContain('start briefly')
  })

  it('counts down from Tavus conversation creation rather than candidate join', () => {
    const createdAt = Date.parse('2026-09-30T03:52:17Z')
    expect(remainingConversationSeconds(createdAt, 5, createdAt + 20_000)).toBe(280)
    expect(remainingConversationSeconds(createdAt, 5, createdAt + 300_000)).toBe(0)
  })

  it('keeps probing with a minute left and makes the candidate question optional near the end', () => {
    expect(behavioralTimeGuidance(60)).toContain('substantive behavioral evidence')
    expect(behavioralTimeGuidance(60)).toContain('Do not move to candidate questions')
    expect(behavioralTimeGuidance(30)).toContain('optionally invite')
    expect(behavioralTimeGuidance(30)).toContain('otherwise thank them')
  })
})
