/**
 * Background jobs — invoked by AppJobRoom (worker.ts) for every queued job.
 *
 * `score-interview` is the app's one job type. It runs after the user hangs up
 * the avatar call and turns a finished Tavus conversation into a scored report:
 *
 *   1. poll `tavus/get-conversation` until the transcript is ready
 *   2. send the transcript to Gemini to score each answer
 *   3. write the `reports` row and flip the interview to status = 'scored'
 *
 * Progress is broadcast over the JobRoom WebSocket (`ctx.progress`) so the
 * report page can render a live progress bar. The job is retryable — it's
 * enqueued with `maxAttempts > 1`, and any thrown error re-runs from step 1.
 */

import { generateText } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import type { Job, JobContext } from 'deepspace/worker'
import type { Env } from '../worker'
import { callTavus } from './lib/tavus-server'
import { EXPECTED_QUESTIONS } from './types'
import type { InterviewType, PerQuestionScore, Report, TranscriptTurn } from './types'

interface ScorePayload {
  interviewId: string
  conversationId: string
}

// Gemini Flash keeps both phases quick and affordable while the report is
// generated in the durable server-side job (the browser never sees the key).
const REPORT_MODEL = 'gemini-3.6-flash'

// ── transcript polling ──────────────────────────────────────────────────────

const TRANSCRIPT_POLL_ATTEMPTS = 30
const TRANSCRIPT_POLL_INTERVAL_MS = 5_000

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      reject(new Error('aborted'))
    })
  })

/**
 * Tavus returns transcript turns in a few shapes depending on API version
 * (a top-level `transcript`, or a `transcription_ready` event under `events`).
 * Normalize whatever we find into our { speaker, text } turns; replica/assistant
 * lines are the interviewer, user lines are the candidate.
 */
function extractTranscript(conversation: unknown): TranscriptTurn[] {
  const conv = conversation as Record<string, unknown>
  const rawTurns = collectRawTurns(conv)

  const turns: TranscriptTurn[] = []
  for (const t of rawTurns) {
    const role = String(t.role ?? t.speaker ?? '').toLowerCase()
    const text = String(t.content ?? t.text ?? t.message ?? '').trim()
    if (!text) continue
    const speaker: TranscriptTurn['speaker'] =
      role === 'user' || role === 'candidate' || role === 'human' ? 'candidate' : 'interviewer'
    turns.push({ speaker, text })
  }
  return turns
}

function collectRawTurns(conv: Record<string, unknown>): Array<Record<string, unknown>> {
  if (Array.isArray(conv.transcript)) return conv.transcript as Array<Record<string, unknown>>

  if (Array.isArray(conv.events)) {
    for (const event of conv.events as Array<Record<string, unknown>>) {
      const type = String(event.event_type ?? event.type ?? '')
      if (!type.includes('transcript')) continue
      const props = (event.properties ?? event.data ?? {}) as Record<string, unknown>
      const t = props.transcript ?? props.messages
      if (Array.isArray(t)) return t as Array<Record<string, unknown>>
    }
  }
  return []
}

/** Raven emits this end-of-call event after its audio/video analysis completes. */
function extractPerceptionAnalysis(conversation: unknown): string | undefined {
  const conv = conversation as Record<string, unknown>
  if (!Array.isArray(conv.events)) return undefined
  for (const event of [...(conv.events as Array<Record<string, unknown>>) ].reverse()) {
    const type = String(event.event_type ?? event.type ?? '').toLowerCase()
    if (!type.includes('perception')) continue
    const props = (event.properties ?? event.data ?? {}) as Record<string, unknown>
    const analysis = props.analysis ?? props.perception_analysis
    if (typeof analysis === 'string' && analysis.trim()) return analysis.trim()
    if (Array.isArray(analysis)) return analysis.map(String).filter(Boolean).join('\n') || undefined
  }
  return undefined
}

/** A candidate turn only "counts" once it carries some real content. */
const MIN_ANSWER_CHARS = 12

function substantiveAnswers(turns: TranscriptTurn[]): number {
  return turns.filter((t) => t.speaker === 'candidate' && t.text.trim().length >= MIN_ANSWER_CHARS)
    .length
}

