import { jsPDF } from 'jspdf'
import type { Interview, InterviewType, PerQuestionScore, Report } from '../types'
import { BEHAVIORAL_CRITERIA, behavioralAverage, RUBRIC_GRADE_LABELS } from './behavioral-rubric'

const PAGE_WIDTH = 595.28
const PAGE_HEIGHT = 841.89
const MARGIN = 48
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2
const BOTTOM = PAGE_HEIGHT - 54

function clean(value: string): string {
  return value
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
}

function filePart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'interview'
}

function rubric(type: InterviewType): string[] {
  if (type === 'coding') {
    return [
      'Approach correctness and edge-case handling',
      'Reasoning out loud before implementation',
      'Code clarity and time/space complexity',
      'Independence, including appropriate use of hints',
    ]
  }
  if (type === 'system-design') {
    return [
      'Requirements gathering and problem framing',
      'Architecture, data model, APIs, and trade-offs',
      'Scalability, bottlenecks, and operational reasoning',
      'Clarity and justification of technical choices',
    ]
  }
  return [
    'STAR structure: Situation, Task, Action, and Result',
    'Specificity, ownership, and measurable outcomes',
    'Communication clarity and relevance to the role',
    'Depth of reflection and follow-up responses',
  ]
}

function interviewLabel(type: InterviewType): string {
  return type === 'system-design' ? 'System design' : type[0].toUpperCase() + type.slice(1)
}

interface ReportPdfInput {
  interview: Interview
  report: Report
}

