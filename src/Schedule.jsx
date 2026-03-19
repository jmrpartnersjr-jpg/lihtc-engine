import { useState, useMemo, useCallback } from "react";
import { useLihtc } from "./context/LihtcContext.jsx";

// ─────────────────────────────────────────────────────────────────────────────
// PROJECT SCHEDULE — LIHTC Engine
// Timeline phases with dependencies, cascading dates, and Gantt visualization.
// ─────────────────────────────────────────────────────────────────────────────

const fmtDate = d => {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt)) return "—";
  return `${String(dt.getMonth()+1).padStart(2,"0")}/${String(dt.getDate()).padStart(2,"0")}/${dt.getFullYear()}`;
};
const fmtDur = v => v == null ? "—" : Number(v).toFixed(1);

// Add months to a date (fractional months supported)
const addMonths = (dateStr, months) => {
  const d = new Date(dateStr);
  const totalDays = Math.round(months * 30.4375); // avg days per month
  d.setDate(d.getDate() + totalDays);
  return d.toISOString().slice(0, 10);
};

// Diff two dates in months
const diffMonths = (start, end) => {
  const s = new Date(start);
  const e = new Date(end);
  return Math.round(((e - s) / (1000 * 60 * 60 * 24) / 30.4375) * 10) / 10;
};

let _phaseId = Date.now();
const mkId = () => "p" + (++_phaseId);

// ─── DEFAULT SCHEDULE — Apollo SL Excel Reference ────────────────────────────
const DEFAULT_PHASES = [
  { id: "pd",    name: "Predevelopment Period",        months: 22.97, start: "2025-01-01", end: "2026-11-21", after: null,   isMilestone: false },
  { id: "wapp",  name: "WSHFC Application",            months: 2,     start: "2025-12-01", end: "2026-03-26", after: null,   isMilestone: false },
  { id: "wnot",  name: "WSHFC Notification",           months: 1.5,   start: "2026-03-26", end: "2026-05-10", after: "wapp", isMilestone: false },
  { id: "pfin",  name: "Project Financing",            months: 5.5,   start: "2026-05-10", end: "2026-10-22", after: "wnot", isMilestone: false },
  { id: "pact",  name: "Project Financing Activities",  months: 5.5,   start: "2026-05-10", end: "2026-10-22", after: "wnot", isMilestone: false },
  { id: "pclo",  name: "Project Closing",              months: 1,     start: "2026-10-22", end: "2026-11-21", after: "pfin", isMilestone: false },
  { id: "cons",  name: "Construction",                 months: 24,    start: "2026-12-06", end: "2028-11-25", after: null,   isMilestone: false },
  { id: "prel",  name: "Pre-Leasing",                  months: 3,     start: "2028-10-01", end: "2028-12-30", after: null,   isMilestone: false },
  { id: "coo",   name: "C of O",                       months: 0,     start: "2028-12-02", end: "2028-12-02", after: null,   isMilestone: true  },
  { id: "olse",  name: "On-site Leasing",              months: 7,     start: "2029-01-01", end: "2029-07-31", after: null,   isMilestone: false },
  { id: "focc",  name: "Full Occupancy",               months: 0,     start: "2029-08-01", end: "2029-08-01", after: "olse", isMilestone: true  },
  { id: "stab",  name: "Stabilization",                months: 3,     start: "2029-08-01", end: "2029-10-30", after: "olse", isMilestone: false },
  { id: "cperm", name: "Convert to Perm",              months: 1,     start: "2029-11-01", end: "2029-11-29", after: "stab", isMilestone: false },
  { id: "pcls",  name: "Perm Closing",                 months: 0,     start: "2029-11-29", end: "2029-11-29", after: "cperm",isMilestone: true  },
];

const DEFAULT_SCHEDULE = { phases: DEFAULT_PHASES };

// ─── COLORS ──────────────────────────────────────────────────────────────────
const NAVY   = "#1a3a6b";
const RED    = "#8B2500";
const GREEN  = "#1a6b3c";
const AMBER  = "#5a3a00";
const BG     = "#fafaf8";
const BORDER = "#e8e8e8";

const GANTT_COLORS = [
  "#3b7dd8", // blue
  "#5a9e6f", // green
  "#d4a54a", // gold
  "#c75b39", // terra cotta
  "#7b68ae", // purple
  "#3ba0a8", // teal
  "#d47b8a", // rose
  "#8a8a5c", // olive
];

