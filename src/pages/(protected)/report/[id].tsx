/**
 * Report — the scored feedback for one interview (id = interviewId).
 *
 * While the scoring job runs we show live progress from the JobRoom WebSocket
 * (useJobs). Once the `reports` row lands we render the score ring, strengths /
 * weaknesses, a per-question breakdown with stronger sample answers, and the
 * full transcript. 'incomplete' interviews get a calm too-short state.
 */

import { useNavigate, useParams } from 'react-router-dom'
import { useJobs, useQuery } from 'deepspace'
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Download,
  Loader2,
  Minus,
  MessageSquare,
  RotateCcw,
} from 'lucide-react'
import {
  Button,
  Progress,
  SkeletonText,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '../../../components/ui'
import { cn } from '../../../components/ui/utils'
import { SCOPE_ID } from '../../../constants'
import { BEHAVIORAL_CRITERIA, behavioralAverage, RUBRIC_GRADE_LABELS } from '../../../lib/behavioral-rubric'
import type { Interview, InterviewType, PerQuestionScore, Report, TranscriptTurn } from '../../../types'

const TYPE_LABEL: Record<InterviewType, string> = {
  behavioral: 'Behavioral',
  coding: 'Coding',
  'system-design': 'System design',
}

/** Score → semantic tone class. */
function tone(score: number, max = 100): 'success' | 'warning' | 'destructive' {
  const pct = (score / max) * 100
  if (pct >= 75) return 'success'
  if (pct >= 50) return 'warning'
  return 'destructive'
}
const TONE_TEXT = { success: 'text-success', warning: 'text-warning', destructive: 'text-destructive' }
const TONE_STROKE = { success: 'var(--color-success)', warning: 'var(--color-warning)', destructive: 'var(--color-destructive)' }

export default function ReportPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()

  const { records: interviews, status: ivStatus } = useQuery<Interview>('interviews')
  const { records: reports, status: rpStatus } = useQuery<Report>('reports', {
    where: { interviewId: id },
  })
  const { getJob, retry } = useJobs(SCOPE_ID)

  const interview = interviews.find((r) => r.recordId === id)
  const report = reports[0]
  const job = interview?.data.scoringJobId ? getJob(interview.data.scoringJobId) : undefined
  const loading = ivStatus === 'loading' || rpStatus === 'loading'

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-9 sm:px-6">
      <button
        onClick={() => navigate('/home')}
        className="mb-7 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        All interviews
      </button>

      {loading ? (
        <SkeletonText lines={6} />
      ) : !interview ? (
        <Centered
          icon={<AlertTriangle className="h-7 w-7 text-warning" />}
          title="Report not found"
          body="This interview doesn't exist or isn't yours."
          action={{ label: 'Back home', onClick: () => navigate('/home') }}
        />
      ) : report ? (
        <ReportView interview={interview.data} report={report.data} />
      ) : interview.data.status === 'incomplete' ? (
        <Centered
          icon={<MessageSquare className="h-7 w-7 text-muted-foreground" />}
          title="Interview too short to score"
          body="This call ended before you answered any questions, so there's nothing to grade. Start a fresh interview whenever you're ready."
          action={{ label: 'Start a new interview', onClick: () => navigate('/home') }}
        />
      ) : job?.status === 'failed' ? (
        <Centered
          icon={<AlertTriangle className="h-7 w-7 text-destructive" />}
          title="Scoring failed"
          body={job.error || 'The scoring job failed.'}
          action={{ label: 'Retry scoring', icon: <RotateCcw className="mr-1.5 h-4 w-4" />, onClick: () => retry(job.id) }}
        />
      ) : (
        <ScoringProgress
          progress={job?.progress ?? 0.05}
          message={job?.progressMessage ?? 'Preparing your report…'}
        />
      )}
    </div>
  )
}

// ── states ───────────────────────────────────────────────────────────────────

