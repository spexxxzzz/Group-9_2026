/**
 * Home — the stage. Signed-out visitors get an editorial hero + how-it-works;
 * signed-in users get the interview setup panel and their past interviews.
 */

import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AuthOverlay, useAuth, useMutations, useQuery, type RecordData } from 'deepspace'
import AccountControl from '../components/AccountControl'
import { fetchInterviewers, type InterviewerOption } from '../lib/tavus'
import { extractResumeText } from '../lib/resume'
import {
  ArrowRight,
  ArrowUpRight,
  Code2,
  FileText,
  Loader2,
  MessagesSquare,
  Mic,
  Network,
  Trash2,
  Video,
} from 'lucide-react'
import {
  Button,
  Checkbox,
  ConfirmModal,
  EmptyState,
  Input,
  Label,
  SkeletonList,
  Textarea,
  useToast,
} from '../components/ui'
import { cn } from '../components/ui/utils'
import type { Difficulty, Interview, InterviewStatus, InterviewType, Report } from '../types'

const QUICK_ROLES = [
  'Senior Product Manager',
  'Frontend Engineer',
  'Data Scientist',
  'Engineering Manager',
  'UX Designer',
  'Solutions Architect',
]

const INTERVIEW_TYPES: { value: InterviewType; label: string; hint: string; icon: typeof Code2 }[] = [
  { value: 'behavioral', label: 'Behavioral', hint: 'Stories & past experience', icon: MessagesSquare },
  { value: 'coding', label: 'Coding', hint: 'Solve a problem on a pad', icon: Code2 },
  { value: 'system-design', label: 'System design', hint: 'Architect out loud', icon: Network },
]

const LEVELS: { value: Difficulty; label: string }[] = [
  { value: 'intern', label: 'Intern' },
  { value: 'junior', label: 'Junior' },
  { value: 'mid', label: 'Mid' },
  { value: 'senior', label: 'Senior' },
  { value: 'staff', label: 'Staff+' },
]

const STATUS_BADGE: Record<InterviewStatus, { label: string; tone: string }> = {
  created: { label: 'Not started', tone: 'text-muted-foreground bg-muted' },
  live: { label: 'Live', tone: 'text-primary bg-primary/15' },
  ended: { label: 'Scoring', tone: 'text-warning bg-warning/15' },
  scored: { label: 'Scored', tone: 'text-success bg-success/15' },
  incomplete: { label: 'Too short', tone: 'text-muted-foreground bg-muted' },
}

const TYPE_LABEL: Record<InterviewType, string> = {
  behavioral: 'Behavioral',
  coding: 'Coding',
  'system-design': 'System design',
}

export default function Home() {
  const { isSignedIn, isLoaded } = useAuth()

  return (
    <div className="mx-auto w-full max-w-6xl px-5 sm:px-8">
      <HomeHeader />
      <div className="pb-16 pt-8 lg:pt-12">
        {!isLoaded ? (
          <div className="space-y-6">
            <SkeletonList />
          </div>
        ) : isSignedIn ? (
          <SignedInHome />
        ) : (
          <Landing />
        )}
      </div>
    </div>
  )
}

function HomeHeader() {
  return (
    <header
      data-testid="app-navigation"
      className="flex items-center justify-between py-5"
    >
      <Link to="/home" className="flex items-center gap-2.5">
        <img src="/favicon.svg" alt="" className="h-7 w-7 rounded-lg" />
        <span className="font-serif text-xl font-semibold tracking-tight text-foreground">Dialogue</span>
      </Link>
      <AccountControl />
    </header>
  )
}

// ── signed-out ───────────────────────────────────────────────────────────────