// ─── PHASE ROW ───────────────────────────────────────────────────────────────
function PhaseRow({ phase, index, phases, onChange, onRemove }) {
  const cellStyle = { padding: "5px 8px", fontSize: 11, fontFamily: "Inter, sans-serif", whiteSpace: "nowrap" };
  const inputStyle = { padding: "3px 6px", border: `1px solid ${BORDER}`, borderRadius: 2,
    fontSize: 11, fontFamily: "Inter, sans-serif", outline: "none" };

  return (
    <tr style={{ borderBottom: `1px solid ${BORDER}`, background: phase.isMilestone ? "#fffbe6" : "white" }}>
      {/* Phase name */}
      <td style={cellStyle}>
        <input value={phase.name} onChange={e => onChange("name", e.target.value)}
          style={{ ...inputStyle, width: 210 }} />
      </td>

      {/* Duration */}
      <td style={{ ...cellStyle, textAlign: "right" }}>
        <input type="number" step="0.5" min="0" value={phase.months}
          onChange={e => {
            const m = Math.max(0, Number(e.target.value));
            onChange("months", m);
            // If milestone toggling
            if (m === 0 && !phase.isMilestone) onChange("isMilestone", true);
            if (m > 0 && phase.isMilestone) onChange("isMilestone", false);
          }}
          style={{ ...inputStyle, width: 65, textAlign: "right" }} />
      </td>

      {/* Dependency */}
      <td style={cellStyle}>
        <select value={phase.after || ""} onChange={e => onChange("after", e.target.value || null)}
          style={{ ...inputStyle, width: 170 }}>
          <option value="">Manual start</option>
          {phases.filter(p => p.id !== phase.id).map(p =>
            <option key={p.id} value={p.id}>After: {p.name.slice(0, 25)}</option>
          )}
        </select>
      </td>

      {/* Start date — editable only if no dependency */}
      <td style={cellStyle}>
        {phase.after ? (
          <span style={{ color: "#999", fontSize: 11 }}>{fmtDate(phase.start)}</span>
        ) : (
          <input type="date" value={phase.start || ""}
            onChange={e => onChange("start", e.target.value)}
            style={{ ...inputStyle, width: 130 }} />
        )}
      </td>

      {/* End date (calculated) */}
      <td style={{ ...cellStyle, color: "#555" }}>
        {fmtDate(phase.end)}
      </td>

      {/* Remove */}
      <td style={{ ...cellStyle, textAlign: "center" }}>
        <button onClick={onRemove}
          style={{ background: "none", border: "none", cursor: "pointer", color: "#ccc",
            fontSize: 13, lineHeight: 1 }}>✕</button>
      </td>
    </tr>
  );
}

