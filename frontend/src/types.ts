export type AgentState = 'initializing' | 'listening' | 'thinking' | 'speaking'

export interface TranscriptSegment {
  id: string
  text: string
  participantIdentity: string
  isFinal: boolean
  timestamp: number
}

export interface ConnectionDetails {
  url: string
  token: string
  roomName: string
  department: string
  applicationId?: string
}

export interface DepartmentOption {
  slug: string
  name: string
}

export interface VerifiedToken {
  valid: boolean
  interviewId: string
  role: string
  email: string
  emailMasked?: string
  candidateName: string
  jobTitle: string
  department: string
  applicationId: string
  scheduledAt?: string
  requiresOtp?: boolean
}

export type OtpState = 'idle' | 'sending' | 'sent' | 'verifying' | 'verified' | 'error'
