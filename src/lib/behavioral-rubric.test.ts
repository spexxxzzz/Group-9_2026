import { describe, expect, it } from 'vitest'
import {
  BEHAVIORAL_CRITERIA,
  behavioralAverage,
  behavioralScore,
  parseBehavioralRubric,
} from './behavioral-rubric'

const rows = BEHAVIORAL_CRITERIA.map((criterion) => ({
  id: criterion.id,
  grade: 3,
  justification: 'The candidate gave a relevant example.',
  evidence: 'I led the migration and explained the result.',
}))

describe('behavioral rubric scoring', () => {
  it('calculates the score from applicable grades and excludes unobserved criteria', () => {
    const parsed = parseBehavioralRubric(
      rows.map((row) => row.id === 'candidate_questions' ? {
        ...row,
        grade: null,
        evidence: '',
        justification: 'The interviewer did not invite questions.',
      } : row),
      false,
    )
    expect(parsed.find((row) => row.id === 'nonverbal')?.grade).toBeNull()
    expect(parsed.find((row) => row.id === 'candidate_questions')?.grade).toBeNull()
    expect(behavioralAverage(parsed)).toBe(3)
    expect(behavioralScore(parsed)).toBe(67)
  })

  it('rejects a missing row rather than publishing an unsupported score', () => {
    expect(() => parseBehavioralRubric(rows.slice(1), true)).toThrow('omitted verbal')
  })
})