/**
 * Poll Tavus until the candidate has at least one real answer in the
 * transcript, or we exhaust our attempts. Returns whatever turns we have —
 * the caller decides whether that's enough to score, or whether the call was
 * abandoned (transcript may still be one-sided / empty).
 */
interface TranscriptResult {
  turns: TranscriptTurn[]
  perceptionAnalysis?: string
}

async function pollTranscript(
  env: Env,
  ctx: JobContext,
  conversationId: string,
): Promise<TranscriptResult> {
  let turns: TranscriptTurn[] = []
  let perceptionAnalysis: string | undefined
  let transcriptReadyAt: number | undefined
  for (let attempt = 0; attempt < TRANSCRIPT_POLL_ATTEMPTS; attempt++) {
    if (ctx.signal.aborted) throw new Error('canceled')
    const conversation = await callTavus(env, 'get-conversation', {
      conversation_id: conversationId,
    })
    turns = extractTranscript(conversation)
    perceptionAnalysis ??= extractPerceptionAnalysis(conversation)
    if (substantiveAnswers(turns) > 0) {
      transcriptReadyAt ??= attempt
      // Raven commonly follows the transcript by a few seconds. Wait briefly
      // for it, but never hold the report for the full transcript timeout.
      if (perceptionAnalysis || attempt - transcriptReadyAt >= 6) {
        return { turns, perceptionAnalysis }
      }
    }

    const pct = 0.1 + 0.3 * (attempt / TRANSCRIPT_POLL_ATTEMPTS)
    ctx.progress(pct, 'Waiting for the interview transcript…')
    await sleep(TRANSCRIPT_POLL_INTERVAL_MS, ctx.signal)
  }
  return { turns, perceptionAnalysis }
}

// ── scoring ─────────────────────────────────────────────────────────────────

interface QuickResult {
  overallScore: number
  questionsAnswered: number
  summary: string
}

interface DetailResult {
  perQuestion: PerQuestionScore[]
  strengths: string[]
  weaknesses: string[]
  nonVerbalFeedback?: string
  resumeFeedback?: string
  summary: string
}

interface ScoreInput {
  role: string
  jobDescription: string
  interviewType: InterviewType
  turns: TranscriptTurn[]
  code?: string
  language?: string
  problemTitle?: string
  problem?: string
  hintsUsed?: number
  totalHints?: number
  perceptionAnalysis?: string
  /** Candidate-supplied resume context, only when consent was recorded. */
  resumeText?: string
}

/** Coding-only: tell the scorer that leaning on hints should cost points. */
function hintNote(input: ScoreInput): string {
  if (input.interviewType !== 'coding') return ''
  const used = input.hintsUsed ?? 0
  if (used === 0) {
    return 'The candidate solved this WITHOUT revealing any hints — a positive signal; do not penalize for hints.'
  }
  return [
    `The candidate revealed ${used}${input.totalHints ? ` of ${input.totalHints}` : ''} available hints.`,
    'Needing hints means they could not fully solve it unaided — this MUST lower the score, more so with each hint used.',
    'Also penalize any additional help they asked for in the transcript.',
  ].join(' ')
}

function transcriptToText(turns: TranscriptTurn[]): string {
  return turns
    .map((t) => `${t.speaker === 'interviewer' ? 'Interviewer' : 'Candidate'}: ${t.text}`)
    .join('\n')
}

function parseJsonObject(text: string): Record<string, unknown> {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fenced ? fenced[1] : text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('Scoring model returned no JSON object.')
  return JSON.parse(candidate.slice(start, end + 1))
}

