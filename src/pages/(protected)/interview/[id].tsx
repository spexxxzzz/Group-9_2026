/**
 * Live interview — the stage. We embed the Tavus avatar call (Daily WebRTC)
 * in an iframe; no LiveKit/Daily SDK needed.
 *
 * On first open of a freshly-created interview we provision the Tavus persona +
 * conversation (billable, signed-in only) and flip the row to 'live'.
 *
 * Recovery: Tavus closes the Daily room shortly after a participant leaves, so
 * a stored conversation_url can be dead when the user returns/reloads ("The
 * meeting has ended"). We probe the real conversation status on mount and show
 * a recovery panel instead of embedding a dead room.
 *
 * "End interview" closes the session, captures the coding pad (if any), marks
 * the row 'ended', and enqueues the background scoring job.
 */

import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useJobs, useMutations, useQuery } from 'deepspace'
import { AlertTriangle, Code2, Lightbulb, Loader2, PhoneOff } from 'lucide-react'
import {
  Button,
  ConfirmModal,
  LoadingSpinner,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useToast,
} from '../../../components/ui'
import { cn } from '../../../components/ui/utils'
import { SCOPE_ID } from '../../../constants'
import {
  startConversation,
  endConversation,
  getConversationState,
  CALL_LIMIT_MINUTES,
} from '../../../lib/tavus'
import type { Interview, InterviewType } from '../../../types'

const LANGUAGES = ['Python', 'JavaScript', 'TypeScript', 'Java', 'C++', 'Go', 'Ruby', 'C#']

const TYPE_LABEL: Record<InterviewType, string> = {
  behavioral: 'Behavioral',
  coding: 'Coding',
  'system-design': 'System design',
}

