/** Observable, interview-specific adaptation of Princeton's four-level rubric. */

export const BEHAVIORAL_CRITERIA = [
  {
    id: 'verbal',
    label: 'Verbal communication',
    anchors: [
      'Often hard to follow or substantially unclear.',
      'Understandable, but pace, clarity, or concision is uneven.',
      'Clear and generally well paced with little unnecessary detail.',
      'Clear, concise, and naturally paced throughout.',
    ],
  },
  {
    id: 'nonverbal',
    label: 'Visible engagement',
    anchors: [
      'Repeated observable disengagement from the conversation.',
      'Visible engagement is inconsistent.',
      'Generally present and attentive on camera.',
      'Consistently attentive and natural on camera.',
    ],
  },
  {
    id: 'listening',
    label: 'Listening and interaction',
    anchors: [
      'Frequently misses or talks over the question.',
      'Responds to part of the question but misses important context.',
      'Listens and responds to the question asked.',
      'Engages thoughtfully and asks for clarification when useful.',
    ],
  },
  {
    id: 'answers',
    label: 'Answer relevance',
    anchors: [
      'Answers are mostly off topic or too vague to assess.',
      'Addresses the question with limited supporting detail.',
      'Gives relevant examples and explains their significance.',
      'Gives specific, well chosen examples and keeps the role in view.',
    ],
  },
  {
    id: 'stories',
    label: 'Behavioral examples (STAR)',
    anchors: [
      'Does not provide a specific experience when asked.',
      'Provides an experience but leaves actions or outcomes unclear.',
      'Explains the situation, own actions, and result.',
      'Tells a complete, reflective story linked to the role.',
    ],
  },
  {
    id: 'preparation',
    label: 'Preparation and interest',
    anchors: [
      'Shows little understanding of the role or interest in it.',
      'Shows limited role understanding or generic interest.',
      'Shows relevant role understanding and a concrete interest.',
      'Connects thoughtful preparation and personal interest to the role.',
    ],
  },
  {
    id: 'candidate_questions',
    label: 'Candidate questions',
    anchors: [
      'Does not ask a question when clearly invited to do so.',
      'Asks a broad question with little connection to the role.',
      'Asks a relevant, prepared question about the role or team.',
      'Asks an insightful question that builds on the discussion.',
    ],
  },
] as const

export type BehavioralCriterionId = (typeof BEHAVIORAL_CRITERIA)[number]['id']
export type RubricGrade = 1 | 2 | 3 | 4

export interface BehavioralRubricRow {
  id: BehavioralCriterionId
  grade: RubricGrade | null
  /** A concrete explanation, or why this criterion could not be observed. */
  justification: string
  /** Short transcript or Raven evidence; empty for not applicable rows. */
  evidence: string
}

export const RUBRIC_GRADE_LABELS = [
  'Needs improvement',
  'Developing',
  'Good',
  'Excellent',
] as const

/** Equal-weight mean of applicable 1-4 grades, mapped to 0-100. */
export function behavioralScore(rows: BehavioralRubricRow[]): number {
  const grades = rows.flatMap((row) => row.grade === null ? [] : [row.grade])
  if (!grades.length) throw new Error('No applicable behavioral rubric grades were returned.')
  const average = grades.reduce((sum, grade) => sum + grade, 0) / grades.length
  return Math.round(((average - 1) / 3) * 100)
}

export function behavioralAverage(rows: BehavioralRubricRow[]): number {
  const grades = rows.flatMap((row) => row.grade === null ? [] : [row.grade])
  return grades.length ? grades.reduce((sum, grade) => sum + grade, 0) / grades.length : 0
}

/** Reject malformed model output instead of silently publishing an arbitrary score. */
export function parseBehavioralRubric(value: unknown, hasPerception: boolean): BehavioralRubricRow[] {
  if (!Array.isArray(value)) throw new Error('Scoring model returned no rubric rows.')
  const raw = value as Array<Record<string, unknown>>
  return BEHAVIORAL_CRITERIA.map((criterion) => {
    const match = raw.find((row) => row && row.id === criterion.id)
    if (!match) throw new Error(`Scoring model omitted ${criterion.id}.`)
    const grade = criterion.id === 'nonverbal' && !hasPerception ? null : match.grade
    if (grade !== null && grade !== 1 && grade !== 2 && grade !== 3 && grade !== 4) {
      throw new Error(`Scoring model returned an invalid ${criterion.id} grade.`)
    }
    const justification = typeof match.justification === 'string' ? match.justification.trim() : ''
    const evidence = typeof match.evidence === 'string' ? match.evidence.trim() : ''
    if (!justification || (grade !== null && !evidence)) {
      throw new Error(`Scoring model omitted evidence for ${criterion.id}.`)
    }
    return {
      id: criterion.id,
      grade,
      justification: criterion.id === 'nonverbal' && !hasPerception
        ? 'Not assessed: no reliable camera or delivery observation was available.'
        : justification,
      evidence: grade === null ? '' : evidence,
    }
  })
}
