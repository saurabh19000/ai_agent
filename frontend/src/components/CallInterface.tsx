import { useState, useEffect, useRef } from 'react'
import { useConnectionState, useRoomContext, useRemoteParticipants, useTracks } from '@livekit/components-react'
import { ConnectionState, ConnectionQuality, Track, Participant } from 'livekit-client'
import type { VideoTrack } from 'livekit-client'
import { AudioVisualizer } from './AudioVisualizer'
import { Transcript } from './Transcript'
import { VideoRenderer } from './VideoRenderer'
import type { AgentState } from '../types'

interface CallInterfaceProps {
  onEndInterview: () => void
  department?: string
}

const DEPARTMENT_NAMES: Record<string, string> = {
  'software-engineering': 'Software Engineering',
  'data-science': 'Data Science',
  'product-management': 'Product Management',
  'ui-ux-design': 'UI/UX Design',
  'sales': 'Sales',
  'marketing': 'Marketing',
  'human-resources': 'Human Resources',
  'finance': 'Finance',
  'operations': 'Operations',
  'customer-support': 'Customer Support',
  'general': 'General',
}

const INTERVIEW_DURATION = 15 * 60

export function CallInterface({ onEndInterview, department }: CallInterfaceProps) {
  const connectionState = useConnectionState()
  const room = useRoomContext()
  const remoteParticipants = useRemoteParticipants()
  const allTracks = useTracks(
    [Track.Source.Camera, Track.Source.Microphone], 
    { onlySubscribed: true }
  )
  
  const [agentState, setAgentState] = useState<AgentState>('initializing')
  const [isLocalMicEnabled, setIsLocalMicEnabled] = useState(false)
  const [isLocalCameraEnabled, setIsLocalCameraEnabled] = useState(false)
  const [isTranscriptOpen, setIsTranscriptOpen] = useState(false)
  const [timeRemaining, setTimeRemaining] = useState(INTERVIEW_DURATION)
  const [connectionQuality, setConnectionQuality] = useState('unknown')

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const hasEndedRef = useRef(false)
  const timerStartedRef = useRef(false)
  const onEndRef = useRef(onEndInterview)
  const roomRef = useRef(room)
  onEndRef.current = onEndInterview
  roomRef.current = room

  const hasAgentStarted = agentState !== 'initializing'

  const handleEndInterview = async () => {
    try {
      await room.disconnect()
    } catch (error) {
      console.error('Error disconnecting from room:', error)
    } finally {
      onEndInterview()
    }
  }

  const minutes = Math.floor(timeRemaining / 60)
  const seconds = timeRemaining % 60
  const isLowTime = timeRemaining <= 60

  useEffect(() => {
    const handleBeforeUnload = async () => {
      try {
        if (room && connectionState === ConnectionState.Connected) {
          await room.disconnect()
        }
      } catch (error) {
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [room, connectionState])

  const agentParticipant = remoteParticipants.find(
    (p: Participant) => {
      if (p.isAgent) return true
      if (p.metadata?.includes('agent')) return true
      if ((p as any).kind === 'agent' || (p as any).kind === 'AGENT') return true
      const identity = p.identity?.toLowerCase() || ''
      const name = p.name?.toLowerCase() || ''
      if (identity.includes('agent') || name.includes('agent')) return true
      return false
    }
  )

  const localVideoTrack = allTracks.find(
    (t) => t.participant.isLocal && t.source === Track.Source.Camera
  )?.publication?.track as VideoTrack | undefined

  const agentVideoTrack = allTracks.find(
    (t) => t.participant.sid === agentParticipant?.sid && t.source === Track.Source.Camera
  )?.publication?.track as VideoTrack | undefined

  const agentAudioTrack = allTracks.find(
    (t) => t.participant.sid === agentParticipant?.sid && t.source === Track.Source.Microphone
  )?.publication?.track

  useEffect(() => {
    if (connectionState === ConnectionState.Connected && room) {
      room.localParticipant.setMicrophoneEnabled(true).then(() => {
        setIsLocalMicEnabled(true)
      }).catch((error) => {
        console.error('Failed to enable microphone:', error)
      })
      
      room.localParticipant.setCameraEnabled(true).then(() => {
        setIsLocalCameraEnabled(true)
      }).catch((error) => {
        console.error('Failed to enable camera:', error)
      })
    }
  }, [connectionState, room])

  useEffect(() => {
    if (agentParticipant) {
      const updateAgentState = () => {
        const state = agentParticipant.attributes?.['lk.agent.state'] as AgentState
        if (state) {
          setAgentState(state)
        }
      }

      updateAgentState()
      agentParticipant.on('attributesChanged', updateAgentState)

      return () => {
        agentParticipant.off('attributesChanged', updateAgentState)
      }
    }
  }, [agentParticipant])

  // Start timer when AI agent begins speaking, not just on room connect
  useEffect(() => {
    const shouldStart =
      connectionState === ConnectionState.Connected &&
      hasAgentStarted &&
      !timerStartedRef.current

    if (shouldStart) {
      timerStartedRef.current = true
      timerRef.current = setInterval(() => {
        setTimeRemaining((prev) => {
          if (prev <= 1) {
            return 0
          }
          return prev - 1
        })
      }, 1000)
    }

  }, [connectionState, hasAgentStarted])

  // Cleanup interval on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [])

  // Auto-end when timer expires
  useEffect(() => {
    if (timeRemaining <= 0 && connectionState === ConnectionState.Connected && !hasEndedRef.current) {
      hasEndedRef.current = true
      handleEndInterview()
    }
  }, [timeRemaining, connectionState])

  // Track local participant connection quality
  useEffect(() => {
    if (!room?.localParticipant) return

    const updateQuality = () => {
      const q = room.localParticipant.connectionQuality
      if (q !== undefined && q !== null) {
        const qualityStr = typeof q === 'number'
          ? ConnectionQuality[q] || 'unknown'
          : String(q)
        setConnectionQuality(qualityStr.toLowerCase())
      }
    }

    updateQuality()
    room.localParticipant.on('connectionQualityChanged', updateQuality)

    return () => {
      room.localParticipant.off('connectionQualityChanged', updateQuality)
    }
  }, [room])

  const connectionStatusText = (() => {
    switch (connectionState) {
      case ConnectionState.Connected:
        return connectionQuality === 'excellent' ? 'Excellent'
          : connectionQuality === 'good' ? 'Good'
          : connectionQuality === 'poor' ? 'Weak'
          : connectionQuality === 'lost' ? 'Lost'
          : 'Connected'
      case ConnectionState.Reconnecting:
        return 'Reconnecting'
      case ConnectionState.Connecting:
        return 'Connecting'
      default:
        return 'Disconnected'
    }
  })()

  const connectionChipClass = (() => {
    switch (connectionState) {
      case ConnectionState.Connected:
        if (connectionQuality === 'poor' || connectionQuality === 'lost') return 'chip-warning'
        return 'chip-good'
      case ConnectionState.Reconnecting:
      case ConnectionState.Connecting:
        return 'chip-warning'
      default:
        return 'chip-bad'
    }
  })()

  return (
    <div className={`call-interface ${isTranscriptOpen ? 'with-transcript' : ''}`}>
      <div className="header-bar">
        <div className="call-header">
          <div className="header-content">
            <h1 className="call-title">
              {department ? DEPARTMENT_NAMES[department] || department : 'Interview'} Interview
            </h1>
            <div className="header-status-row">
              <span className={`connection-chip ${connectionChipClass}`}>
                <span className="chip-dot" />
                {connectionStatusText}
              </span>
            </div>
          </div>
        </div>
        <div className="header-actions">
          {hasAgentStarted && (
            <span className={`timer-display ${isLowTime ? 'timer-low' : ''}`}>
              <span className="timer-icon">&#9202;</span>
              {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
            </span>
          )}
          <button
            type="button"
            className={`transcript-toggle ${isTranscriptOpen ? 'active' : ''}`}
            onClick={() => setIsTranscriptOpen((open) => !open)}
          >
            Transcript
          </button>
          <button className="end-button" onClick={handleEndInterview}>
            End Interview
          </button>
        </div>
      </div>

      <div
        className="transcript-backdrop"
        aria-hidden={!isTranscriptOpen}
        onClick={() => setIsTranscriptOpen(false)}
      />

      <aside
        className={`transcript-panel ${isTranscriptOpen ? 'open' : ''}`}
        aria-label="Live transcript"
      >
        <div className="transcript-panel-inner">
          <div className="transcript-panel-header">
            <h2 className="transcript-title">Transcript <span className="live-badge">● LIVE</span></h2>
            <button
              type="button"
              className="transcript-close"
              onClick={() => setIsTranscriptOpen(false)}
            >
              Close
            </button>
          </div>
          <Transcript />
        </div>
      </aside>

      <div className="call-body">
        <div className="video-section">
          <VideoRenderer track={localVideoTrack} label="You" isLocal={true} />

          <div className="agent-video-container">
            {agentVideoTrack ? (
              <VideoRenderer track={agentVideoTrack} label="AI Interviewer" isLocal={false} />
            ) : (
              <div className="agent-visualizer-container">
                <AudioVisualizer 
                  track={agentAudioTrack} 
                  state={agentState}
                  barCount={7}
                />
                <div className="video-label">AI Interviewer</div>
              </div>
            )}
          </div>
        </div>

        <div className="call-info">
          <div className="info-card">
            <div className="info-icon">🎤</div>
            <div className="info-content">
              <div className="info-label">Your Microphone</div>
              <div className="info-value">{isLocalMicEnabled ? 'Active' : 'Inactive'}</div>
            </div>
          </div>

          <div className="info-card">
            <div className="info-icon">📹</div>
            <div className="info-content">
              <div className="info-label">Your Camera</div>
              <div className="info-value">{isLocalCameraEnabled ? 'Active' : 'Inactive'}</div>
            </div>
          </div>

          {agentParticipant && (
            <div className="info-card">
              <div className="info-icon">🤖</div>
              <div className="info-content">
                <div className="info-label">AI Interviewer</div>
                <div className="info-value">Connected</div>
              </div>
            </div>
          )}

          <div className="info-card">
            <div className="info-icon">&#9202;</div>
            <div className="info-content">
              <div className="info-label">Time Remaining</div>
              <div className={`info-value ${isLowTime ? 'text-red-400' : ''}`}>
                {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
              </div>
            </div>
          </div>
        </div>
      </div>

      {isLowTime && timeRemaining > 0 && (
        <div className="time-warning-banner">
          ⚠ Interview ending soon — {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')} remaining
        </div>
      )}
    </div>
  )
}
