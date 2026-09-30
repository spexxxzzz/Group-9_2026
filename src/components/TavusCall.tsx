import { useEffect, useRef, useState } from 'react'
import type { DailyCall } from '@daily-co/daily-js'

interface TavusCallProps {
  url: string
  conversationId: string
  durationMinutes: number
  joinedAt?: number
  onJoined: (joinedAt: number) => void
  onTimeLeft: (seconds: number) => void
  onTimeExpired: () => void
  onLeft: () => void
  onError: (message: string) => void
}

/** Owns the Daily iframe so the app can observe the call and update Tavus live. */
export default function TavusCall(props: TavusCallProps) {
  const container = useRef<HTMLDivElement>(null)
  const call = useRef<DailyCall | null>(null)
  const callbacks = useRef(props)
  callbacks.current = props
  const [activeJoinedAt, setActiveJoinedAt] = useState(props.joinedAt)
  const expired = useRef(false)
  const lastTimeBucket = useRef(-1)

  useEffect(() => {
    if (props.joinedAt && !activeJoinedAt) setActiveJoinedAt(props.joinedAt)
  }, [props.joinedAt, activeJoinedAt])

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
        const joinedAt = callbacks.current.joinedAt || Date.now()
        setActiveJoinedAt(joinedAt)
        callbacks.current.onJoined(joinedAt)
      })
      frame.on('left-meeting', () => {
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
      call.current = null
      if (frame) void frame.destroy()
    }
  }, [props.url, props.conversationId])

  useEffect(() => {
    if (!activeJoinedAt) return
    const tick = () => {
      const elapsed = Math.max(0, Math.floor((Date.now() - activeJoinedAt) / 1000))
      const remaining = Math.max(0, callbacks.current.durationMinutes * 60 - elapsed)
      callbacks.current.onTimeLeft(remaining)
      const bucket = Math.floor(elapsed / 30)
      if (remaining > 0 && call.current && bucket !== lastTimeBucket.current) {
        lastTimeBucket.current = bucket
        const closing = remaining <= 60
        const context = [
          `Live interview time check: ${Math.floor(elapsed / 60)} minutes ${elapsed % 60} seconds elapsed; ${Math.ceil(remaining / 60)} minute${remaining > 60 ? 's' : ''} remaining in the ${callbacks.current.durationMinutes}-minute session.`,
          closing
            ? 'Acknowledge the candidate’s latest point, ask at most one brief final follow-up if valuable, invite a candidate question if possible, and close naturally before time runs out.'
            : 'Pace the next question using the answer just given. If an introduction or answer is taking most of the remaining time, politely redirect at the next natural pause toward the most useful unanswered competency.',
        ].join(' ')
        call.current.sendAppMessage({
          message_type: 'conversation',
          event_type: 'conversation.append_llm_context',
          conversation_id: callbacks.current.conversationId,
          properties: { context },
        }, '*')
      }
      if (remaining === 0 && !expired.current) {
        expired.current = true
        callbacks.current.onTimeExpired()
      }
    }
    tick()
    const interval = window.setInterval(tick, 1_000)
    return () => window.clearInterval(interval)
  }, [activeJoinedAt])

  return <div ref={container} className="absolute inset-0 h-full w-full" />
}