// ─── GANTT CHART ─────────────────────────────────────────────────────────────
function GanttChart({ phases }) {
  // Find overall timeline range
  const allDates = phases.flatMap(p => [new Date(p.start), new Date(p.end)]).filter(d => !isNaN(d));
  if (allDates.length === 0) return null;
  const minDate = Math.min(...allDates);
  const maxDate = Math.max(...allDates);
  const range = maxDate - minDate || 1;

  // Build year markers
  const minYear = new Date(minDate).getFullYear();
  const maxYear = new Date(maxDate).getFullYear();
  const yearMarkers = [];
  for (let y = minYear; y <= maxYear + 1; y++) {
    const d = new Date(y, 0, 1).getTime();
    if (d >= minDate && d <= maxDate) {
      yearMarkers.push({ year: y, pct: ((d - minDate) / range) * 100 });
    }
  }

  return (
    <div style={{ marginTop: 20, background: "white", border: `1px solid ${BORDER}`, borderRadius: 6,
      padding: "16px 20px", position: "relative" }}>
      <h3 style={{ fontFamily: "'Playfair Display', serif", fontSize: 14, color: NAVY,
        margin: "0 0 14px 0", fontWeight: 600 }}>Project Timeline</h3>

      {/* Year markers */}
      <div style={{ position: "relative", height: 18, marginBottom: 4, borderBottom: `1px solid ${BORDER}` }}>
        {yearMarkers.map(ym => (
          <div key={ym.year} style={{ position: "absolute", left: `${ym.pct}%`, top: 0,
            fontSize: 9, color: "#999", fontFamily: "Inter, sans-serif", transform: "translateX(-50%)" }}>
            {ym.year}
          </div>
        ))}
      </div>

      {/* Bars */}
      {phases.map((phase, i) => {
        const s = new Date(phase.start).getTime();
        const e = new Date(phase.end).getTime();
        if (isNaN(s) || isNaN(e)) return null;
        const leftPct = ((s - minDate) / range) * 100;
        const widthPct = ((e - s) / range) * 100;
        const color = GANTT_COLORS[i % GANTT_COLORS.length];

        return (
          <div key={phase.id} style={{ display: "flex", alignItems: "center", height: 22, marginBottom: 2 }}>
            {/* Label */}
            <div style={{ width: 180, fontSize: 9, fontFamily: "Inter, sans-serif", color: "#555",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexShrink: 0,
              paddingRight: 8 }}>
              {phase.name}
            </div>
            {/* Bar area */}
            <div style={{ flex: 1, position: "relative", height: "100%" }}>
              {/* Year gridlines */}
              {yearMarkers.map(ym => (
                <div key={ym.year} style={{ position: "absolute", left: `${ym.pct}%`, top: 0,
                  bottom: 0, width: 1, background: "#f0f0f0" }} />
              ))}
              {phase.isMilestone ? (
                // Diamond milestone marker
                <div style={{ position: "absolute", left: `${leftPct}%`, top: "50%",
                  transform: "translate(-50%, -50%) rotate(45deg)",
                  width: 10, height: 10, background: RED, border: "1px solid #6b1a00" }} />
              ) : (
                // Duration bar
                <div style={{ position: "absolute", left: `${leftPct}%`, width: `${Math.max(widthPct, 0.3)}%`,
                  top: 3, height: 14, background: color, borderRadius: 2, opacity: 0.85,
                  minWidth: 2 }} />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────
export default function SchedulePanel() {
  const { moduleStates, updateModule } = useLihtc();
  const sched = moduleStates.schedule || DEFAULT_SCHEDULE;
  const phases = sched.phases || DEFAULT_PHASES;

  // ── Resolve dependencies & cascade dates ──────────────────────────────────
  const resolvedPhases = useMemo(() => {
    const byId = {};
    const result = phases.map(p => ({ ...p }));

    // Multiple passes to resolve chains (max 10 to prevent infinite loops)
    for (let pass = 0; pass < 10; pass++) {
      let changed = false;
      result.forEach(p => { byId[p.id] = p; });

      for (const phase of result) {
        if (phase.after && byId[phase.after]) {
          const pred = byId[phase.after];
          const newStart = pred.end;
          if (newStart && newStart !== phase.start) {
            phase.start = newStart;
            phase.end = phase.months === 0 ? newStart : addMonths(newStart, phase.months);
            changed = true;
          }
        }
        // Recalc end from start + duration if no dependency changed it
        if (phase.start && !phase.after) {
          const calcEnd = phase.months === 0 ? phase.start : addMonths(phase.start, phase.months);
          if (calcEnd !== phase.end) {
            phase.end = calcEnd;
            changed = true;
          }
        }
      }
      if (!changed) break;
    }
    return result;
  }, [phases]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleChange = useCallback((index, field, value) => {
    const next = phases.map((p, i) => {
      if (i !== index) return p;
      const updated = { ...p, [field]: value };

      // Recalc end when duration or start changes
      if (field === "months" || field === "start") {
        const m = field === "months" ? value : p.months;
        const s = field === "start" ? value : p.start;
        if (s) {
          updated.end = m === 0 ? s : addMonths(s, m);
          if (m === 0) updated.isMilestone = true;
        }
      }

      // When dependency changes, recalc start from predecessor end
      if (field === "after") {
        if (value) {
          const pred = phases.find(pp => pp.id === value);
          if (pred && pred.end) {
            updated.start = pred.end;
            updated.end = updated.months === 0 ? pred.end : addMonths(pred.end, updated.months);
          }
        }
      }

      return updated;
    });
    updateModule("schedule", { phases: next });
  }, [phases, updateModule]);

  const handleRemove = useCallback((index) => {
    const removed = phases[index];
    // Clear dependencies pointing to the removed phase
    const next = phases.filter((_, i) => i !== index).map(p =>
      p.after === removed.id ? { ...p, after: null } : p
    );
    updateModule("schedule", { phases: next });
  }, [phases, updateModule]);

  const handleAdd = useCallback(() => {
    const lastPhase = phases[phases.length - 1];
    const newStart = lastPhase?.end || new Date().toISOString().slice(0, 10);
    const newPhase = {
      id: mkId(),
      name: "New Phase",
      months: 1,
      start: newStart,
      end: addMonths(newStart, 1),
      after: lastPhase?.id || null,
      isMilestone: false,
    };
    updateModule("schedule", { phases: [...phases, newPhase] });
  }, [phases, updateModule]);

  // ── Total duration ────────────────────────────────────────────────────────
  const totalDuration = useMemo(() => {
    const starts = resolvedPhases.map(p => new Date(p.start)).filter(d => !isNaN(d));
    const ends   = resolvedPhases.map(p => new Date(p.end)).filter(d => !isNaN(d));
    if (!starts.length || !ends.length) return null;
    const earliest = new Date(Math.min(...starts));
    const latest   = new Date(Math.max(...ends));
    return diffMonths(earliest.toISOString().slice(0,10), latest.toISOString().slice(0,10));
  }, [resolvedPhases]);

  // ── Header styles ─────────────────────────────────────────────────────────
  const thStyle = {
    padding: "8px 8px", fontSize: 10, fontFamily: "Inter, sans-serif",
    fontWeight: 600, color: "white", textAlign: "left", whiteSpace: "nowrap",
    position: "sticky", top: 0, zIndex: 2, background: NAVY,
  };

  return (
    <div style={{ padding: "24px 32px", fontFamily: "Inter, sans-serif", background: BG, minHeight: "100vh" }}>

      {/* Title Row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16 }}>
        <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, color: NAVY,
          margin: 0, fontWeight: 700 }}>Project Schedule</h2>
        {totalDuration != null && (
          <span style={{ fontSize: 13, color: NAVY, fontWeight: 600 }}>
            Total Duration: {fmtDur(totalDuration)} months
          </span>
        )}
      </div>

      {/* Summary bar */}
      <div style={{ display: "flex", gap: 24, marginBottom: 18, flexWrap: "wrap" }}>
        {resolvedPhases.length > 0 && (() => {
          const starts = resolvedPhases.map(p => new Date(p.start)).filter(d => !isNaN(d));
          const ends   = resolvedPhases.map(p => new Date(p.end)).filter(d => !isNaN(d));
          const earliest = starts.length ? new Date(Math.min(...starts)) : null;
          const latest   = ends.length ? new Date(Math.max(...ends)) : null;
          const milestones = resolvedPhases.filter(p => p.isMilestone).length;
          return (
            <>
              <div style={{ background: "white", border: `1px solid ${BORDER}`, borderRadius: 6,
                padding: "10px 18px", minWidth: 140 }}>
                <div style={{ fontSize: 9, color: "#999", textTransform: "uppercase", letterSpacing: 0.5 }}>Project Start</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: NAVY, marginTop: 2 }}>{earliest ? fmtDate(earliest.toISOString().slice(0,10)) : "—"}</div>
              </div>
              <div style={{ background: "white", border: `1px solid ${BORDER}`, borderRadius: 6,
                padding: "10px 18px", minWidth: 140 }}>
                <div style={{ fontSize: 9, color: "#999", textTransform: "uppercase", letterSpacing: 0.5 }}>Project End</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: NAVY, marginTop: 2 }}>{latest ? fmtDate(latest.toISOString().slice(0,10)) : "—"}</div>
              </div>
              <div style={{ background: "white", border: `1px solid ${BORDER}`, borderRadius: 6,
                padding: "10px 18px", minWidth: 100 }}>
                <div style={{ fontSize: 9, color: "#999", textTransform: "uppercase", letterSpacing: 0.5 }}>Phases</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: NAVY, marginTop: 2 }}>{resolvedPhases.length}</div>
              </div>
              <div style={{ background: "white", border: `1px solid ${BORDER}`, borderRadius: 6,
                padding: "10px 18px", minWidth: 100 }}>
                <div style={{ fontSize: 9, color: "#999", textTransform: "uppercase", letterSpacing: 0.5 }}>Milestones</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: RED, marginTop: 2 }}>{milestones}</div>
              </div>
            </>
          );
        })()}
      </div>

      {/* Phase Table */}
      <div style={{ background: "white", border: `1px solid ${BORDER}`, borderRadius: 6,
        overflow: "auto", maxHeight: 500 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead>
            <tr>
              <th style={thStyle}>Phase</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Duration (mo)</th>
              <th style={thStyle}>Dependency</th>
              <th style={thStyle}>Start Date</th>
              <th style={thStyle}>End Date</th>
              <th style={{ ...thStyle, width: 36, textAlign: "center" }}></th>
            </tr>
          </thead>
          <tbody>
            {resolvedPhases.map((phase, i) => (
              <PhaseRow key={phase.id} phase={phase} index={i} phases={resolvedPhases}
                onChange={(field, val) => handleChange(i, field, val)}
                onRemove={() => handleRemove(i)} />
            ))}
          </tbody>
        </table>
      </div>

      {/* Add Phase */}
      <button onClick={handleAdd}
        style={{ marginTop: 10, padding: "6px 16px", background: NAVY, color: "white",
          border: "none", borderRadius: 4, fontSize: 11, fontFamily: "Inter, sans-serif",
          cursor: "pointer", fontWeight: 600 }}>
        + Add Phase
      </button>

      {/* Gantt Chart */}
      <GanttChart phases={resolvedPhases} />
    </div>
  );
}