export default function InterviewLivePage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { records, status } = useQuery<Interview>('interviews')
  const { put } = useMutations<Interview>('interviews')
  const { enqueue } = useJobs(SCOPE_ID)
  const { error: toastError } = useToast()

  const interview = records.find((r) => r.recordId === id)
  const data = interview?.data

  const [provisionError, setProvisionError] = useState<string | null>(null)
  const [confirmEnd, setConfirmEnd] = useState(false)
  const [ending, setEnding] = useState(false)
  const [convEnded, setConvEnded] = useState(false)
  const provisionStarted = useRef(false)
  const stateChecked = useRef(false)

  const isCoding = data?.interviewType === 'coding'
  const [padOpen, setPadOpen] = useState(false)
  const [code, setCode] = useState('')
  const [language, setLanguage] = useState('Python')
  const [hintsUsed, setHintsUsed] = useState(0)

  // Provision the Tavus session once, the first time we see a 'created' row.
  useEffect(() => {
    if (!interview || !data) return
    if (data.status !== 'created' || data.conversationUrl) return
    if (provisionStarted.current) return
    provisionStarted.current = true

    ;(async () => {
      try {
        const conv = await startConversation({
          role: data.role,
          interviewType: data.interviewType,
          difficulty: data.difficulty,
          jobDescription: data.jobDescription,
          // Defense in depth: a resume is never forwarded to an AI service
          // unless this interview row carries explicit candidate consent.
          resumeText: data.resumeFollowupConsent ? data.resumeText : undefined,
          replicaId: data.replicaId,
        })
        await put(interview.recordId, {
          personaId: conv.personaId,
          conversationId: conv.conversationId,
          conversationUrl: conv.conversationUrl,
          status: 'live',
          ...(conv.problem
            ? {
                problemTitle: conv.problem.title,
                problem: conv.problem.statement,
                hints: conv.problem.hints,
              }
            : {}),
        })
      } catch (err) {
        provisionStarted.current = false
        const msg = err instanceof Error ? err.message : String(err)
        setProvisionError(msg)
        toastError('Could not start the interview', msg)
      }
    })()
  }, [interview, data, put, toastError])

  // On returning to a 'live' interview, verify the Daily room is still alive.
  useEffect(() => {
    if (!data || data.status !== 'live' || !data.conversationId || !data.conversationUrl) return
    if (stateChecked.current) return
    stateChecked.current = true
    ;(async () => {
      const state = await getConversationState(data.conversationId!)
      if (state === 'ended') setConvEnded(true)
    })()
  }, [data])

  // If the interview is already done, the report is the right place.
  useEffect(() => {
    if (data && (data.status === 'ended' || data.status === 'scored' || data.status === 'incomplete')) {
      navigate(`/report/${id}`, { replace: true })
    }
  }, [data, id, navigate])

  async function handleEnd() {
    if (!interview || !data?.conversationId) return
    setEnding(true)
    try {
      await endConversation(data.conversationId)
      if (isCoding) {
        await put(interview.recordId, { code, language, hintsUsed })
      }
      const jobId = await enqueue(
        'score-interview',
        { interviewId: interview.recordId, conversationId: data.conversationId },
        { maxAttempts: 3 },
      )
      await put(interview.recordId, { status: 'ended', scoringJobId: jobId })
      navigate(`/report/${interview.recordId}`, { replace: true })
    } catch (err) {
      setEnding(false)
      setConfirmEnd(false)
      toastError('Could not end the interview', err instanceof Error ? err.message : String(err))
    }
  }

  if (status === 'loading') {
    return (
      <CenteredState>
        <LoadingSpinner />
      </CenteredState>
    )
  }

  if (!interview || !data) {
    return (
      <CenteredState>
        <Panel className="max-w-md text-center">
          <AlertTriangle className="mx-auto h-7 w-7 text-warning" />
          <h1 className="mt-3 font-serif text-xl font-semibold text-foreground">Interview not found</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            This interview doesn't exist or isn't yours.
          </p>
          <Button className="mt-5" variant="outline" size="sm" onClick={() => navigate('/home')}>
            Back home
          </Button>
        </Panel>
      </CenteredState>
    )
  }

  const stage = (
    <div className="relative h-full w-full overflow-hidden rounded-3xl border border-border bg-black/60 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.7)]">
      {provisionError ? (
        <ProvisionError
          message={provisionError}
          onRetry={() => {
            setProvisionError(null)
            provisionStarted.current = false
          }}
          onBack={() => navigate('/home')}
        />
      ) : convEnded ? (
        <SessionEnded
          onScore={() => setConfirmEnd(true)}
          onHome={() => navigate('/home')}
          ending={ending}
        />
      ) : data.conversationUrl ? (
        <iframe
          title="AI interviewer"
          src={data.conversationUrl}
          allow="camera; microphone; autoplay; display-capture; fullscreen"
          className="absolute inset-0 h-full w-full"
        />
      ) : (
        <Connecting />
      )}
    </div>
  )

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-5 px-4 py-6 sm:px-6">
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            {data.status === 'live' && !convEnded && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/15 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-destructive">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-destructive" />
                On air
              </span>
            )}
            <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              {TYPE_LABEL[data.interviewType]} interview
            </span>
            {data.status === 'live' && !convEnded && (
              <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                · up to {CALL_LIMIT_MINUTES[data.interviewType]} min
              </span>
            )}
          </div>
          <h1 className="mt-1.5 truncate font-serif text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            {data.role}
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {isCoding
              ? 'Talk through your approach out loud — open the pad when your interviewer says so.'
              : 'Speak naturally and answer out loud, just like the real thing.'}
          </p>
        </div>
        <Button
          variant="destructive"
          onClick={() => setConfirmEnd(true)}
          disabled={!data.conversationId || ending}
        >
          <PhoneOff className="mr-1.5 h-4 w-4" />
          End interview
        </Button>
      </header>

      {isCoding ? (
        <div className="grid min-h-0 flex-1 gap-5 lg:grid-cols-2">
          <div className="min-h-[260px]">{stage}</div>
          <div className="flex min-h-0 flex-col gap-5">
            <ProblemPanel
              title={data.problemTitle}
              statement={data.problem}
              hints={data.hints}
              revealed={hintsUsed}
              onReveal={() => setHintsUsed((h) => Math.min(data.hints?.length ?? 0, h + 1))}
            />
            <CodePad
              open={padOpen}
              onOpen={() => setPadOpen(true)}
              code={code}
              onChange={setCode}
              language={language}
              onLanguageChange={setLanguage}
            />
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1">{stage}</div>
      )}

      <ConfirmModal
        open={confirmEnd}
        onClose={() => setConfirmEnd(false)}
        onConfirm={handleEnd}
        title="End this interview?"
        description="We'll close the call and generate your scored feedback report. You can't resume afterward."
        confirmText="End & score"
        variant="destructive"
        loading={ending}
      />
    </div>
  )
}

function Connecting() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
      <Loader2 className="h-7 w-7 animate-spin text-primary" />
      <div>
        <p className="text-sm font-medium text-foreground">Connecting you to your interviewer…</p>
        <p className="text-xs text-muted-foreground">Briefing the AI and starting the video call.</p>
      </div>
    </div>
  )
}

