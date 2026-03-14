/**
 * VersionPanel.jsx
 * 
 * Slide-in panel showing the version history for the current scenario.
 * Lets the user:
 *   - View all named versions with labels, dates, and key outputs
 *   - Save the current working state as a named version
 *   - Restore a previous version into the working slot
 *   - Select two versions to compare (diff view)
 */

import { useState, useEffect } from 'react'
import { useLihtc } from '../context/LihtcContext'

const fmt = (n) => n != null ? `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'
const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

export function VersionPanel({ isOpen, onClose }) {
  const {
    versions, loadVersions, saveNamedVersion,
    restoreVersion, compareVersions,
    scenarioName, dealName,
  } = useLihtc()

  const [label, setLabel]       = useState('')
  const [notes, setNotes]       = useState('')
  const [saving, setSaving]     = useState(false)
  const [comparing, setComparing] = useState([])   // [versionId, versionId]
  const [diffResult, setDiffResult] = useState(null)
  const [diffLoading, setDiffLoading] = useState(false)

  useEffect(() => {
    if (isOpen) loadVersions()
  }, [isOpen, loadVersions])

  const handleSave = async () => {
    if (!label.trim()) return
    setSaving(true)
    await saveNamedVersion(label.trim(), notes.trim())
    setLabel('')
    setNotes('')
    setSaving(false)
  }

  const handleCompareToggle = (versionId) => {
    setDiffResult(null)
    if (comparing.includes(versionId)) {
      setComparing(comparing.filter(id => id !== versionId))
    } else if (comparing.length < 2) {
      setComparing([...comparing, versionId])
    }
  }

  const handleRunCompare = async () => {
    if (comparing.length !== 2) return
    setDiffLoading(true)
    const result = await compareVersions(comparing[0], comparing[1])
    setDiffResult(result)
    setDiffLoading(false)
  }

  const namedVersions = versions.filter(v => v.is_locked)
  const workingVersion = versions.find(v => v.is_working)

  if (!isOpen) return null

  return (
    <div style={{
      position: 'fixed', right: 0, top: 0, bottom: 0,
      width: '420px', background: '#0f172a', borderLeft: '1px solid #1e293b',
      zIndex: 1000, display: 'flex', flexDirection: 'column',
      fontFamily: 'system-ui, sans-serif', color: '#e2e8f0',
    }}>
      {/* Header */}
      <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #1e293b' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Version History</div>
            <div style={{ fontSize: '1rem', fontWeight: 600, marginTop: '2px' }}>{dealName}</div>
            <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>{scenarioName}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '1.2rem', padding: '4px' }}>✕</button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>

        {/* Save new version */}
        <div style={{ marginBottom: '24px' }}>
          <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '10px' }}>
            Save Current State
          </div>
          <input
            value={label}
            onChange={e => setLabel(e.target.value)}
            placeholder="Label — e.g. v1.2 Rate lock at 5.85%"
            style={{
              width: '100%', background: '#1e293b', border: '1px solid #334155',
              borderRadius: '6px', padding: '8px 12px', color: '#e2e8f0',
              fontSize: '0.85rem', marginBottom: '8px', boxSizing: 'border-box',
            }}
          />
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Notes (optional)"
            rows={2}
            style={{
              width: '100%', background: '#1e293b', border: '1px solid #334155',
              borderRadius: '6px', padding: '8px 12px', color: '#e2e8f0',
              fontSize: '0.85rem', marginBottom: '8px', resize: 'none', boxSizing: 'border-box',
            }}
          />
          <button
            onClick={handleSave}
            disabled={!label.trim() || saving}
            style={{
              width: '100%', padding: '8px', borderRadius: '6px',
              background: label.trim() ? '#2563eb' : '#1e293b',
              color: label.trim() ? '#fff' : '#475569',
              border: 'none', cursor: label.trim() ? 'pointer' : 'default',
              fontSize: '0.85rem', fontWeight: 500,
            }}
          >
            {saving ? 'Saving…' : '↓ Save Version'}
          </button>
        </div>

        {/* Compare button */}
        {comparing.length === 2 && (
          <div style={{ marginBottom: '16px' }}>
            <button
              onClick={handleRunCompare}
              disabled={diffLoading}
              style={{
                width: '100%', padding: '8px', borderRadius: '6px',
                background: '#7c3aed', color: '#fff', border: 'none',
                cursor: 'pointer', fontSize: '0.85rem', fontWeight: 500,
              }}
            >
              {diffLoading ? 'Comparing…' : `Compare selected versions`}
            </button>
          </div>
        )}

        {/* Diff result */}
        {diffResult && (
          <DiffView diff={diffResult.diff} onClose={() => { setDiffResult(null); setComparing([]) }} />
        )}

        {/* Version list */}
        <div>
          <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '10px' }}>
            Saved Versions ({namedVersions.length})
            {comparing.length > 0 && (
              <span style={{ color: '#7c3aed', marginLeft: '8px' }}>
                — select {2 - comparing.length} more to compare
              </span>
            )}
          </div>

          {namedVersions.length === 0 && (
            <div style={{ color: '#475569', fontSize: '0.85rem', fontStyle: 'italic' }}>
              No saved versions yet. Save the current state above to create v1.
            </div>
          )}

          {namedVersions.map(v => (
            <VersionRow
              key={v.id}
              version={v}
              isSelected={comparing.includes(v.id)}
              onCompareToggle={() => handleCompareToggle(v.id)}
              onRestore={() => restoreVersion(v.id)}
              compareMode={comparing.length > 0}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function VersionRow({ version, isSelected, onCompareToggle, onRestore, compareMode }) {
  const [showConfirm, setShowConfirm] = useState(false)
  const tdc = version.summary?.tdc

  return (
    <div style={{
      background: isSelected ? '#1e1b4b' : '#1e293b',
      border: `1px solid ${isSelected ? '#7c3aed' : '#334155'}`,
      borderRadius: '8px', padding: '12px 14px', marginBottom: '8px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>
            v{version.version_number} — {version.label}
          </div>
          {version.notes && (
            <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '2px' }}>
              {version.notes}
            </div>
          )}
          <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '4px' }}>
            {fmtDate(version.saved_at)} · {version.saved_by || 'Unknown'}
            {tdc && <span style={{ marginLeft: '8px', color: '#94a3b8' }}>TDC {fmt(tdc)}</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '6px', marginLeft: '12px', flexShrink: 0 }}>
          <button
            onClick={onCompareToggle}
            style={{
              padding: '4px 8px', fontSize: '0.7rem', borderRadius: '4px',
              background: isSelected ? '#7c3aed' : '#334155',
              color: isSelected ? '#fff' : '#94a3b8', border: 'none', cursor: 'pointer',
            }}
          >
            {isSelected ? '✓ Comparing' : 'Compare'}
          </button>
          {!showConfirm ? (
            <button
              onClick={() => setShowConfirm(true)}
              style={{
                padding: '4px 8px', fontSize: '0.7rem', borderRadius: '4px',
                background: '#334155', color: '#94a3b8', border: 'none', cursor: 'pointer',
              }}
            >
              Restore
            </button>
          ) : (
            <div style={{ display: 'flex', gap: '4px' }}>
              <button
                onClick={() => { onRestore(); setShowConfirm(false) }}
                style={{ padding: '4px 8px', fontSize: '0.7rem', borderRadius: '4px', background: '#dc2626', color: '#fff', border: 'none', cursor: 'pointer' }}
              >
                Confirm
              </button>
              <button
                onClick={() => setShowConfirm(false)}
                style={{ padding: '4px 8px', fontSize: '0.7rem', borderRadius: '4px', background: '#334155', color: '#94a3b8', border: 'none', cursor: 'pointer' }}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function DiffView({ diff, onClose }) {
  const modules = diff?.modules_changed ?? []

  return (
    <div style={{
      background: '#0f172a', border: '1px solid #7c3aed', borderRadius: '8px',
      padding: '14px', marginBottom: '20px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#c4b5fd' }}>
          Comparison Result — {modules.length} module{modules.length !== 1 ? 's' : ''} changed
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '0.8rem' }}>✕</button>
      </div>

      {modules.length === 0 && (
        <div style={{ color: '#64748b', fontSize: '0.8rem', fontStyle: 'italic' }}>No differences found.</div>
      )}

      {modules.map(module => {
        const changes = diff[module] ?? {}
        return (
          <div key={module} style={{ marginBottom: '12px' }}>
            <div style={{ fontSize: '0.7rem', color: '#7c3aed', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' }}>
              {module.replace(/_/g, ' ')}
            </div>
            {Object.entries(changes).map(([path, { from, to }]) => (
              <div key={path} style={{ fontSize: '0.75rem', marginBottom: '4px', paddingLeft: '8px' }}>
                <span style={{ color: '#64748b' }}>{path}</span>
                <span style={{ color: '#ef4444', marginLeft: '8px' }}>
                  {formatVal(from)}
                </span>
                <span style={{ color: '#94a3b8', margin: '0 6px' }}>→</span>
                <span style={{ color: '#22c55e' }}>
                  {formatVal(to)}
                </span>
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}

function formatVal(v) {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'number') {
    return v > 1000 ? `$${v.toLocaleString()}` : v.toString()
  }
  return String(v)
}