function Landing() {
  const [showAuth, setShowAuth] = useState(false)
  const steps = [
    { icon: Mic, title: 'Pick your role', body: 'Name the role, pick the format and level, paste a job description.' },
    { icon: Video, title: 'Take the call', body: 'A live AI interviewer asks, listens, and follows up — out loud.' },
    { icon: ArrowRight, title: 'Get your report', body: 'A scored breakdown: per-question feedback and stronger answers.' },
  ]
  return (
    <div className="flex flex-col items-center text-center">
      <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card/70 px-3.5 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur">
        <span className="h-1.5 w-1.5 rounded-full bg-primary" />
        Practice with a live AI interviewer
      </span>
      <h1 className="mt-7 max-w-4xl font-serif text-5xl font-semibold leading-[1.02] tracking-tight text-foreground sm:text-6xl lg:text-7xl">
        Practice the interview <span className="italic text-muted-foreground">before it counts.</span>
      </h1>
      <p className="mt-6 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
        Sit down with an AI interviewer tuned to your target role. Answer out loud, field follow-ups,
        and walk away with a scored report on exactly what to fix.
      </p>
      <div className="mt-9">
        <Button size="lg" onClick={() => setShowAuth(true)}>
          Try a mock interview
          <ArrowRight className="ml-1.5 h-4 w-4" />
        </Button>
      </div>
      {showAuth && <AuthOverlay onClose={() => setShowAuth(false)} />}

      <div className="mt-16 grid w-full gap-px overflow-hidden rounded-3xl border border-border bg-border sm:grid-cols-3">
        {steps.map((s, i) => (
          <div key={s.title} className="bg-card p-7 text-left">
            <div className="flex items-center gap-3">
              <span className="font-serif text-2xl font-semibold text-primary tabular-nums">
                {String(i + 1).padStart(2, '0')}
              </span>
              <s.icon className="h-4 w-4 text-muted-foreground" />
            </div>
            <h3 className="mt-4 text-base font-semibold text-foreground">{s.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── signed-in ──────────────────────────────────────────────────────────────

function SignedInHome() {
  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-14">
      <NewInterviewForm />
      <PastInterviews />
    </div>
  )
}

function NewInterviewForm() {
  const navigate = useNavigate()
  const { create } = useMutations<Interview>('interviews')
  const { error: toastError } = useToast()
  const [role, setRole] = useState('')
  const [interviewType, setInterviewType] = useState<InterviewType>('behavioral')
  const [difficulty, setDifficulty] = useState<Difficulty>('mid')
  const [jobDescription, setJobDescription] = useState('')
  const [resumeText, setResumeText] = useState('')
  const [resumeFileName, setResumeFileName] = useState('')
  const [resumeConsent, setResumeConsent] = useState(false)
  const [resumeParsing, setResumeParsing] = useState(false)
  const [resumeError, setResumeError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const [interviewers, setInterviewers] = useState<InterviewerOption[] | null>(null)
  const [interviewerId, setInterviewerId] = useState<string | null>(null)

  // Load the interviewer gallery once; default to the first one.
  useEffect(() => {
    let alive = true
    fetchInterviewers()
      .then((list) => {
        if (!alive) return
        setInterviewers(list)
        setInterviewerId((cur) => cur ?? list[0]?.id ?? null)
      })
      .catch(() => alive && setInterviewers([]))
    return () => {
      alive = false
    }
  }, [])

  const canStart = role.trim().length > 1 && !creating

  async function handleResumeChange(file?: File) {
    setResumeConsent(false)
    setResumeError(null)
    setResumeText('')
    setResumeFileName('')
    if (!file) return

    setResumeParsing(true)
    try {
      const text = await extractResumeText(file)
      setResumeText(text)
      setResumeFileName(file.name)
    } catch (err) {
      setResumeError(err instanceof Error ? err.message : 'Could not read that resume.')
    } finally {
      setResumeParsing(false)
    }
  }

  async function handleStart() {
    if (!canStart) return
    setCreating(true)
    try {
      const chosen = interviewers?.find((i) => i.id === interviewerId)
      const id = await create({
        userId: '', // stamped server-side (userBound)
        role: role.trim(),
        interviewType,
        difficulty,
        replicaId: chosen?.id,
        replicaName: chosen?.name,
        jobDescription: jobDescription.trim() || undefined,
        ...(resumeText && resumeConsent
          ? {
              resumeText,
              resumeFileName,
              resumeFollowupConsent: true,
            }
          : {}),
        status: 'created',
      })
      navigate(`/interview/${id}`)
    } catch (err) {
      setCreating(false)
      toastError('Could not start interview', err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <section>
      <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
        New interview
      </p>
      <h1 className="mt-2 font-serif text-3xl font-semibold tracking-tight text-foreground">
        Set up your session
      </h1>

      <div className="mt-7 space-y-7">
        <div className="space-y-2.5">
          <Label htmlFor="role">Role you're practicing for</Label>
          <Input
            id="role"
            placeholder="e.g. Senior Product Manager"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            autoComplete="off"
            className="h-11"
          />
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {QUICK_ROLES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                  role === r
                    ? 'border-primary/40 bg-primary/15 text-primary'
                    : 'border-border text-muted-foreground hover:border-primary/30 hover:text-foreground',
                )}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2.5">
          <Label>Format</Label>
          <div className="grid grid-cols-3 gap-2.5">
            {INTERVIEW_TYPES.map((t) => {
              const active = interviewType === t.value
              return (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setInterviewType(t.value)}
                  aria-pressed={active}
                  className={cn(
                    'group flex flex-col gap-2 rounded-2xl border p-3.5 text-left transition-all',
                    active
                      ? 'border-primary/60 bg-primary/10 shadow-[0_0_0_1px_rgba(255,255,255,0.18)]'
                      : 'border-border bg-card/40 hover:border-border hover:bg-card',
                  )}
                >
                  <t.icon className={cn('h-5 w-5', active ? 'text-primary' : 'text-muted-foreground')} />
                  <div>
                    <div className="text-sm font-medium text-foreground">{t.label}</div>
                    <div className="text-[11px] leading-tight text-muted-foreground">{t.hint}</div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        <div className="space-y-2.5">
          <Label>Level</Label>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {LEVELS.map((l) => {
              const active = difficulty === l.value
              return (
                <button
                  key={l.value}
                  type="button"
                  onClick={() => setDifficulty(l.value)}
                  aria-pressed={active}
                  className={cn(
                    'rounded-xl border py-2 text-sm font-medium transition-all',
                    active
                      ? 'border-primary/60 bg-primary/10 text-foreground'
                      : 'border-border bg-card/40 text-muted-foreground hover:text-foreground',
                  )}
                >
                  {l.label}
                </button>
              )
            })}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Sets how hard the questions{interviewType === 'coding' ? ' and coding problem' : ''} get.
          </p>
        </div>

        <div className="space-y-2.5">
          <Label>Interviewer</Label>
          <InterviewerPicker
            interviewers={interviewers}
            selected={interviewerId}
            onSelect={setInterviewerId}
          />
        </div>

        <div className="space-y-2.5">
          <Label htmlFor="jd">
            Job description <span className="font-normal text-muted-foreground">— optional</span>
          </Label>
          <Textarea
            id="jd"
            placeholder="Paste the job description to tailor the questions…"
            value={jobDescription}
            onChange={(e) => setJobDescription(e.target.value)}
            rows={5}
          />
        </div>

        <div className="space-y-2.5">
          <Label htmlFor="resume">
            Resume <span className="font-normal text-muted-foreground">— optional</span>
          </Label>
          <label
            htmlFor="resume"
            className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-border bg-card/40 px-4 py-3 text-sm transition-colors hover:border-primary/40 hover:bg-card"
          >
            {resumeParsing ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
            ) : (
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {resumeFileName || 'Choose a PDF or .txt resume'}
            </span>
            <span className="text-xs font-medium text-primary">Browse</span>
          </label>
          <input
            id="resume"
            type="file"
            accept="application/pdf,.pdf,text/plain,.txt"
            className="sr-only"
            onChange={(event) => void handleResumeChange(event.target.files?.[0])}
          />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            The original file stays on this device. We extract its text locally; it is not used or saved unless you opt in below.
          </p>
          {resumeError && <p className="text-xs text-destructive">{resumeError}</p>}
          {resumeText && !resumeParsing && (
            <div className="flex items-start gap-2.5 rounded-xl border border-primary/25 bg-primary/5 px-3.5 py-3">
              <Checkbox
                id="resume-consent"
                checked={resumeConsent}
                onCheckedChange={(checked) => setResumeConsent(checked === true)}
                className="mt-0.5"
              />
              <Label htmlFor="resume-consent" className="cursor-pointer text-xs font-normal leading-relaxed text-foreground">
                I allow the AI interviewer and feedback report to use this resume for tailored questions, follow-ups, and coaching.
              </Label>
            </div>
          )}
        </div>

        <Button
          className="h-11 w-full text-sm"
          onClick={handleStart}
          loading={creating}
          disabled={!canStart}
        >
          Start interview
          <ArrowRight className="ml-1.5 h-4 w-4" />
        </Button>
      </div>
    </section>
  )
}

function InterviewerPicker({
  interviewers,
  selected,
  onSelect,
}: {
  interviewers: InterviewerOption[] | null
  selected: string | null
  onSelect: (id: string) => void
}) {
  // Loading.
  if (interviewers === null) {
    return (
      <div className="flex gap-2.5 overflow-hidden">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-16 w-16 shrink-0 animate-pulse rounded-2xl bg-muted" />
        ))}
      </div>
    )
  }
  // No gallery available — we'll auto-pick a stock interviewer at start.
  if (interviewers.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        We'll pick an interviewer for you when the call starts.
      </p>
    )
  }
  return (
    <div className="flex gap-2.5 overflow-x-auto pb-1">
      {interviewers.map((iv) => {
        const active = selected === iv.id
        return (
          <button
            key={iv.id}
            type="button"
            onClick={() => onSelect(iv.id)}
            aria-pressed={active}
            title={iv.name}
            className="group flex shrink-0 flex-col items-center gap-1.5"
          >
            <span
              className={cn(
                'h-16 w-16 overflow-hidden rounded-2xl border-2 transition-all',
                active ? 'border-primary' : 'border-transparent group-hover:border-border',
              )}
            >
              <img src={iv.thumbnail} alt={iv.name} className="h-full w-full object-cover" />
            </span>
            <span
              className={cn(
                'max-w-[64px] truncate text-[11px]',
                active ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {iv.name}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function PastInterviews() {
  const navigate = useNavigate()
  const { error: toastError, success } = useToast()
  const { records: interviews, status } = useQuery<Interview>('interviews', {
    orderBy: 'createdAt',
    orderDir: 'desc',
  })
  const { records: reports } = useQuery<Report>('reports')
  const { remove: removeInterview } = useMutations<Interview>('interviews')
  const { remove: removeReport } = useMutations<Report>('reports')

  const [pendingDelete, setPendingDelete] = useState<RecordData<Interview> | null>(null)
  const [deleting, setDeleting] = useState(false)

  const scoreByInterview = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of reports) map.set(r.data.interviewId, r.data.overallScore)
    return map
  }, [reports])

  const reportIdByInterview = useMemo(() => {
    const map = new Map<string, string>()
    for (const r of reports) map.set(r.data.interviewId, r.recordId)
    return map
  }, [reports])

  async function handleDelete() {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      const reportId = reportIdByInterview.get(pendingDelete.recordId)
      if (reportId) await removeReport(reportId)
      await removeInterview(pendingDelete.recordId)
      success('Interview deleted')
      setPendingDelete(null)
    } catch (err) {
      toastError('Could not delete', err instanceof Error ? err.message : String(err))
    } finally {
      setDeleting(false)
    }
  }

  const scored = interviews.filter((iv) => typeof scoreByInterview.get(iv.recordId) === 'number')
  const avg = scored.length
    ? Math.round(
        scored.reduce((s, iv) => s + (scoreByInterview.get(iv.recordId) ?? 0), 0) / scored.length,
      )
    : null

  return (
    <section className="lg:border-l lg:border-border lg:pl-14">
      <div className="flex items-baseline justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
            Your interviews
          </p>
          <h2 className="mt-2 font-serif text-3xl font-semibold tracking-tight text-foreground">
            History
          </h2>
        </div>
        {avg !== null && (
          <div className="text-right">
            <div className="font-serif text-3xl font-semibold text-primary tabular-nums">{avg}</div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">avg score</div>
          </div>
        )}
      </div>

      <div className="mt-7">
        {status === 'loading' ? (
          <SkeletonList />
        ) : interviews.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card/30 p-2">
            <EmptyState
              icon={<Video className="h-6 w-6" />}
              title="No interviews yet"
              description="Start one on the left and it'll show up here."
            />
          </div>
        ) : (
          <ul className="space-y-2">
            {interviews.map((iv) => (
              <InterviewRow
                key={iv.recordId}
                interview={iv}
                score={scoreByInterview.get(iv.recordId)}
                onOpen={() =>
                  navigate(
                    iv.data.status === 'created' || iv.data.status === 'live'
                      ? `/interview/${iv.recordId}`
                      : `/report/${iv.recordId}`,
                  )
                }
                onDelete={() => setPendingDelete(iv)}
              />
            ))}
          </ul>
        )}
      </div>

      <ConfirmModal
        open={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        onConfirm={handleDelete}
        title={pendingDelete ? `Delete "${pendingDelete.data.role}" interview?` : 'Delete interview?'}
        description="This removes the interview and its scored report for good. This can't be undone."
        confirmText="Delete"
        variant="destructive"
        loading={deleting}
      />
    </section>
  )
}

function InterviewRow({
  interview,
  score,
  onOpen,
  onDelete,
}: {
  interview: RecordData<Interview>
  score?: number
  onOpen: () => void
  onDelete: () => void
}) {
  const { role, status, interviewType } = interview.data
  const badge = STATUS_BADGE[status]
  const date = new Date(interview.createdAt).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })

  return (
    <li className="group relative flex items-center gap-3 rounded-2xl border border-border bg-card/40 pr-2.5 transition-all hover:border-primary/30 hover:bg-card">
      <button onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-4 py-3.5 pl-4 text-left">
        {typeof score === 'number' ? (
          <div className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-xl bg-primary/10">
            <span className="font-serif text-base font-semibold leading-none text-primary tabular-nums">
              {score}
            </span>
          </div>
        ) : (
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-muted">
            <Video className="h-4 w-4 text-muted-foreground" />
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-foreground">{role}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>{TYPE_LABEL[interviewType ?? 'behavioral']}</span>
            <span className="text-border">·</span>
            <span>{date}</span>
          </div>
        </div>

        <span className={cn('shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium', badge.tone)}>
          {badge.label}
        </span>
        <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground" />
      </button>

      <button
        onClick={onDelete}
        aria-label={`Delete ${role} interview`}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground opacity-0 transition-all hover:bg-destructive/15 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </li>
  )
}
