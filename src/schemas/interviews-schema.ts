import type { CollectionSchema } from 'deepspace/worker'

/**
 * interviews — one row per mock-interview session.
 *
 * Lifecycle: created → live → ended → scored
 *   created  the user picked a role; no Tavus session yet
 *   live     a Tavus persona + conversation exist; the avatar call is joinable
 *   ended    the user hung up; the scoring job has been enqueued
 *   scored   the scoring job wrote a `reports` row
 *
 * Owned by the creating user. `userId` is userBound+immutable so a client can
 * never forge another user's row, and every role reads only its own ('own').
 */
export const interviewsSchema: CollectionSchema = {
  name: 'interviews',
  ownerField: 'userId',
  columns: [
    { name: 'userId', storage: 'text', interpretation: 'plain', userBound: true, immutable: true, required: true },
    { name: 'role', storage: 'text', interpretation: 'plain', required: true },
    { name: 'durationMinutes', storage: 'number', interpretation: 'plain' },
    { name: 'conversationStartedAt', storage: 'number', interpretation: 'plain' },
    { name: 'joinedAt', storage: 'number', interpretation: 'plain' },
    { name: 'callbackToken', storage: 'text', interpretation: 'plain' },
    { name: 'jobDescription', storage: 'text', interpretation: 'plain' },
    // The original file stays in the browser. We retain only its extracted text,
    // and only after the candidate has explicitly opted into tailored questions.
    { name: 'resumeText', storage: 'text', interpretation: 'plain' },
    { name: 'resumeFileName', storage: 'text', interpretation: 'plain' },
    { name: 'resumeFollowupConsent', storage: 'text', interpretation: { kind: 'json' } },
    {
      name: 'interviewType',
      storage: 'text',
      interpretation: { kind: 'select', options: ['behavioral', 'coding', 'system-design'] },
      default: 'behavioral',
      required: true,
    },
    {
      name: 'difficulty',
      storage: 'text',
      interpretation: { kind: 'select', options: ['intern', 'junior', 'mid', 'senior', 'staff'] },
      default: 'mid',
      required: true,
    },
    // Chosen interviewer (Tavus stock replica). Empty → auto-pick at provision.
    { name: 'replicaId', storage: 'text', interpretation: 'plain' },
    { name: 'replicaName', storage: 'text', interpretation: 'plain' },
    // Coding mode: the pre-generated problem shown on screen + hint ladder.
    { name: 'problemTitle', storage: 'text', interpretation: 'plain' },
    { name: 'problem', storage: 'text', interpretation: 'plain' },
    { name: 'hints', storage: 'text', interpretation: { kind: 'json' } },
    // How many hints the candidate revealed — fed into scoring as a penalty.
    { name: 'hintsUsed', storage: 'number', interpretation: 'plain' },
    { name: 'personaId', storage: 'text', interpretation: 'plain' },
    { name: 'conversationId', storage: 'text', interpretation: 'plain' },
    { name: 'conversationUrl', storage: 'text', interpretation: 'plain' },
    {
      name: 'status',
      storage: 'text',
      interpretation: { kind: 'select', options: ['created', 'live', 'ended', 'scored', 'incomplete'] },
      default: 'created',
      required: true,
    },
    // Coding mode scratch-pad — written once when the call ends.
    { name: 'code', storage: 'text', interpretation: 'plain' },
    { name: 'language', storage: 'text', interpretation: 'plain' },
    // Set when the user ends the call and we enqueue scoring — lets the report
    // page subscribe to the right job for live progress.
    { name: 'scoringJobId', storage: 'text', interpretation: 'plain' },
  ],
  permissions: {
    '*': { read: false, create: false, update: false, delete: false },
    viewer: { read: 'own', create: true, update: 'own', delete: 'own' },
    member: { read: 'own', create: true, update: 'own', delete: 'own' },
    admin: { read: true, create: true, update: true, delete: true },
  },
}