function ScoringProgress({ progress, message }: { progress: number; message: string }) {
  const pct = Math.round(progress * 100)
  return (
    <div className="rounded-3xl border border-border bg-card p-9 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/15">
        <MessageSquare className="h-6 w-6 text-primary" />
      </div>
      <h1 className="mt-4 font-serif text-2xl font-semibold tracking-tight text-foreground">
        Reviewing the tape
      </h1>
      <p className="mt-1.5 text-sm text-muted-foreground">{message}</p>
      <div className="mx-auto mt-6 max-w-sm space-y-1.5">
        <Progress value={pct} />
        <p className="text-xs text-muted-foreground tabular-nums">{pct}%</p>
      </div>
      <p className="mx-auto mt-5 max-w-sm text-xs leading-relaxed text-muted-foreground">
        Fetching the transcript and grading each answer takes a minute. You can leave — it'll be
        here when you get back.
      </p>
    </div>
  )
}

function Centered({
  icon,
  title,
  body,
  action,
}: {
  icon: React.ReactNode
  title: string
  body: string
  action: { label: string; icon?: React.ReactNode; onClick: () => void }
}) {
  return (
    <div className="rounded-3xl border border-border bg-card p-9 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center">{icon}</div>
      <h1 className="mt-3 font-serif text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
      <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-muted-foreground">{body}</p>
      <Button className="mt-6" size="sm" onClick={action.onClick}>
        {action.icon}
        {action.label}
      </Button>
    </div>
  )
}

// ── report ───────────────────────────────────────────────────────────────────

