/** Shared row types for the mock-interview app. Mirror the schemas. */

// 'incomplete' is a terminal state for calls that ended before the candidate
// gave any substantive answer — distinct from a failed scoring job.
export type InterviewStatus = 'created' | 'live' | 'ended' | 'scored' | 'incomplete'

export type InterviewType = 'behavioral' | 'coding' | 'system-design'

export type Difficulty = 'intern' | 'junior' | 'mid' | 'senior' | 'staff'

/** Number of questions a session aims for — used to normalize the score. */
export const EXPECTED_QUESTIONS = 6

export interface Interview {
  userId: string
  role: string
  jobDescription?: string
  /** Extracted locally from an opted-in resume; the source file is never stored. */
  resumeText?: string
  resumeFileName?: string
  /** Explicit candidate permission to use resume context for this interview. */
  resumeFollowupConsent?: boolean
  interviewType: InterviewType
  difficulty: Difficulty
  // Chosen interviewer (Tavus stock replica). Empty → auto-picked at provision.
  replicaId?: string
  replicaName?: string
  personaId?: string
  conversationId?: string
  conversationUrl?: string
  status: InterviewStatus
  scoringJobId?: string
  // Coding mode: the pre-generated problem shown on screen + its hint ladder.
  problemTitle?: string
  problem?: string
  hints?: string[]
  /** How many hints the candidate revealed (counts against the score). */
  hintsUsed?: number
  // Coding mode: the candidate's final scratch-pad code, captured on End and
  // fed to the scorer.
  code?: string
  language?: string
}

export interface TranscriptTurn {
  speaker: 'interviewer' | 'candidate'
  text: string
}

export interface PerQuestionScore {
  question: string
  answer: string
  /** 0–10 */
  score: number
  feedback: string
  betterAnswer: string
}

export interface Report {
  userId: string
  interviewId: string
  role?: string
  interviewType?: InterviewType
  transcript?: TranscriptTurn[]
  /** 0–100, normalized for how much of the interview was completed. */
  overallScore: number
  /** How many distinct questions the candidate actually answered. */
  questionsAnswered?: number
  /** The session's target question count (EXPECTED_QUESTIONS). */
  expectedQuestions?: number
  perQuestion?: PerQuestionScore[]
  strengths?: string[]
  weaknesses?: string[]
  /** Optional Raven camera / delivery observations, phrased as coaching. */
  nonVerbalFeedback?: string
  /** Optional coaching that relates interview evidence to an opted-in resume. */
  resumeFeedback?: string
  summary?: string
  /** false after the fast summary pass; true once the detailed breakdown lands. */
  detailed?: boolean
}
