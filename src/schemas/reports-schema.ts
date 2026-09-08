import type { CollectionSchema } from 'deepspace/worker'

/**
 * reports — the scored feedback report for one interview, written by the
 * background scoring job (see src/jobs.ts). One report per interview.
 *
 * Users can never create or edit a report: the only writer is the job, which
 * goes through the privileged X-App-Action path (RBAC-bypassing) and stamps
 * `userId` to the interview owner so 'own' reads still gate visibility. The UI
 * reads its own reports and may delete them.
 */
export const reportsSchema: CollectionSchema = {
  name: 'reports',
  ownerField: 'userId',
  columns: [
    { name: 'userId', storage: 'text', interpretation: 'plain', userBound: true, immutable: true, required: true },
    { name: 'interviewId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'role', storage: 'text', interpretation: 'plain' },
    { name: 'interviewType', storage: 'text', interpretation: 'plain' },
    // [{ speaker: 'interviewer' | 'candidate', text: string }]
    { name: 'transcript', storage: 'text', interpretation: { kind: 'json' } },
    { name: 'overallScore', storage: 'number', interpretation: 'plain' },
    { name: 'questionsAnswered', storage: 'number', interpretation: 'plain' },
    { name: 'expectedQuestions', storage: 'number', interpretation: 'plain' },
    // false after the fast summary pass; true once the detailed breakdown lands.
    { name: 'detailed', storage: 'text', interpretation: { kind: 'json' } },
    // [{ question, answer, score, feedback, betterAnswer }]
    { name: 'perQuestion', storage: 'text', interpretation: { kind: 'json' } },
    { name: 'strengths', storage: 'text', interpretation: { kind: 'json' } },
    { name: 'weaknesses', storage: 'text', interpretation: { kind: 'json' } },
    { name: 'nonVerbalFeedback', storage: 'text', interpretation: 'plain' },
    { name: 'resumeFeedback', storage: 'text', interpretation: 'plain' },
    { name: 'summary', storage: 'text', interpretation: 'plain' },
  ],
  permissions: {
    '*': { read: false, create: false, update: false, delete: false },
    viewer: { read: 'own', create: false, update: false, delete: 'own' },
    member: { read: 'own', create: false, update: false, delete: 'own' },
    admin: { read: true, create: true, update: true, delete: true },
  },
}