/** Build and download a paginated, client-side copy of a completed report. */
export function downloadReportPdf({ interview, report }: ReportPdfInput): void {
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true })
  let y = MARGIN

  const newPage = () => {
    doc.addPage()
    y = MARGIN
  }
  const requireSpace = (height: number) => {
    if (y + height > BOTTOM) newPage()
  }
  const paragraph = (text: string, options?: { size?: number; color?: [number, number, number]; indent?: number; gap?: number }) => {
    const size = options?.size ?? 10
    const indent = options?.indent ?? 0
    const lines = doc.splitTextToSize(clean(text), CONTENT_WIDTH - indent) as string[]
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(size)
    doc.setTextColor(...(options?.color ?? [52, 58, 68]))
    for (const line of lines) {
      requireSpace(size + 5)
      doc.text(line, MARGIN + indent, y)
      y += size + 5
    }
    y += options?.gap ?? 5
  }
  const heading = (text: string) => {
    requireSpace(34)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(14)
    doc.setTextColor(18, 24, 34)
    doc.text(text, MARGIN, y)
    y += 8
    doc.setDrawColor(222, 226, 232)
    doc.line(MARGIN, y, PAGE_WIDTH - MARGIN, y)
    y += 18
  }
  const bullet = (text: string) => {
    requireSpace(18)
    doc.setFillColor(43, 101, 177)
    doc.circle(MARGIN + 3, y - 3, 2, 'F')
    paragraph(text, { indent: 12, gap: 3 })
  }

  doc.setFillColor(19, 29, 43)
  doc.rect(0, 0, PAGE_WIDTH, 146, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(26)
  doc.setTextColor(255, 255, 255)
  doc.text('Dialogue', MARGIN, 70)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(11)
  doc.setTextColor(190, 205, 222)
  doc.text('AI Mock Interview Report', MARGIN, 92)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.setTextColor(18, 24, 34)
  doc.text(clean(interview.role), MARGIN, 184)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(93, 103, 116)
  doc.text(`${interviewLabel(interview.interviewType)} interview`, MARGIN, 202)

  doc.setFillColor(239, 245, 255)
  doc.roundedRect(PAGE_WIDTH - 160, 162, 112, 70, 8, 8, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(28)
  doc.setTextColor(38, 91, 168)
  doc.text(String(report.overallScore), PAGE_WIDTH - 104, 195, { align: 'center' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(70, 85, 104)
  doc.text('OVERALL SCORE / 100', PAGE_WIDTH - 104, 215, { align: 'center' })
  y = 262

  heading('Executive summary')
  paragraph(report.summary || 'Interview scored.', { size: 11, gap: 10 })
  if (typeof report.questionsAnswered === 'number' && typeof report.expectedQuestions === 'number') {
    paragraph(`Questions answered: ${report.questionsAnswered} of ${report.expectedQuestions}`, { size: 10, color: [83, 94, 108] })
  }

  if (report.behavioralRubric?.length) {
    heading('Behavioral grading rubric')
    paragraph(
      `Average: ${behavioralAverage(report.behavioralRubric).toFixed(1)} / 4. Applicable rows are weighted equally; 1 maps to 0 and 4 maps to 100. Not assessed rows are excluded.`,
      { size: 9, gap: 9 },
    )
    const criterionWidth = 145
    for (const criterion of BEHAVIORAL_CRITERIA) {
      const row = report.behavioralRubric.find((item) => item.id === criterion.id)
      if (!row) continue
      const selected = row.grade === null
        ? 'Not assessed'
        : `${row.grade} - ${RUBRIC_GRADE_LABELS[row.grade - 1]}`
      const detail = row.grade === null
        ? row.justification
        : `${criterion.anchors[row.grade - 1]} ${row.justification}${row.evidence ? ` Evidence: ${row.evidence}` : ''}`
      const titleLines = doc.splitTextToSize(clean(criterion.label), criterionWidth - 16) as string[]
      const detailLines = doc.splitTextToSize(clean(`${selected}. ${detail}`), CONTENT_WIDTH - criterionWidth - 20) as string[]
      const rowHeight = Math.max(titleLines.length, detailLines.length) * 13 + 18
      requireSpace(rowHeight + 3)
      doc.setDrawColor(222, 226, 232)
      doc.rect(MARGIN, y - 10, CONTENT_WIDTH, rowHeight)
      doc.line(MARGIN + criterionWidth, y - 10, MARGIN + criterionWidth, y - 10 + rowHeight)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.setTextColor(18, 24, 34)
      doc.text(titleLines, MARGIN + 8, y + 3)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(52, 58, 68)
      doc.text(detailLines, MARGIN + criterionWidth + 8, y + 3)
      y += rowHeight + 3
    }
    paragraph('Adapted from Princeton University Center for Career Development interview rubric: careerdevelopment.princeton.edu/book/export/html/9191', { size: 8, color: [91, 103, 119], gap: 10 })
  } else {
    heading('Scoring rubric')
    rubric(interview.interviewType).forEach(bullet)
  }

  if (report.strengths?.length) {
    heading('Strengths')
    report.strengths.forEach(bullet)
  }
  if (report.weaknesses?.length) {
    heading('Areas to improve')
    report.weaknesses.forEach(bullet)
  }
  if (report.nonVerbalFeedback) {
    heading('Camera and delivery observations')
    paragraph(report.nonVerbalFeedback)
  }
  if (report.resumeFeedback) {
    heading('Resume-informed feedback')
    paragraph(report.resumeFeedback)
  }

  heading('Question-by-question grading')
  if (report.perQuestion?.length) {
    report.perQuestion.forEach((question, index) => addQuestion(doc, question, index + 1, () => y, (next) => { y = next }, requireSpace, paragraph, !report.behavioralRubric?.length))
  } else {
    paragraph(report.detailed ? 'No question-by-question breakdown was available.' : 'Detailed feedback was still being generated when this PDF was downloaded.')
  }

  const total = doc.getNumberOfPages()
  for (let page = 1; page <= total; page++) {
    doc.setPage(page)
    doc.setDrawColor(226, 230, 235)
    doc.line(MARGIN, PAGE_HEIGHT - 36, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 36)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(116, 126, 139)
    doc.text('Dialogue - AI mock interview report', MARGIN, PAGE_HEIGHT - 22)
    doc.text(`Page ${page} of ${total}`, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 22, { align: 'right' })
  }

  doc.save(`dialogue-${filePart(interview.role)}-interview-report.pdf`)
}

function addQuestion(
  doc: jsPDF,
  question: PerQuestionScore,
  index: number,
  getY: () => number,
  setY: (value: number) => void,
  requireSpace: (height: number) => void,
  paragraph: (text: string, options?: { size?: number; color?: [number, number, number]; indent?: number; gap?: number }) => void,
  showScore: boolean,
) {
  requireSpace(30)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(25, 34, 47)
  const title = doc.splitTextToSize(`Q${index}. ${clean(question.question)}`, CONTENT_WIDTH - 64) as string[]
  title.forEach((line) => {
    requireSpace(16)
    doc.text(line, MARGIN, getY())
    setY(getY() + 16)
  })
  if (showScore) {
    doc.setFillColor(question.score >= 8 ? 228 : question.score >= 5 ? 255 : 254, question.score >= 8 ? 246 : question.score >= 5 ? 244 : 234, question.score >= 8 ? 235 : question.score >= 5 ? 214 : 234)
    doc.roundedRect(PAGE_WIDTH - MARGIN - 48, getY() - 31, 48, 20, 8, 8, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(35, 50, 68)
    doc.text(`${question.score}/10`, PAGE_WIDTH - MARGIN - 24, getY() - 17, { align: 'center' })
  }
  setY(getY() + 3)
  if (question.answer) {
    paragraph('Candidate answer', { size: 9, color: [91, 103, 119], gap: 1 })
    paragraph(question.answer, { size: 10, color: [72, 82, 96], gap: 6 })
  }
  paragraph('Feedback', { size: 9, color: [91, 103, 119], gap: 1 })
  paragraph(question.feedback, { size: 10, gap: 6 })
  if (question.betterAnswer) {
    paragraph('Stronger answer', { size: 9, color: [43, 101, 177], gap: 1 })
    paragraph(question.betterAnswer, { size: 10, color: [35, 70, 120], gap: 10 })
  }
}