function SessionEnded({
  onScore,
  onHome,
  ending,
}: {
  onScore: () => void
  onHome: () => void
  ending: boolean
}) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
      <PhoneOff className="h-8 w-8 text-muted-foreground" />
      <div>
        <p className="text-base font-semibold text-foreground">This call has ended</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
          The video session closed. You can score what you covered, or start a fresh interview.
        </p>
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={onScore} loading={ending}>
          Score this session
        </Button>
        <Button size="sm" variant="outline" onClick={onHome}>
          Back home
        </Button>
      </div>
    </div>
  )
}

function ProvisionError({
  message,
  onRetry,
  onBack,
}: {
  message: string
  onRetry: () => void
  onBack: () => void
}) {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-6">
      <div className="max-w-md text-center">
        <AlertTriangle className="mx-auto h-7 w-7 text-warning" />
        <h2 className="mt-3 font-serif text-lg font-semibold text-foreground">Couldn't start the call</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">{message}</p>
        <div className="mt-5 flex justify-center gap-2">
          <Button size="sm" onClick={onRetry}>
            Try again
          </Button>
          <Button size="sm" variant="outline" onClick={onBack}>
            Back home
          </Button>
        </div>
      </div>
    </div>
  )
}

function ProblemPanel({
  title,
  statement,
  hints,
  revealed,
  onReveal,
}: {
  title?: string
  statement?: string
  hints?: string[]
  revealed: number
  onReveal: () => void
}) {
  const total = hints?.length ?? 0

  if (!statement) {
    return (
      <div className="flex max-h-[45%] shrink-0 items-center gap-2.5 rounded-3xl border border-border bg-card px-5 py-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Preparing your problem…
      </div>
    )
  }

  return (
    <div className="flex max-h-[46%] shrink-0 flex-col overflow-hidden rounded-3xl border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border px-5 py-3">
        <h2 className="truncate font-serif text-base font-semibold text-foreground">
          {title || 'Coding problem'}
        </h2>
        {total > 0 && (
          <button
            onClick={onReveal}
            disabled={revealed >= total}
            title="Using hints lowers your score"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
          >
            <Lightbulb className="h-3.5 w-3.5" />
            {revealed >= total ? 'No more hints' : `Hint ${revealed + 1} of ${total}`}
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{statement}</p>
        {revealed > 0 && (
          <div className="space-y-2 pt-1">
            {hints?.slice(0, revealed).map((h, i) => (
              <div
                key={i}
                className="flex gap-2 rounded-2xl border border-primary/20 bg-primary/[0.06] px-3.5 py-2.5 text-sm leading-relaxed text-foreground"
              >
                <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span>
                  <span className="font-medium">Hint {i + 1}.</span> {h}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function CodePad({
  open,
  onOpen,
  code,
  onChange,
  language,
  onLanguageChange,
}: {
  open: boolean
  onOpen: () => void
  code: string
  onChange: (v: string) => void
  language: string
  onLanguageChange: (v: string) => void
}) {
  if (!open) {
    return (
      <div className="flex min-h-[260px] flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-border bg-card/40 p-6 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/15">
          <Lightbulb className="h-5 w-5 text-primary" />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">Talk through your approach first</p>
          <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">
            Walk the interviewer through your plan, edge cases, and complexity. They'll tell you when
            to start writing code.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={onOpen}>
          <Code2 className="mr-1.5 h-4 w-4" />
          Open code pad
        </Button>
      </div>
    )
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Tab') return
    e.preventDefault()
    const el = e.currentTarget
    const { selectionStart, selectionEnd } = el
    const next = code.slice(0, selectionStart) + '  ' + code.slice(selectionEnd)
    onChange(next)
    requestAnimationFrame(() => {
      el.selectionStart = el.selectionEnd = selectionStart + 2
    })
  }

  return (
    <div className="flex min-h-[260px] flex-col overflow-hidden rounded-3xl border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Code2 className="h-3.5 w-3.5" />
          Code pad
        </span>
        <Select value={language} onValueChange={onLanguageChange}>
          <SelectTrigger className="h-7 w-36 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LANGUAGES.map((l) => (
              <SelectItem key={l} value={l}>
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <textarea
        value={code}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        spellCheck={false}
        placeholder={`# Write your ${language} solution here…`}
        className="min-h-0 flex-1 resize-none bg-transparent p-4 font-mono text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/50"
      />
    </div>
  )
}

function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-3xl border border-border bg-card p-7', className)}>{children}</div>
  )
}

function CenteredState({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full items-center justify-center p-6">{children}</div>
}
