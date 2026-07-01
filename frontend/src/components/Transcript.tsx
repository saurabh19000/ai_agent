import { useState, useEffect, useRef, useMemo } from 'react'
import { useTranscriptions, useRoomContext } from '@livekit/components-react'
import type { TranscriptSegment } from '../types'

export function Transcript() {
  const allTranscriptions = useTranscriptions()
  const room = useRoomContext()
  const containerRef = useRef<HTMLDivElement>(null)

  const agentIdentity = useMemo(() => {
    for (const [, p] of room.remoteParticipants) {
      if (p.isAgent) return p.identity
    }
    return undefined
  }, [room])

  const [displayedSegments, setDisplayedSegments] = useState<Map<string, TranscriptSegment>>(new Map())

  // Process transcriptions — always use functional updater to avoid stale closure
  useEffect(() => {
    const merged = new Map<string, TranscriptSegment>()

    for (const t of allTranscriptions) {
      const attrs = t.streamInfo?.attributes ?? {}
      const segmentId = attrs['lk.segment_id'] ?? t.streamInfo?.id
      if (!segmentId || !t.text?.trim()) continue

      const existing = merged.get(segmentId)
      const isFinal = attrs['lk.transcription_final'] === 'true'

      if (existing?.isFinal && !isFinal) continue

      merged.set(segmentId, {
        id: segmentId,
        text: t.text,
        participantIdentity: t.participantInfo?.identity ?? '',
        isFinal,
        timestamp: existing?.timestamp ?? Date.now(),
      })
    }

    setDisplayedSegments((prev) => {
      if (prev.size !== merged.size) return merged
      for (const [key, val] of merged) {
        const old = prev.get(key)
        if (!old || old.text !== val.text || old.isFinal !== val.isFinal) {
          return merged
        }
      }
      return prev
    })
  }, [allTranscriptions])

  // Auto-scroll
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [displayedSegments])

  const segments = useMemo(
    () => Array.from(displayedSegments.values()).sort((a, b) => a.timestamp - b.timestamp),
    [displayedSegments],
  )

  return (
    <div className="transcript-content">
      <div className="transcript-scroll" ref={containerRef}>
        {segments.length === 0 ? (
          <div className="transcript-empty">
            <p>Transcript will appear here once the conversation starts.</p>
          </div>
        ) : (
          segments.map((segment) => {
            const isAgent = segment.participantIdentity === agentIdentity
            const speakerLabel = isAgent ? 'Interviewer' : 'You'
            const isInterim = !segment.isFinal

            return (
              <div
                key={segment.id}
                className={`transcript-item ${isAgent ? 'agent' : 'user'} ${isInterim ? 'interim' : ''}`}
              >
                <div className="transcript-speaker">
                  {speakerLabel}
                  {isInterim && <span className="transcript-interim-indicator">...</span>}
                </div>
                <div className="transcript-text">{segment.text}</div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
