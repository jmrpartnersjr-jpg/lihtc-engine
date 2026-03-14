/**
 * SaveStatus.jsx
 * 
 * Displays the current auto-save state in the header/nav area.
 * Shows nothing when idle, "Saving..." while in flight, 
 * "Saved" with a checkmark for 2 seconds, "Save failed" on error.
 */

import { useLihtc } from '../context/LihtcContext'

export function SaveStatus() {
  const { saveStatus, isDirty } = useLihtc()

  if (saveStatus === 'idle' && !isDirty) return null

  const config = {
    saving: { text: 'Saving…',      color: '#94a3b8', dot: '○' },
    saved:  { text: 'Saved',        color: '#22c55e', dot: '✓' },
    error:  { text: 'Save failed',  color: '#ef4444', dot: '!' },
    idle:   { text: 'Unsaved',      color: '#f59e0b', dot: '●' },
  }

  const { text, color, dot } = config[saveStatus] ?? config.idle

  return (
    <span style={{
      fontSize: '0.75rem',
      color,
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
      fontVariantNumeric: 'tabular-nums',
      transition: 'color 0.2s ease',
    }}>
      <span>{dot}</span>
      <span>{text}</span>
    </span>
  )
}