/** Interview-type-specific grading guidance layered onto the base rubric. */
function rubricFor(type: InterviewType): string {
  switch (type) {
    case 'coding':
      return [
        'This was a CODING interview. Grade: correctness of the approach and final code, handling of edge cases,',
        'whether the candidate reasoned about their solution out loud BEFORE coding, code clarity, and — importantly —',
        'whether they correctly stated the time and space complexity. If they never gave complexity analysis, call that out',
        'as a weakness. Use the candidate\'s final code (provided below) as the source of truth for what they implemented.',
      ].join(' ')
    case 'system-design':
      return [
        'This was a SYSTEM DESIGN interview. Grade: requirements gathering, high-level architecture, data modeling,',
        'scaling/bottleneck reasoning, and explicit trade-off discussion. Reward candidates who quantify and justify choices.',
      ].join(' ')
    default:
      return [
        'This was a BEHAVIORAL interview. Grade using the STAR method (Situation, Task, Action, Result):',
        'reward concrete, specific stories with measurable outcomes; penalize vague or hypothetical answers.',
      ].join(' ')
  }
}

const completenessRule = [
  `This interview was designed to cover about ${EXPECTED_QUESTIONS} questions. The candidate may have ended early.`,
  'IMPORTANT: "overallScore" (0-100) must reflect BOTH answer quality AND how much of the interview was completed —',
  `answering only 1-2 of ~${EXPECTED_QUESTIONS} questions cannot earn a high overall score even if those answers were strong.`,
].join(' ')

function codeBlockFor(input: ScoreInput): string {
  return input.interviewType === 'coding' && input.code?.trim()
    ? `\nCandidate's final code (${input.language || 'unknown language'}):\n\`\`\`\n${input.code.trim()}\n\`\`\``
    : ''
}

function userPromptFor(input: ScoreInput): string {
  const problemBlock =
    input.interviewType === 'coding' && input.problem?.trim()
      ? `The coding problem the candidate was given:\n${input.problemTitle ? input.problemTitle + '\n' : ''}${input.problem.trim()}\n`
      : ''
  return [
    input.jobDescription.trim() ? `Job description:\n${input.jobDescription.trim()}\n` : '',
    input.resumeText?.trim()
      ? `Candidate-provided resume context (the candidate explicitly opted in; use only for relevant, evidence-based coaching):\n${input.resumeText.trim()}\n`
      : '',
    problemBlock,
    'Interview transcript:',
    transcriptToText(input.turns),
    input.perceptionAnalysis
      ? `Raven end-of-call camera and delivery observation (use only as cautious coaching; do not infer personality, intent, health, protected traits, or hiring fitness):\n${input.perceptionAnalysis}`
      : '',
    codeBlockFor(input),
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * Phase 1 — the fast pass. A small, quick model returns just the headline:
 * overall score, questions answered, and a 2-3 sentence summary (which, for
 * coding, calls out correctness + complexity). Lands within a few seconds so
 * the user sees a result almost immediately.
 */
async function quickSummary(env: Env, ctx: JobContext, input: ScoreInput): Promise<QuickResult> {
  ctx.progress(0.45, 'Writing your summary…')
  const google = createGoogleGenerativeAI({ apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY })
  const system = [
    `You are an expert ${input.role} hiring manager. Give a fast first-impression grade of this mock interview.`,
    rubricFor(input.interviewType),
    completenessRule,
    hintNote(input),
    input.interviewType === 'coding'
      ? 'In the summary, explicitly state whether the final code looks correct and whether the stated time/space complexity was right.'
      : '',
    'Respond with a SINGLE JSON object and nothing else:',
    '{ "overallScore": <integer 0-100>, "questionsAnswered": <integer>, "summary": <2-3 sentence verdict> }',
  ]
    .filter(Boolean)
    .join('\n')

  const { text } = await generateText({
    model: google(REPORT_MODEL),
    system,
    prompt: userPromptFor(input),
    maxOutputTokens: 700,
    abortSignal: ctx.signal,
  })
  const parsed = parseJsonObject(text)
  return {
    overallScore: clampScore(Number(parsed.overallScore)),
    questionsAnswered: Number.isFinite(Number(parsed.questionsAnswered))
      ? Math.max(0, Math.round(Number(parsed.questionsAnswered)))
      : 0,
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
  }
}

/**
 * Phase 2 — the slow pass. A stronger model produces the full per-question
 * breakdown, strengths/weaknesses, and a polished summary. This is what takes
 * time, so it runs after the quick summary is already on screen.
 */
async function detailedFeedback(env: Env, ctx: JobContext, input: ScoreInput): Promise<DetailResult> {
  ctx.progress(0.7, 'Writing detailed feedback…')
  const google = createGoogleGenerativeAI({ apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY })
  const system = [
    `You are an expert ${input.role} hiring manager grading a candidate's mock interview transcript.`,
    'Be specific, fair, and constructive. Base every judgement only on what the candidate actually said or wrote.',
    rubricFor(input.interviewType),
    completenessRule,
    hintNote(input),
    'Respond with a SINGLE JSON object and nothing else, matching exactly this shape:',
    '{',
    '  "perQuestion": [{ "question": string, "answer": string, "score": <integer 0-10>, "feedback": string, "betterAnswer": string }],',
    '  "strengths": [string, ...],',
    '  "weaknesses": [string, ...],',
    '  "nonVerbalFeedback": string,',
    '  "resumeFeedback": string,',
    '  "summary": string',
    '}',
    "For each interviewer question, summarize the candidate answer, score it, give pointed feedback, and write a stronger sample answer in the candidate's voice.",
    'Only provide nonVerbalFeedback when Raven supplied an observation. Keep it to 1-2 neutral, actionable sentences about camera presence or delivery; otherwise return an empty string.',
    input.resumeText?.trim()
      ? 'Provide resumeFeedback as 1-2 neutral, evidence-based coaching sentences that connect what the candidate said in the interview to skills or experience they stated in the opted-in resume. Never infer protected or personal characteristics, and do not treat a resume claim as proof. If the transcript does not support a useful connection, return an empty string.'
      : 'Return an empty string for resumeFeedback because no resume context was supplied.',
  ].join('\n')

  const { text } = await generateText({
    model: google(REPORT_MODEL),
    system,
    prompt: userPromptFor(input),
    maxOutputTokens: 4096,
    abortSignal: ctx.signal,
  })
  const parsed = parseJsonObject(text)
  return {
    perQuestion: Array.isArray(parsed.perQuestion) ? (parsed.perQuestion as PerQuestionScore[]) : [],
    strengths: toStringArray(parsed.strengths),
    weaknesses: toStringArray(parsed.weaknesses),
    nonVerbalFeedback: typeof parsed.nonVerbalFeedback === 'string' ? parsed.nonVerbalFeedback.trim() || undefined : undefined,
    resumeFeedback: typeof parsed.resumeFeedback === 'string' ? parsed.resumeFeedback.trim() || undefined : undefined,
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
  }
}

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, Math.round(n)))
}

function toStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

// ── record writes (privileged, via the RecordRoom tools API) ─────────────────

interface Envelope<T> {
  recordId: string
  data: T
  createdBy: string
}

function recordRoom(env: Env) {
  return env.RECORD_ROOMS.get(env.RECORD_ROOMS.idFromName(`app:${env.APP_NAME}`))
}

/**
 * Call the RecordRoom DO's tools API as the app (X-App-Action bypasses
 * per-user RBAC, exactly like server actions / cron). `userId` becomes the
 * stamped owner for userBound columns on create.
 */
async function recordTool<T = unknown>(
  env: Env,
  userId: string,
  tool: string,
  params: Record<string, unknown>,
): Promise<T> {
  const res = await recordRoom(env).fetch(
    new Request('https://internal/api/tools/execute', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Id': userId,
        'X-App-Action': 'true',
      },
      body: JSON.stringify({ tool, params }),
    }),
  )
  const body = (await res.json()) as { success: boolean; data?: T; error?: string }
  if (!body.success) throw new Error(body.error || `RecordRoom ${tool} failed`)
  return body.data as T
}

// ── job entry point ──────────────────────────────────────────────────────────

export async function runJob(job: Job, ctx: JobContext, env: Env): Promise<unknown> {
  if (job.type === 'score-interview') {
    const { interviewId, conversationId } = job.payload as ScorePayload
    ctx.progress(0.05, 'Loading interview…')

    // Read the interview as the app so we get the owner id even though the job
    // has no user identity of its own.
    const got = await recordTool<{
      record: Envelope<{
        role: string
        jobDescription?: string
        interviewType?: InterviewType
        code?: string
        language?: string
        problemTitle?: string
        problem?: string
        hints?: string[]
        hintsUsed?: number
        resumeText?: string
        resumeFollowupConsent?: boolean
      }>
    }>(env, env.OWNER_USER_ID || 'system', 'records.get', {
      collection: 'interviews',
      recordId: interviewId,
    })
    const interview = got.record
    const ownerId = interview.createdBy
    const input: ScoreInput = {
      role: interview.data.role,
      jobDescription: interview.data.jobDescription ?? '',
      interviewType: interview.data.interviewType ?? 'behavioral',
      turns: [],
      code: interview.data.code,
      language: interview.data.language,
      problemTitle: interview.data.problemTitle,
      problem: interview.data.problem,
      hintsUsed: interview.data.hintsUsed,
      totalHints: interview.data.hints?.length,
      resumeText: interview.data.resumeFollowupConsent ? interview.data.resumeText : undefined,
    }

    // Idempotent across retries: if a (partial) report already exists, reuse
    // it and resume at whichever phase is missing — never create a duplicate.
    const existingQ = await recordTool<{ records: Envelope<Report>[] }>(
      env,
      ownerId,
      'records.query',
      { collection: 'reports', where: { interviewId } },
    )
    const existing = existingQ.records[0]

    if (existing?.data.detailed) {
      ctx.progress(1, 'Report ready')
      return { reportId: existing.recordId }
    }

    let reportId = existing?.recordId
    input.turns = (existing?.data.transcript as TranscriptTurn[] | undefined) ?? []

    // ── Phase 1: fast summary (skip if a partial report already exists) ──────
    if (!reportId) {
      const transcript = await pollTranscript(env, ctx, conversationId)
      input.turns = transcript.turns
      input.perceptionAnalysis = transcript.perceptionAnalysis

      // No real answers captured — the call was abandoned before it got going.
      // Retry while attempts remain (the transcript may still be materializing);
      // on the final attempt, mark it 'incomplete' rather than failing the job.
      if (substantiveAnswers(input.turns) === 0) {
        if (job.attempts < job.maxAttempts) {
          throw new Error('Transcript not ready yet — retrying.')
        }
        await recordTool(env, ownerId, 'records.update', {
          collection: 'interviews',
          recordId: interviewId,
          data: { status: 'incomplete' },
        })
        ctx.progress(1, 'Interview too short to score')
        return { incomplete: true }
      }

      const quick = await quickSummary(env, ctx, input)
      const partial: Report = {
        userId: ownerId,
        interviewId,
        role: input.role,
        interviewType: input.interviewType,
        transcript: input.turns,
        overallScore: quick.overallScore,
        questionsAnswered: quick.questionsAnswered,
        expectedQuestions: EXPECTED_QUESTIONS,
        summary: quick.summary,
        detailed: false,
      }
      const created = await recordTool<{ recordId: string }>(env, ownerId, 'records.create', {
        collection: 'reports',
        data: partial,
      })
      reportId = created.recordId
      // Flip to 'scored' now so a score shows in history immediately.
      await recordTool(env, ownerId, 'records.update', {
        collection: 'interviews',
        recordId: interviewId,
        data: { status: 'scored' },
      })
    }

    // ── Phase 2: slow, detailed breakdown — patches the same report row ──────
    const detail = await detailedFeedback(env, ctx, input)
    await recordTool(env, ownerId, 'records.update', {
      collection: 'reports',
      recordId: reportId,
      data: {
        perQuestion: detail.perQuestion,
        strengths: detail.strengths,
        weaknesses: detail.weaknesses,
        nonVerbalFeedback: detail.nonVerbalFeedback,
        resumeFeedback: detail.resumeFeedback,
        summary: detail.summary || undefined,
        detailed: true,
      },
    })

    ctx.progress(1, 'Report ready')
    return { reportId }
  }

  throw new Error(`Unknown job type: ${job.type}`)
}