function ReportView({ interview, report }: { interview: Interview; report: Report }) {
  return (
    <div className="space-y-8">
      <ScoreHeader
        interview={interview}
        report={report}
        pending={!report.detailed}
        onDownload={() => {
          void import('../../../lib/report-pdf').then(({ downloadReportPdf }) => {
            downloadReportPdf({ interview, report })
          })
        }}
      />

      {report.behavioralRubric?.length ? <BehavioralRubricTable report={report} /> : null}

      {(!!report.strengths?.length || !!report.weaknesses?.length) && (
        <div className="grid gap-4 sm:grid-cols-2">
          <PointsCard title="Strengths" points={report.strengths} tone="success" />
          <PointsCard title="Areas to improve" points={report.weaknesses} tone="destructive" />
        </div>
      )}

      {report.nonVerbalFeedback && (
        <div className="rounded-2xl border border-border bg-card px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">Camera and delivery observations</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{report.nonVerbalFeedback}</p>
        </div>
      )}

      {report.resumeFeedback && (
        <div className="rounded-2xl border border-border bg-card px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">Resume-informed feedback</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{report.resumeFeedback}</p>
        </div>
      )}

      <Tabs defaultValue="breakdown">
        <TabsList>
          <TabsTrigger value="breakdown">Question breakdown</TabsTrigger>
          <TabsTrigger value="transcript">Transcript</TabsTrigger>
        </TabsList>
        <TabsContent value="breakdown" className="mt-5 space-y-4">
          {report.perQuestion?.length ? (
            report.perQuestion.map((q, i) => <QuestionCard key={i} index={i} q={q} showScore={!report.behavioralRubric?.length} />)
          ) : report.detailed ? (
            <p className="text-sm text-muted-foreground">No per-question breakdown available.</p>
          ) : (
            <DetailPending />
          )}
        </TabsContent>
        <TabsContent value="transcript" className="mt-5">
          <TranscriptView turns={report.transcript} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function BehavioralRubricTable({ report }: { report: Report }) {
  const rows = report.behavioralRubric ?? []
  const average = behavioralAverage(rows)
  return (
    <section className="overflow-hidden rounded-3xl border border-border bg-card">
      <div className="px-5 py-5 sm:px-6">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-primary">Behavioral assessment</p>
        <h2 className="mt-1 font-serif text-xl font-semibold text-foreground">Interview rubric</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Selected level: {average.toFixed(1)} / 4. Applicable rows are weighted equally; 1 maps to 0 and 4 maps to 100. Unavailable observations do not lower your score.
        </p>
      </div>
      <div className="overflow-x-auto border-t border-border">
        <table className="w-full min-w-[900px] border-collapse text-left text-xs">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              <th className="w-40 px-4 py-3 font-semibold">Criterion</th>
              {RUBRIC_GRADE_LABELS.map((label, index) => (
                <th key={label} className="w-[17%] px-3 py-3 font-semibold">{index + 1} · {label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {BEHAVIORAL_CRITERIA.map((criterion) => {
              const row = rows.find((item) => item.id === criterion.id)
              if (!row) return null
              return (
                <tr key={criterion.id} className="border-t border-border align-top">
                  <th className="px-4 py-4 font-semibold leading-relaxed text-foreground">
                    {criterion.label}
                    {row.grade === null && <span className="mt-1 block text-[11px] font-normal text-muted-foreground">Not assessed</span>}
                    <span className="mt-2 block text-[11px] font-normal leading-relaxed text-muted-foreground">{row.justification}</span>
                    {row.evidence && <span className="mt-2 block text-[11px] font-normal italic leading-relaxed text-foreground">Evidence: {row.evidence}</span>}
                  </th>
                  {criterion.anchors.map((anchor, index) => (
                    <td
                      key={index}
                      className={cn(
                        'px-3 py-4 leading-relaxed text-muted-foreground',
                        row.grade === index + 1 && 'bg-primary/10 font-medium text-foreground ring-1 ring-inset ring-primary/40',
                      )}
                    >
                      {row.grade === index + 1 && <span className="mb-1 block font-semibold text-primary">✓ Selected</span>}
                      {anchor}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="px-5 py-3 text-[11px] leading-relaxed text-muted-foreground sm:px-6">
        Adapted from Princeton University Center for Career Development’s interview rubric. Visible engagement is graded only when reliable camera observations are available.
      </p>
    </section>
  )
}

function ScoreRing({ score }: { score: number }) {
  const r = 50
  const c = 2 * Math.PI * r
  const t = tone(score)
  const offset = c * (1 - Math.max(0, Math.min(100, score)) / 100)
  return (
    <div className="relative h-32 w-32 shrink-0">
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
        <circle cx="60" cy="60" r={r} fill="none" stroke="var(--color-muted)" strokeWidth="8" />
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke={TONE_STROKE[t]}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 900ms cubic-bezier(0.22,1,0.36,1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cn('font-serif text-4xl font-semibold leading-none tabular-nums', TONE_TEXT[t])}>
          {score}
        </span>
        <span className="mt-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">/ 100</span>
      </div>
    </div>
  )
}

function ScoreHeader({
  interview,
  report,
  pending,
  onDownload,
}: {
  interview: Interview
  report: Report
  pending?: boolean
  onDownload: () => void
}) {
  const answered = report.questionsAnswered
  const expected = report.expectedQuestions
  const partial = typeof answered === 'number' && typeof expected === 'number' && answered < expected
  return (
    <div className="rounded-3xl border border-border bg-card p-7 shadow-[0_20px_50px_-24px_rgba(0,0,0,0.7)]">
      <div className="mb-4 flex justify-end">
        <Button variant="outline" size="sm" onClick={onDownload}>
          <Download className="mr-1.5 h-4 w-4" />
          Download PDF
        </Button>
      </div>
      <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center">
        <ScoreRing score={report.overallScore} />
        <div className="min-w-0 flex-1 text-center sm:text-left">
          <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
            <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              {TYPE_LABEL[interview.interviewType] ?? 'Interview'} · {interview.role}
            </span>
            {typeof answered === 'number' && typeof expected === 'number' && (
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-[11px] font-medium',
                  partial ? 'bg-warning/15 text-warning' : 'bg-muted text-muted-foreground',
                )}
              >
                {answered} of {expected} answered
              </span>
            )}
            {interview.interviewType === 'coding' && typeof interview.hintsUsed === 'number' && (
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-[11px] font-medium',
                  interview.hintsUsed > 0 ? 'bg-warning/15 text-warning' : 'bg-success/15 text-success',
                )}
              >
                {interview.hintsUsed === 0
                  ? 'No hints used'
                  : `${interview.hintsUsed} hint${interview.hintsUsed > 1 ? 's' : ''} used`}
              </span>
            )}
          </div>
          <h1 className="mt-2 font-serif text-2xl font-semibold tracking-tight text-foreground">
            {report.overallScore >= 75 ? 'Strong showing' : report.overallScore >= 50 ? 'Solid, with gaps' : 'Room to grow'}
          </h1>
          {partial && (
            <p className="mt-1 text-xs text-warning">
              You ended early — the score reflects an incomplete interview.
            </p>
          )}
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {report.summary || 'Interview scored.'}
          </p>
          {pending && (
            <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Detailed feedback is still generating…
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function DetailPending() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-border bg-card/40 py-12 text-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      <div>
        <p className="text-sm font-medium text-foreground">Writing your detailed breakdown</p>
        <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">
          Your score and summary are ready above. The per-question feedback and stronger sample
          answers land here in a moment.
        </p>
      </div>
    </div>
  )
}

function PointsCard({
  title,
  points,
  tone,
}: {
  title: string
  points?: string[]
  tone: 'success' | 'destructive'
}) {
  if (!points?.length) return null
  const Icon = tone === 'success' ? Check : Minus
  return (
    <div className="rounded-3xl border border-border bg-card p-5">
      <h3 className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">{title}</h3>
      <ul className="mt-3 space-y-2.5">
        {points.map((p, i) => (
          <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-foreground">
            <span
              className={cn(
                'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full',
                tone === 'success' ? 'bg-success/15 text-success' : 'bg-destructive/15 text-destructive',
              )}
            >
              <Icon className="h-2.5 w-2.5" strokeWidth={3} />
            </span>
            {p}
          </li>
        ))}
      </ul>
    </div>
  )
}

function QuestionCard({ index, q, showScore }: { index: number; q: PerQuestionScore; showScore: boolean }) {
  const t = tone(q.score, 10)
  return (
    <div className="rounded-3xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-[15px] font-semibold leading-snug text-foreground">
          <span className="font-serif text-muted-foreground">Q{index + 1}.</span> {q.question}
        </h3>
        {showScore && <span
          className={cn(
            'shrink-0 rounded-full px-2.5 py-0.5 font-serif text-sm font-semibold tabular-nums',
            t === 'success' ? 'bg-success/15 text-success' : t === 'warning' ? 'bg-warning/15 text-warning' : 'bg-destructive/15 text-destructive',
          )}
        >
          {q.score}/10
        </span>}
      </div>

      {q.answer && (
        <div className="mt-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Your answer</p>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{q.answer}</p>
        </div>
      )}

      <div className="mt-4">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Feedback</p>
        <p className="mt-1.5 text-sm leading-relaxed text-foreground">{q.feedback}</p>
      </div>

      {q.betterAnswer && (
        <div className="mt-4 rounded-2xl border border-primary/20 bg-primary/[0.06] p-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-primary">A stronger answer</p>
          <p className="mt-1.5 text-sm leading-relaxed text-foreground">{q.betterAnswer}</p>
        </div>
      )}
    </div>
  )
}

function TranscriptView({ turns }: { turns?: TranscriptTurn[] }) {
  if (!turns?.length) {
    return <p className="text-sm text-muted-foreground">No transcript available.</p>
  }
  return (
    <div className="space-y-4">
      {turns.map((t, i) => {
        const candidate = t.speaker === 'candidate'
        return (
          <div key={i} className={cn('flex flex-col', candidate && 'items-end')}>
            <span className="mb-1 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              {candidate ? 'You' : 'Interviewer'}
            </span>
            <div
              className={cn(
                'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
                candidate
                  ? 'bg-primary/15 text-foreground'
                  : 'border border-border bg-card text-foreground',
              )}
            >
              {t.text}
            </div>
          </div>
        )
      })}
    </div>
  )
}
