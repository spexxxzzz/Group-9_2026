import { useEffect, useRef, useState } from 'react'
import type { DailyCall } from '@daily-co/daily-js'
import { remainingConversationSeconds } from '../lib/tavus'

interface TavusCallProps {
  url: string
  conversationId: string
  durationMinutes: number
  startedAt?: number
  onJoined: (joinedAt: number) => void
  onTimeLeft: (seconds: number) => void
  onLeft: () => void
  onError: (message: string) => void
}

/** Owns the Daily iframe so the app can observe the call and update Tavus live. */
export default function TavusCall(props: TavusCallProps) {
  const container = useRef<HTMLDivElement>(null)
  const call = useRef<DailyCall | null>(null)
  const joined = useRef(false)
  const callbacks = useRef(props)
  callbacks.current = props
  const [activeStartedAt, setActiveStartedAt] = useState(props.startedAt)
  const lastTimeBucket = useRef(-1)

  useEffect(() => {
    if (props.startedAt && props.startedAt !== activeStartedAt) setActiveStartedAt(props.startedAt)
  }, [props.startedAt, activeStartedAt])

  useEffect(() => {
    if (!container.current) return
    let disposed = false
    let frame: DailyCall | undefined

    ;(async () => {
      const Daily = (await import('@daily-co/daily-js')).default
      if (disposed || !container.current) return
      frame = Daily.createFrame(container.current, {
        iframeStyle: { width: '100%', height: '100%', border: '0' },
        showLeaveButton: true,
      })
      call.current = frame
      frame.on('joined-meeting', () => {
        if (disposed) return
        joined.current = true
        setActiveStartedAt(callbacks.current.startedAt ?? Date.now())
        lastTimeBucket.current = -1
        callbacks.current.onJoined(Date.now())
      })
      frame.on('left-meeting', () => {
        joined.current = false
        if (!disposed) callbacks.current.onLeft()
      })
      frame.on('app-message', (event) => {
        if (disposed) return
        const data = event.data as { event_type?: string; properties?: { role?: string } } | undefined
        if (data?.event_type === 'conversation.utterance' && data.properties?.role === 'user') {
          // The next timer tick supplies current time after the candidate's turn.
          lastTimeBucket.current = -1
        }
      })
      await frame.join({ url: callbacks.current.url })
    })().catch((error) => {
      if (!disposed) callbacks.current.onError(error instanceof Error ? error.message : 'Could not join the call.')
    })

    return () => {
      disposed = true
      joined.current = false
      call.current = null
      if (frame) void frame.destroy()
    }
  }, [props.url, props.conversationId])

  useEffect(() => {
    if (!activeStartedAt) return
    const tick = () => {
      const elapsed = Math.max(0, Math.floor((Date.now() - activeStartedAt) / 1000))
      const remaining = remainingConversationSeconds(activeStartedAt, callbacks.current.durationMinutes)
      callbacks.current.onTimeLeft(remaining)
      const bucket = Math.floor(elapsed / 30)
      if (remaining > 0 && joined.current && call.current && bucket !== lastTimeBucket.current) {
        lastTimeBucket.current = bucket
        const guidance = remaining <= 90
          ? 'The provider cutoff is close. Do not open a new long story. Briefly acknowledge the answer, invite one candidate question if feasible, and close naturally before time expires.'
          : remaining <= 150
            ? 'Check what the first story actually established about the role’s highest-priority competencies. Ask a concise evidence-seeking follow-up or test one uncovered competency; if an answer is long, redirect at the next natural pause.'
            : 'Use the candidate’s latest answer to probe a high-priority competency from your private role-and-job-description plan. Prefer concrete actions, decisions, outcomes, and reflection over a new generic question.'
        const context = [
          `Live interview time check: ${remaining} seconds remain before Tavus ends this five-minute conversation. Time is measured from conversation creation, not candidate join.`,
          guidance,
        ].join(' ')
        try {
          call.current.sendAppMessage({
            message_type: 'conversation',
            event_type: 'conversation.append_llm_context',
            conversation_id: callbacks.current.conversationId,
            properties: { context },
          }, '*')
        } catch {
          // The room may have ended between the timer check and this send.
        }
      }
    }
    tick()
    const interval = window.setInterval(tick, 1_000)
    return () => window.clearInterval(interval)
  }, [activeStartedAt])

  return <div ref={container} className="absolute inset-0 h-full w-full" />
}
