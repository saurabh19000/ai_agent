import { useState, useRef, useEffect, useCallback } from 'react'
import { LiveKitRoom, RoomAudioRenderer } from '@livekit/components-react'
import { CallInterface } from './components/CallInterface'
import type { ConnectionDetails, DepartmentOption, VerifiedToken, OtpState } from './types'
import './App.css'

const TOKEN_SERVER_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8001'
const HRMS_BACKEND_URL = import.meta.env.VITE_HRMS_BACKEND_URL || 'http://localhost:8000'

const DEPARTMENTS: DepartmentOption[] = [
  { slug: 'software-engineering', name: 'Software Engineering' },
  { slug: 'data-science', name: 'Data Science' },
  { slug: 'product-management', name: 'Product Management' },
  { slug: 'ui-ux-design', name: 'UI/UX Design' },
  { slug: 'sales', name: 'Sales' },
  { slug: 'marketing', name: 'Marketing' },
  { slug: 'human-resources', name: 'Human Resources' },
  { slug: 'finance', name: 'Finance' },
  { slug: 'operations', name: 'Operations' },
  { slug: 'customer-support', name: 'Customer Support' },
  { slug: 'general', name: 'General' },
]

const DEPARTMENT_SLUG_MAP: Record<string, string> = {
  'software-engineering': 'software-engineering',
  'Software Engineering': 'software-engineering',
  'data-science': 'data-science',
  'Data Science': 'data-science',
  'product-management': 'product-management',
  'Product Management': 'product-management',
  'ui-ux-design': 'ui-ux-design',
  'UI/UX Design': 'ui-ux-design',
  'sales': 'sales',
  'Sales': 'sales',
  'marketing': 'marketing',
  'Marketing': 'marketing',
  'human-resources': 'human-resources',
  'Human Resources': 'human-resources',
  'finance': 'finance',
  'Finance': 'finance',
  'operations': 'operations',
  'Operations': 'operations',
  'customer-support': 'customer-support',
  'Customer Support': 'customer-support',
  'general': 'general',
  'General': 'general',
  'Engineering': 'software-engineering',
}

function App() {
  const [connectionDetails, setConnectionDetails] = useState<ConnectionDetails | null>(null)
  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedDepartment, setSelectedDepartment] = useState('software-engineering')
  const [applicationId, setApplicationId] = useState('')
  const [verifiedToken, setVerifiedToken] = useState<VerifiedToken | null>(null)
  const [isVerifying, setIsVerifying] = useState(false)
  const [isInterviewEnded, setIsInterviewEnded] = useState(false)
  const [otpState, setOtpState] = useState<OtpState>('idle')
  const [emailInput, setEmailInput] = useState('')
  const [otpInput, setOtpInput] = useState('')
  const [otpError, setOtpError] = useState<string | null>(null)
  const [otpCooldown, setOtpCooldown] = useState(0)
  const hasStartedRef = useRef(false)
  const isStartingRef = useRef(false)
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    return () => {
      if (cooldownRef.current) clearInterval(cooldownRef.current)
    }
  }, [])

  const startOtpCooldown = () => {
    setOtpCooldown(30)
    cooldownRef.current = setInterval(() => {
      setOtpCooldown((prev) => {
        if (prev <= 1) {
          if (cooldownRef.current) clearInterval(cooldownRef.current)
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const token = params.get('token')
    if (!token) return

    setIsVerifying(true)
    hasStartedRef.current = true

    fetch(`${HRMS_BACKEND_URL}/api/interviews/verify-token?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({ detail: 'Token verification failed' }))
          throw new Error(err.detail || `Verification failed (${res.status})`)
        }
        return res.json()
      })
      .then((data: VerifiedToken) => {
        const departmentSlug = DEPARTMENT_SLUG_MAP[data.department] || 'general'
        setVerifiedToken(data)
        setSelectedDepartment(departmentSlug)
        setApplicationId(data.applicationId || '')
        setIsVerifying(false)
        if (!data.requiresOtp) {
          startInterview()
        }
      })
      .catch((err) => {
        setError(err.message || 'Failed to verify interview link. The link may be invalid or expired.')
        setIsVerifying(false)
      })
  }, [])

  const handleSendOtp = async () => {
    if (!verifiedToken || !emailInput.trim()) return
    setOtpState('sending')
    setOtpError(null)

    try {
      const res = await fetch(`${HRMS_BACKEND_URL}/api/interviews/send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          interviewId: verifiedToken.interviewId,
          email: emailInput.trim(),
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.detail || 'Failed to send OTP')
      }

      setOtpState('sent')
      startOtpCooldown()
    } catch (err) {
      setOtpError(err instanceof Error ? err.message : 'Failed to send OTP')
      setOtpState('idle')
    }
  }

  const handleVerifyOtp = async () => {
    if (!verifiedToken || !otpInput.trim()) return
    setOtpState('verifying')
    setOtpError(null)

    try {
      const res = await fetch(`${HRMS_BACKEND_URL}/api/interviews/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          interviewId: verifiedToken.interviewId,
          email: emailInput.trim(),
          otp: otpInput.trim(),
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.detail || 'Invalid OTP')
      }

      setOtpState('verified')
      setOtpInput('')
      startInterview()
    } catch (err) {
      setOtpError(err instanceof Error ? err.message : 'Verification failed')
      setOtpState('sent')
    }
  }

  const startInterview = useCallback(async () => {
    if (isStartingRef.current || isConnecting || connectionDetails) {
      return
    }

    isStartingRef.current = true
    setIsConnecting(true)
    setError(null)

    try {
      let capacityResponse
      try {
        capacityResponse = await fetch(`${TOKEN_SERVER_URL}/capacity-check`)
      } catch (fetchError) {
        throw new Error(
          `Cannot connect to token server at ${TOKEN_SERVER_URL}. ` +
          `Make sure the token server is running on port 8000.`
        )
      }

      if (!capacityResponse.ok) {
        throw new Error(`Token server returned error: ${capacityResponse.status} ${capacityResponse.statusText}`)
      }

      const capacityData = await capacityResponse.json()

      if (!capacityData.has_capacity) {
        throw new Error(
          capacityData.message ||
          'Maximum number of interviews reached. Please try again later.'
        )
      }

      const appIdPart = applicationId.trim() ? `${applicationId.trim()}-` : ''
      const roomName = `interview-${selectedDepartment}-${appIdPart}${Date.now()}`
      const username = verifiedToken?.candidateName || 'candidate'

      let urlResponse
      try {
        urlResponse = await fetch(`${TOKEN_SERVER_URL}/livekit-url`)
      } catch (fetchError) {
        throw new Error('Cannot connect to token server to get LiveKit URL')
      }

      if (!urlResponse.ok) {
        throw new Error(`Failed to get LiveKit URL: ${urlResponse.status}`)
      }

      const urlData = await urlResponse.json()

      if (urlData.error) {
        throw new Error(urlData.error)
      }

      const appIdParam = applicationId.trim() ? `&application_id=${encodeURIComponent(applicationId.trim())}` : ''
      const candidateEmail = verifiedToken?.email || ''
      const emailParam = candidateEmail ? `&candidate_email=${encodeURIComponent(candidateEmail)}` : ''
      const tokenResponse = await fetch(
        `${TOKEN_SERVER_URL}/token?room=${roomName}&username=${username}&department=${selectedDepartment}${appIdParam}${emailParam}`
      )

      if (!tokenResponse.ok) {
        const errorData = await tokenResponse.json()
        throw new Error(errorData.detail || 'Failed to get access token')
      }

      const tokenData = await tokenResponse.json()

      if (tokenData.error) {
        throw new Error(tokenData.error)
      }

      setConnectionDetails({
        url: urlData.url,
        token: tokenData.token,
        roomName: roomName,
        department: selectedDepartment,
        applicationId: applicationId.trim() || undefined,
      })
    } catch (err) {
      console.error('Failed to start interview:', err)
      setError(err instanceof Error ? err.message : 'Failed to connect')
      setIsConnecting(false)
      isStartingRef.current = false
    }
  }, [applicationId, connectionDetails, isConnecting, selectedDepartment, verifiedToken])

  const endInterview = () => {
    setConnectionDetails(null)
    setIsConnecting(false)
    isStartingRef.current = false
    setError(null)
    setIsInterviewEnded(true)
  }

  if (isInterviewEnded) {
    return (
      <div className="app">
        <div className="start-screen">
          <h1>Interview Complete</h1>
          <p>Your interview has ended. You may close this window.</p>
        </div>
      </div>
    )
  }

  if (!connectionDetails) {
    return (
      <div className="app">
        <div className="start-screen">
          {isVerifying && (
            <>
              <h1>Verifying Interview Link...</h1>
              <p>Please wait while we verify your interview access.</p>
              <div className="verifying-spinner" />
            </>
          )}

          {!isVerifying && verifiedToken && verifiedToken.requiresOtp && otpState !== 'verified' && !error && (
            <>
              <h1>Identity Verification</h1>
              <p>Welcome, <strong>{verifiedToken.candidateName}</strong>!</p>
              <p>Please verify your identity to access the interview for <strong>{verifiedToken.jobTitle}</strong>.</p>

              {(otpState === 'idle' || otpState === 'sending') && (
                <div className="otp-section">
                  <p className="otp-instruction">
                    Enter your registered email address to receive a one-time passcode.
                  </p>
                  <div className="otp-input-group">
                    <input
                      type="email"
                      placeholder="Enter your email address"
                      value={emailInput}
                      onChange={(e) => setEmailInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleSendOtp() }}
                      className="otp-email-input"
                      autoFocus
                      disabled={otpState === 'sending'}
                    />
                  </div>
                  <button
                    className="start-button"
                    onClick={handleSendOtp}
                    disabled={otpState === 'sending' || !emailInput.trim()}
                  >
                    {otpState === 'sending' ? 'Sending...' : 'Send OTP'}
                  </button>
                  {otpError && (
                    <div className="error-message" style={{ marginTop: '1rem' }}>
                      <p>{otpError}</p>
                    </div>
                  )}
                </div>
              )}

              {(otpState === 'sent') && (
                <div className="otp-section">
                  <p className="otp-sent-text">
                    A one-time passcode has been sent to <strong>{emailInput}</strong>
                  </p>
                  <div className="otp-input-group">
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={6}
                      placeholder="Enter 6-digit OTP"
                      value={otpInput}
                      onChange={(e) => setOtpInput(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleVerifyOtp() }}
                      className="otp-input"
                      autoFocus
                    />
                    <button
                      className="start-button"
                      onClick={handleVerifyOtp}
                      disabled={otpInput.length !== 6}
                    >
                      Verify
                    </button>
                  </div>
                  <button
                    className="resend-button"
                    onClick={handleSendOtp}
                    disabled={otpCooldown > 0}
                  >
                    {otpCooldown > 0 ? `Resend in ${otpCooldown}s` : 'Resend OTP'}
                  </button>
                  {otpError && (
                    <div className="error-message" style={{ marginTop: '1rem' }}>
                      <p>{otpError}</p>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {!isVerifying && verifiedToken && !verifiedToken.requiresOtp && !error && (
            <>
              <h1>Welcome, {verifiedToken.candidateName}!</h1>
              <p>Your AI interview for <strong>{verifiedToken.jobTitle}</strong> is ready. Connecting you now...</p>
              <div className="verifying-spinner" />
            </>
          )}

          {!isVerifying && !verifiedToken && (
            <>
              <h1>Project Interview Coach</h1>
              <p>Select your department and start your interview with an AI interviewer</p>

              <div className="department-selector">
                <label htmlFor="department-select">Interview Department</label>
                <select
                  id="department-select"
                  value={selectedDepartment}
                  onChange={(e) => setSelectedDepartment(e.target.value)}
                  disabled={isConnecting}
                >
                  {DEPARTMENTS.map((dept) => (
                    <option key={dept.slug} value={dept.slug}>
                      {dept.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="department-selector">
                <label htmlFor="application-id-input">Application ID (optional - for resume + summary)</label>
                <input
                  id="application-id-input"
                  type="text"
                  value={applicationId}
                  onChange={(e) => setApplicationId(e.target.value)}
                  placeholder="e.g. 665f1a2b3c4d5e6f7a8b9c0d"
                  disabled={isConnecting}
                  className="resume-input"
                />
              </div>

              <button
                className="start-button"
                onClick={startInterview}
                disabled={isConnecting}
              >
                {isConnecting ? 'Connecting...' : 'Start Interview'}
              </button>

              <div className="mobile-notice">
                <span className="mobile-notice-icon">💻</span>
                <span>For the best experience, please use a laptop or desktop computer. Mobile devices may have limited performance and connectivity.</span>
              </div>
            </>
          )}

          {error && (
            <div className="error-message">
              <p>{error}</p>
              {!verifiedToken && (
                <p className="error-help">If you received this link by email, please request a new one from your recruiter.</p>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <LiveKitRoom
        serverUrl={connectionDetails.url}
        token={connectionDetails.token}
        connect={true}
        connectOptions={{
          autoSubscribe: true,
        }}
        options={{
          audioCaptureDefaults: {
            autoGainControl: true,
            echoCancellation: true,
            noiseSuppression: true,
          },
          publishDefaults: {
            dtx: true,
            red: true,
            stopMicTrackOnMute: true,
          },
        }}
        onDisconnected={endInterview}
      >
        <CallInterface
          onEndInterview={endInterview}
          department={connectionDetails.department}
        />
        <RoomAudioRenderer />
      </LiveKitRoom>
    </div>
  )
}

export default App
