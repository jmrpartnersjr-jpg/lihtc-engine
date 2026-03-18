import { useState, useEffect, useMemo, useRef } from "react";
import { useLihtc } from "./context/LihtcContext.jsx";
import { computeBudgetCalcs, computeLIHTC } from "./lihtcCalcs.js";

// ─────────────────────────────────────────────────────────────────────────────
// MODULE 2B — CONSTRUCTION CASH FLOW ENGINE
// Monthly draw schedule with iterative interest convergence.
// Sources fill monthly need in priority order (Scheduled → Flex → Loan).
// Auto-converges construction interest on mount / input change.
// Outputs exact construction + lease-up interest back to Module 2A.
// ─────────────────────────────────────────────────────────────────────────────

const fmt$  = v => v == null ? "—" : "$" + Math.round(v).toLocaleString();
const fmtPct = v => v == null ? "—" : (v * 100).toFixed(2) + "%";

// ─── S-CURVE GENERATOR ───────────────────────────────────────────────────────
const SCURVE_SHAPES = {
  flat:   { label: "Flat",   peak: 0.50, sharpness: 0.5  },
  medium: { label: "Medium", peak: 0.55, sharpness: 1.5  },
  steep:  { label: "Steep",  peak: 0.60, sharpness: 3.0  },
};

function generateSCurve(months, shape = "medium") {
  if (months <= 0) return [];
  const cfg = SCURVE_SHAPES[shape] || SCURVE_SHAPES.medium;
  const peak = Math.round(months * cfg.peak);
  if (shape === "flat") return Array(months).fill(1 / months);

  const raw = [];
  for (let i = 0; i < months; i++) {
    let v;
    if (shape === "steep") {
      const t = i / (months - 1);
      v = Math.pow(0.5 - 0.5 * Math.cos(Math.PI * t), 0.5);
    } else {
      v = i <= peak
        ? Math.pow((i + 1) / (peak + 1), cfg.sharpness)
        : Math.pow((months - i) / (months - peak), cfg.sharpness);
    }
    raw.push(Math.max(0.001, v));
  }
  if (shape === "steep") {
    const diffs = raw.map((v, i) => i === 0 ? v : v - raw[i - 1]);
    const pos = diffs.map(v => Math.max(0.001, v));
    const sum = pos.reduce((s, v) => s + v, 0);
    return pos.map(v => v / sum);
  }
  const sum = raw.reduce((s, v) => s + v, 0);
  return raw.map(v => v / sum);
}

// ─── USE CATEGORY KEYS (order matters for display) ──────────────────────────
const USE_KEYS = [
  "acquisition", "hardCosts", "softCosts",
  "financing",
  "orgCosts", "devFeeCash", "deferredDevFee",
  "interest",
];
const USE_LABELS = {
  acquisition:    "Acquisition",
  hardCosts:      "Hard Costs",
  softCosts:      "Soft Costs",
  financing:      "Financing",
  orgCosts:       "Org / Reserves",
  devFeeCash:     "Cash Dev Fee",
  deferredDevFee: "Deferred Dev Fee",
  interest:       "Interest",
};

// ─── CORE ENGINE ────────────────────────────────────────────────────────────
function buildSchedule(params, interestEst) {
  const {
    constructionMonths, leaseupMonths, stabilizedMonths,
    uses, sources, teRate, taxableRate, teLoanMax, taxableLoanMax,
    drawCurve, closingDate,
  } = params;

  const totalMonths = 1 + constructionMonths + leaseupMonths + stabilizedMonths + 1; // +1 for conversion month
  const convMonth = 1 + constructionMonths + leaseupMonths + stabilizedMonths; // conversion is the final event

  // Generate spend curves
  const hcCurve = generateSCurve(constructionMonths, drawCurve);
  const scCurve = generateSCurve(constructionMonths, "flat");

  // Build monthly uses
  const monthlyUses = [];
  for (let m = 0; m < totalMonths; m++) {
    const isClosing = m === 0;
    const constIdx = m - 1;
    const isConst = m >= 1 && m <= constructionMonths;

    const mu = {
      acquisition: 0, hardCosts: 0, softCosts: 0,
      financing: 0,
      orgCosts: 0, devFeeCash: 0, deferredDevFee: 0,
      interest: 0,
    };

    if (isClosing) {
      mu.acquisition = uses.acquisition;
      mu.financing   = uses.financing;
      mu.orgCosts    = uses.orgClosing;
      mu.softCosts   = uses.softClosing;
    } else if (isConst) {
      mu.hardCosts = uses.hardCosts * hcCurve[constIdx];
      mu.softCosts = uses.softRemaining * scCurve[constIdx];
    }
    // Dev fee: driven by editable schedule (any month)
    if (uses.devFeeByMonth[m]) {
      mu.devFeeCash = uses.devFeeByMonth[m];
    }
    // Conversion: deferred dev fee + remaining org costs
    if (m === convMonth) {
      mu.deferredDevFee = uses.deferredDevFee;
      mu.orgCosts      += uses.orgConversion;
    }
    monthlyUses.push(mu);
  }

  // ── SOURCE WATERFALL ──────────────────────────────────────────────────────
  // Convert context sources to working state
  const sourceList = sources.map(s => ({
    ...s,
    drawn: 0,
    monthlyDraws: new Array(totalMonths).fill(0),
  }));

  let teLoanBalance = 0, taxableLoanBalance = 0;
  const teMonthlyRate = teRate / 12;
  const taxableMonthlyRate = taxableRate / 12;

  const rows = [];

  for (let m = 0; m < totalMonths; m++) {
    const isConst      = m >= 1 && m <= constructionMonths;
    const isLeaseup    = m > constructionMonths && m <= constructionMonths + leaseupMonths;
    const isStabilized = m > constructionMonths + leaseupMonths && m < convMonth;
    const isConversion = m === convMonth;

    // Interest this month from prior balances
    const teInt      = teLoanBalance * teMonthlyRate;
    const taxableInt = taxableLoanBalance * taxableMonthlyRate;
    const intThisMonth = teInt + taxableInt;

    const mu = monthlyUses[m];
    mu.interest = intThisMonth;

    const nonIntTotal = USE_KEYS.filter(k => k !== "interest")
      .reduce((s, k) => s + mu[k], 0);
    const totalNeed = nonIntTotal + intThisMonth;
    let remainingNeed = totalNeed;

    // 1. Scheduled sources — drawn at specific months per schedule
    //    Schedule entries can have {month, amount} or {month, pct} (pct of total)
    //    Sources with paydown_loans: true → excess after covering uses pays down construction loans
    let totalScheduledPaydownCapable = 0; // total from paydown-capable sources this month

    for (const s of sourceList) {
      if (s.mode !== 'scheduled' || !s.schedule) continue;
      const entry = s.schedule.find(e => e.month === m);
      if (!entry) continue;
      // Compute draw amount — support both absolute and pct-based
      const entryAmt = entry.amount != null ? entry.amount : (entry.pct || 0) * s.amount;
      if (entryAmt <= 0) continue;
      const draw = Math.min(entryAmt, s.amount - s.drawn);
      s.drawn += draw;
      s.monthlyDraws[m] += draw;
      remainingNeed -= draw;
      if (s.paydown_loans) totalScheduledPaydownCapable += draw;
    }

    // 2. Flex sources by priority (only if still need after scheduled)
    if (remainingNeed > 0) {
      const flexSources = sourceList
        .filter(s => s.mode === 'flex')
        .sort((a, b) => (a.priority || 99) - (b.priority || 99));

      for (const s of flexSources) {
        if (remainingNeed <= 0) break;
        const avail = s.amount - s.drawn;
        if (avail <= 0) continue;
        const draw = Math.min(remainingNeed, avail);
        s.drawn += draw;
        s.monthlyDraws[m] += draw;
        remainingNeed -= draw;
      }
    }

    // 3. Loan sources — TE first, then taxable (only draw if still need)
    //    Available capacity = commitment max − current balance (NOT cumulative draws).
    //    Paydowns reduce the balance, freeing capacity to re-draw in later months.
    const teLoan = sourceList.find(s => s.mode === 'loan' && s.name.toLowerCase().includes('tax exempt'));
    const taxLoan = sourceList.find(s => s.mode === 'loan' && s.name.toLowerCase().includes('taxable'));

    if (remainingNeed > 0 && teLoan) {
      const avail = teLoan.amount - teLoanBalance;   // capacity = max commitment − outstanding balance
      const draw = Math.min(remainingNeed, Math.max(0, avail));
      if (draw > 0) {
        teLoan.drawn += draw;
        teLoan.monthlyDraws[m] += draw;
        teLoanBalance += draw;
        remainingNeed -= draw;
      }
    }
    if (remainingNeed > 0 && taxLoan) {
      const avail = taxLoan.amount - taxableLoanBalance;  // capacity = max commitment − outstanding balance
      const draw = Math.min(remainingNeed, Math.max(0, avail));
      if (draw > 0) {
        taxLoan.drawn += draw;
        taxLoan.monthlyDraws[m] += draw;
        taxableLoanBalance += draw;
        remainingNeed -= draw;
      }
    }

    // 4. Apply paydown — if scheduled paydown-capable sources generated a surplus
    //    (remainingNeed < 0), that surplus pays down construction loans.
    //    Priority: taxable first, then TE (per LIHTC convention)
    //    Paydowns reduce the BALANCE, freeing capacity for re-draws in subsequent months.
    if (remainingNeed < -0.5 && totalScheduledPaydownCapable > 0) {
      let paydownAmt = Math.min(Math.abs(remainingNeed), totalScheduledPaydownCapable);
      const totalLoanBal = teLoanBalance + taxableLoanBalance;

      // Pay down taxable first
      if (paydownAmt > 0 && taxableLoanBalance > 0) {
        const taxPay = Math.min(paydownAmt, taxableLoanBalance);
        taxableLoanBalance -= taxPay;
        paydownAmt -= taxPay;
      }
      // Then TE
      if (paydownAmt > 0 && teLoanBalance > 0) {
        const tePay = Math.min(paydownAmt, teLoanBalance);
        teLoanBalance -= tePay;
        paydownAmt -= tePay;
      }

      // After paydowns: surplus = sources available minus (uses + loan retirement)
      // If paydownAmt > 0, loans were fully retired with cash left over → surplus
      // If loans still outstanding, remaining balance is absorbed (gap shows at conversion)
      remainingNeed = -(paydownAmt);  // positive paydownAmt remaining = surplus (negative remainingNeed)
    }

    // 5. At conversion, check for unretired construction loan balance (gap)
    //    or true surplus (all loans retired with cash left over).
    if (isConversion) {
      const unretiredBalance = teLoanBalance + taxableLoanBalance;
      if (unretiredBalance > 0.5) {
        // Gap: not enough to retire construction loans
        remainingNeed = unretiredBalance;
      }
      // If remainingNeed < 0 at this point, that's a true surplus — let it pass through
    }

    // Compute month label from closing date
    let monthLabel;
    if (closingDate) {
      const d = new Date(closingDate);
      d.setMonth(d.getMonth() + m);
      monthLabel = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    } else {
      monthLabel = `Mo ${m}`;
    }

    const period = m === 0 ? 'Closing'
      : isConst ? 'Construction'
      : isLeaseup ? 'Lease-Up'
      : isStabilized ? 'Stabilized'
      : 'Conversion';

    const totalSources = sourceList.reduce((s, src) => s + src.monthlyDraws[m], 0);

    rows.push({
      month: m,
      monthLabel,
      period,
      uses: { ...mu, total: totalNeed },
      sourceDraws: Object.fromEntries(sourceList.map(s => [s.name, s.monthlyDraws[m]])),
      totalSources,
      teLoanBalance,
      taxableLoanBalance,
      surplus: -remainingNeed,  // negative = gap, positive = true surplus (after paydowns)
    });
  }

  // Compute interest totals
  const totalConstInterest = rows
    .filter(r => r.period === 'Construction')
    .reduce((s, r) => s + r.uses.interest, 0);
  const totalLeaseupInterest = rows
    .filter(r => r.period === 'Lease-Up' || r.period === 'Stabilized' || r.period === 'Conversion')
    .reduce((s, r) => s + r.uses.interest, 0);

  // Peak loan balances — max outstanding at any point (what the lender's commitment must cover)
  const peakTeBalance      = rows.reduce((mx, r) => Math.max(mx, r.teLoanBalance), 0);
  const peakTaxableBalance = rows.reduce((mx, r) => Math.max(mx, r.taxableLoanBalance), 0);

  return {
    rows,
    sourceList,
    totalConstInterest,
    totalLeaseupInterest,
    totalInterest: totalConstInterest + totalLeaseupInterest,
    teLoanPeak: peakTeBalance,
    taxableLoanPeak: peakTaxableBalance,
    finalTeLoanBalance: rows[rows.length - 1]?.teLoanBalance ?? 0,
    finalTaxableLoanBalance: rows[rows.length - 1]?.taxableLoanBalance ?? 0,
  };
}

// ── CONVERGENCE ─────────────────────────────────────────────────────────────
function converge(params, startingEst, maxIter = 20) {
  let est = startingEst;
  let result = null;
  let iterations = 0;
  for (let i = 0; i < maxIter; i++) {
    result = buildSchedule(params, est);
    const delta = Math.abs(result.totalConstInterest - est);
    iterations = i + 1;
    if (delta < 1) break;
    est = result.totalConstInterest * 0.7 + est * 0.3;
  }
  return { ...result, iterations, finalInterestEst: est };
}

// ─── DEFAULT STATE ──────────────────────────────────────────────────────────
const DEFAULT_CF = {
  construction_period_months: 24,
  leaseup_period_months:      7,
  stabilized_months:          4,
  construction_start_date:    "2026-11-21",
  draw_curve_hard_costs:      "medium",
  // Rates and loan amounts — sourced from Debt tab (no local overrides)
  closing_soft_pct:           0.27,
  closing_org_pct:            0.30,
  closing_dev_fee_pct:        0.25,
  // Editable equity pay-in schedule (milestone-based)
  equity_schedule: [
    { label: "Closing",     month: 0,  pct: 10 },
    { label: "CofO",        month: 25, pct: 65 },
    { label: "Pre-Stab",    month: 33, pct: 5  },
    { label: "Conversion",  month: 36, pct: 20 },
  ],
  // Editable cash dev fee schedule
  dev_fee_schedule: [
    { label: "Closing",     month: 0,  pct: 25 },
    { label: "Conversion",  month: 36, pct: 75 },
  ],
};

// ─── PERIOD COLORS ──────────────────────────────────────────────────────────
const PERIOD_BG = {
  'Closing':      { bg: "#eef2f8", border: "#c8d6e8", text: "#1a3a6b" },
  'Construction': { bg: "#fdf6f3", border: "#f0d6cb", text: "#8B2500" },
  'Lease-Up':     { bg: "#fdf8f0", border: "#e8d9b8", text: "#5a3a00" },
  'Stabilized':   { bg: "#f0f9f4", border: "#b8dfc8", text: "#1a6b3c" },
  'Conversion':   { bg: "#f5f0f9", border: "#d0b8e0", text: "#4a1a6b" },
};

// ─── SMALL COMPONENTS ───────────────────────────────────────────────────────

function NumInput({ value, onChange, step, min, max, pct, width = 90 }) {
  const display = pct ? +(value * 100).toFixed(2) : value;
  return (
    <input type="number" value={display ?? ""} step={step || (pct ? 0.1 : 1)}
      min={min} max={max}
      onChange={e => onChange(pct ? Number(e.target.value) / 100 : Number(e.target.value))}
      style={{ background:"#f8f8f8", border:"1px solid #e0e0e0", borderRadius:4,
        padding:"4px 8px", fontSize:11, fontFamily:"Inter, sans-serif", color:"#111",
        outline:"none", width, textAlign:"right" }} />
  );
}

// ─── SCHEDULE EDITOR ────────────────────────────────────────────────────────
// Editable milestone table: label (editable), month #, pct, computed $
function ScheduleEditor({ title, schedule, onChange, totalAmount, color = "#1a3a6b" }) {
  const totalPct = schedule.reduce((s, r) => s + (r.pct || 0), 0);
  const inpStyle = {
    background:"#f8f8f8", border:"1px solid #e0e0e0", borderRadius:3,
    padding:"3px 5px", fontSize:10, fontFamily:"Inter, sans-serif", color:"#111",
    outline:"none", textAlign:"right",
  };

  const updateRow = (idx, patch) => {
    const next = schedule.map((r, i) => i === idx ? { ...r, ...patch } : r);
    onChange(next);
  };
  const addRow = () => onChange([...schedule, { label: "", month: 0, pct: 0 }]);
  const removeRow = (idx) => onChange(schedule.filter((_, i) => i !== idx));

  return (
    <div style={{ marginBottom:10 }}>
      <div style={{ fontSize:9, fontWeight:700, color, textTransform:"uppercase",
        letterSpacing:"0.07em", marginBottom:6 }}>{title}</div>
      <table style={{ width:"100%", borderCollapse:"collapse", fontSize:9, fontFamily:"Inter, sans-serif" }}>
        <thead>
          <tr style={{ borderBottom:"1px solid #e0e0e0" }}>
            <th style={{ textAlign:"left", padding:"3px 4px", color:"#888", fontWeight:600 }}>Milestone</th>
            <th style={{ textAlign:"right", padding:"3px 4px", color:"#888", fontWeight:600, width:40 }}>Mo</th>
            <th style={{ textAlign:"right", padding:"3px 4px", color:"#888", fontWeight:600, width:40 }}>%</th>
            <th style={{ textAlign:"right", padding:"3px 4px", color:"#888", fontWeight:600, width:65 }}>Amount</th>
            <th style={{ width:18 }}></th>
          </tr>
        </thead>
        <tbody>
          {schedule.map((row, i) => (
            <tr key={i} style={{ borderBottom:"1px solid #f5f5f5" }}>
              <td style={{ padding:"2px 2px" }}>
                <input value={row.label} onChange={e => updateRow(i, { label: e.target.value })}
                  style={{ ...inpStyle, textAlign:"left", width:"100%", background:"transparent", border:"none" }} />
              </td>
              <td style={{ padding:"2px 2px" }}>
                <input type="number" value={row.month} min={0} max={60} step={1}
                  onChange={e => updateRow(i, { month: Number(e.target.value) })}
                  style={{ ...inpStyle, width:35 }} />
              </td>
              <td style={{ padding:"2px 2px" }}>
                <input type="number" value={row.pct} min={0} max={100} step={1}
                  onChange={e => updateRow(i, { pct: Number(e.target.value) })}
                  style={{ ...inpStyle, width:35 }} />
              </td>
              <td style={{ padding:"2px 4px", textAlign:"right", color:"#666", fontSize:9 }}>
                {"$" + Math.round(totalAmount * (row.pct / 100)).toLocaleString()}
              </td>
              <td style={{ padding:"2px 0" }}>
                <button onClick={() => removeRow(i)}
                  style={{ background:"none", border:"none", cursor:"pointer", color:"#ccc",
                    fontSize:11, padding:0, lineHeight:1 }} title="Remove">×</button>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ borderTop:"1px solid #e0e0e0" }}>
            <td style={{ padding:"3px 4px" }}>
              <button onClick={addRow}
                style={{ background:"none", border:"none", cursor:"pointer", color, fontSize:9,
                  padding:0, fontWeight:600 }}>+ Add</button>
            </td>
            <td></td>
            <td style={{ textAlign:"right", padding:"3px 4px", fontWeight:700,
              color: Math.abs(totalPct - 100) < 0.1 ? "#1a6b3c" : "#c41a1a" }}>
              {totalPct}%
            </td>
            <td style={{ textAlign:"right", padding:"3px 4px", fontWeight:600, color:"#111", fontSize:9 }}>
              {"$" + Math.round(totalAmount * totalPct / 100).toLocaleString()}
            </td>
            <td></td>
          </tr>
        </tfoot>
      </table>
      {Math.abs(totalPct - 100) > 0.1 && (
        <div style={{ fontSize:8, color:"#c41a1a", marginTop:2 }}>
          Total must equal 100% (currently {totalPct}%)
        </div>
      )}
    </div>
  );
}

function FieldRow({ label, note, children }) {
  return (
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8, gap:12 }}>
      <div>
        <div style={{ fontSize:10, color:"#444", fontFamily:"Inter, sans-serif" }}>{label}</div>
        {note && <div style={{ fontSize:8, color:"#bbb", fontFamily:"Inter, sans-serif" }}>{note}</div>}
      </div>
      <div style={{ flexShrink:0 }}>{children}</div>
    </div>
  );
}

// ─── PHASE SUMMARY ──────────────────────────────────────────────────────────
function PhaseSummaryBar({ result, sources }) {
  if (!result) return null;
  const phases = ['Closing', 'Construction', 'Lease-Up', 'Stabilized', 'Conversion'];
  const phaseData = phases.map(p => {
    const phaseRows = result.rows.filter(r => r.period === p);
    if (phaseRows.length === 0) return null;
    const totalUses = phaseRows.reduce((s, r) => s + r.uses.total, 0);
    const totalSrc  = phaseRows.reduce((s, r) => s + r.totalSources, 0);
    const gap = phaseRows.reduce((s, r) => s + r.surplus, 0); // uses row-level surplus (accounts for paydowns)
    return { phase: p, months: phaseRows.length, totalUses, totalSrc, gap };
  }).filter(Boolean);

  return (
    <div style={{ display:"flex", gap:8, marginBottom:16 }}>
      {phaseData.map(pd => {
        const c = PERIOD_BG[pd.phase] || PERIOD_BG.Construction;
        const hasGap = pd.gap < -100;
        return (
          <div key={pd.phase} style={{ flex:1, background: c.bg, border:`1px solid ${c.border}`,
            borderRadius:6, padding:"10px 12px" }}>
            <div style={{ fontSize:8, fontWeight:700, color: c.text, textTransform:"uppercase",
              letterSpacing:"0.07em", marginBottom:6 }}>
              {pd.phase} <span style={{ fontWeight:400, opacity:0.6 }}>({pd.months}mo)</span>
            </div>
            <div style={{ fontSize:9, color:"#666", marginBottom:2 }}>
              Uses: <span style={{ fontWeight:600, color:"#111" }}>{fmt$(pd.totalUses)}</span>
            </div>
            <div style={{ fontSize:9, color:"#666", marginBottom:2 }}>
              Sources: <span style={{ fontWeight:600, color:"#111" }}>{fmt$(pd.totalSrc)}</span>
            </div>
            <div style={{ fontSize:10, fontWeight:700,
              color: hasGap ? "#c41a1a" : "#1a6b3c", marginTop:4 }}>
              {hasGap ? `Gap: (${fmt$(Math.abs(pd.gap))})` : `OK: +${fmt$(pd.gap)}`}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── VERTICAL MONTHLY TABLE ─────────────────────────────────────────────────
// Months as rows, uses and sources as columns — like the Excel model
function VerticalCFTable({ result, sourceNames }) {
  const [expandedPhases, setExpandedPhases] = useState({
    Closing: true, Construction: false, 'Lease-Up': false,
    Conversion: true, Stabilized: false,
  });

  if (!result) return null;

  const togglePhase = (phase) => {
    setExpandedPhases(prev => ({ ...prev, [phase]: !prev[phase] }));
  };

  // Group rows by phase
  const phases = [];
  let currentPhase = null;
  for (const row of result.rows) {
    if (row.period !== currentPhase) {
      currentPhase = row.period;
      phases.push({ phase: currentPhase, rows: [] });
    }
    phases[phases.length - 1].rows.push(row);
  }

  const useCols = USE_KEYS;
  const srcCols = sourceNames;

  const cellBase = {
    padding: "4px 8px", fontSize: 10, fontFamily: "Inter, sans-serif",
    textAlign: "right", whiteSpace: "nowrap", borderBottom: "1px solid #f0f0f0",
  };
  const headerCell = {
    ...cellBase, fontSize: 8, fontWeight: 700, color: "#888",
    textTransform: "uppercase", letterSpacing: "0.05em",
    position: "sticky", top: 0, background: "#f5f5f5", zIndex: 2,
    borderBottom: "2px solid #e0e0e0", textAlign: "center",
  };

  const renderRow = (row, idx, phaseColor) => {
    const usesTotal = row.uses.total;
    const srcTotal = row.totalSources;
    const gap = row.surplus;
    const isGap = gap < -100;

    return (
      <tr key={row.month} style={{ background: idx % 2 === 0 ? "white" : "#fafafa" }}>
        {/* Month label — sticky */}
        <td style={{ ...cellBase, textAlign:"left", fontWeight:600, color: phaseColor,
          position:"sticky", left:0, zIndex:1, background: idx % 2 === 0 ? "white" : "#fafafa",
          borderRight:"2px solid #e0e0e0", minWidth:70 }}>
          {row.monthLabel}
        </td>

        {/* Uses columns */}
        {useCols.map(k => {
          const v = row.uses[k];
          return (
            <td key={k} style={{ ...cellBase, color: v > 0.5 ? "#444" : "#ddd",
              fontWeight: k === "interest" ? 600 : 400,
              fontStyle: k === "interest" ? "italic" : "normal" }}>
              {v > 0.5 ? fmt$(v) : "—"}
            </td>
          );
        })}

        {/* Total uses */}
        <td style={{ ...cellBase, fontWeight:700, color:"#111",
          borderLeft:"2px solid #e0e0e0", borderRight:"2px solid #e0e0e0" }}>
          {fmt$(usesTotal)}
        </td>

        {/* Source columns */}
        {srcCols.map(name => {
          const v = row.sourceDraws[name] || 0;
          return (
            <td key={name} style={{ ...cellBase, color: v > 0.5 ? "#1a3a6b" : "#ddd" }}>
              {v > 0.5 ? fmt$(v) : "—"}
            </td>
          );
        })}

        {/* Total sources */}
        <td style={{ ...cellBase, fontWeight:700, color:"#1a3a6b",
          borderLeft:"2px solid #e0e0e0", borderRight:"2px solid #e0e0e0" }}>
          {fmt$(srcTotal)}
        </td>

        {/* Gap */}
        <td style={{ ...cellBase, fontWeight:700,
          color: isGap ? "#c41a1a" : "#1a6b3c",
          background: isGap ? "#fff0f0" : (idx % 2 === 0 ? "white" : "#fafafa") }}>
          {isGap ? `(${fmt$(Math.abs(gap))})` : gap > 100 ? `+${fmt$(gap)}` : "—"}
        </td>

        {/* TE Balance */}
        <td style={{ ...cellBase, color:"#1a3a6b", fontWeight:500 }}>
          {row.teLoanBalance > 0 ? fmt$(row.teLoanBalance) : "—"}
        </td>
      </tr>
    );
  };

  // Phase summary row
  const renderPhaseSummary = (phaseGroup) => {
    const c = PERIOD_BG[phaseGroup.phase] || PERIOD_BG.Construction;
    const totUses = phaseGroup.rows.reduce((s, r) => s + r.uses.total, 0);
    const totSrc  = phaseGroup.rows.reduce((s, r) => s + r.totalSources, 0);
    const gap = phaseGroup.rows.reduce((s, r) => s + r.surplus, 0);
    const isExpanded = expandedPhases[phaseGroup.phase];

    return (
      <tr key={`phase-${phaseGroup.phase}`}
        onClick={() => togglePhase(phaseGroup.phase)}
        style={{ cursor: "pointer", background: c.bg, borderTop: `2px solid ${c.border}` }}>
        <td style={{ ...cellBase, textAlign:"left", fontWeight:700, color: c.text,
          position:"sticky", left:0, zIndex:1, background: c.bg,
          borderRight:`2px solid #e0e0e0`, fontSize:11 }}>
          {isExpanded ? "▾" : "▸"} {phaseGroup.phase}
          <span style={{ fontWeight:400, fontSize:9, opacity:0.6, marginLeft:4 }}>
            ({phaseGroup.rows.length}mo)
          </span>
        </td>

        {/* Uses subtotals */}
        {useCols.map(k => {
          const v = phaseGroup.rows.reduce((s, r) => s + r.uses[k], 0);
          return (
            <td key={k} style={{ ...cellBase, fontWeight:600, color: v > 0.5 ? c.text : "#ddd" }}>
              {v > 0.5 ? fmt$(v) : "—"}
            </td>
          );
        })}

        <td style={{ ...cellBase, fontWeight:700, color: c.text,
          borderLeft:"2px solid #e0e0e0", borderRight:"2px solid #e0e0e0" }}>
          {fmt$(totUses)}
        </td>

        {srcCols.map(name => {
          const v = phaseGroup.rows.reduce((s, r) => s + (r.sourceDraws[name] || 0), 0);
          return (
            <td key={name} style={{ ...cellBase, fontWeight:600, color: v > 0.5 ? c.text : "#ddd" }}>
              {v > 0.5 ? fmt$(v) : "—"}
            </td>
          );
        })}

        <td style={{ ...cellBase, fontWeight:700, color: c.text,
          borderLeft:"2px solid #e0e0e0", borderRight:"2px solid #e0e0e0" }}>
          {fmt$(totSrc)}
        </td>

        <td style={{ ...cellBase, fontWeight:700,
          color: gap < -100 ? "#c41a1a" : "#1a6b3c" }}>
          {gap < -100 ? `(${fmt$(Math.abs(gap))})` : gap > 100 ? `+${fmt$(gap)}` : "—"}
        </td>

        <td style={{ ...cellBase, color: c.text, fontWeight:500 }}>
          {phaseGroup.rows[phaseGroup.rows.length - 1].teLoanBalance > 0
            ? fmt$(phaseGroup.rows[phaseGroup.rows.length - 1].teLoanBalance) : "—"}
        </td>
      </tr>
    );
  };

  // Abbreviate long source names for column headers
  const abbrev = (name) => {
    if (name.length <= 18) return name;
    return name
      .replace('Tax Exempt Construction Loan', 'TE Loan')
      .replace('Taxable Construction Loan', 'Taxable Loan')
      .replace('LIHTC Equity – M0 (Closing)', 'Equity M0')
      .replace('LIHTC Equity – Later Tranches', 'Equity Later')
      .replace('Permanent Amortizing Loan', 'Perm Loan')
      .replace('Deferred Developer Fee', 'DDF')
      .replace('Sponsor Note', 'Sponsor')
      .replace('Seller Note', 'Seller');
  };

  // Grand totals
  const grandUses = result.rows.reduce((s, r) => s + r.uses.total, 0);
  const grandSrc  = result.rows.reduce((s, r) => s + r.totalSources, 0);
  const grandGap  = result.rows.reduce((s, r) => s + r.surplus, 0);

  return (
    <div style={{ background:"white", border:"1px solid #e0e0e0", borderRadius:6,
      overflow:"hidden" }}>
      <div style={{ overflowX:"auto", overflowY:"auto", maxHeight:"70vh" }}>
        <table style={{ borderCollapse:"collapse", fontSize:10, fontFamily:"Inter, sans-serif",
          width:"100%" }}>
          <thead>
            <tr>
              <th style={{ ...headerCell, textAlign:"left", position:"sticky", left:0,
                zIndex:3, minWidth:70, borderRight:"2px solid #e0e0e0" }}>
                Month
              </th>
              {/* Uses headers */}
              {useCols.map(k => (
                <th key={k} style={{ ...headerCell, minWidth: 80 }}>
                  {USE_LABELS[k]}
                </th>
              ))}
              <th style={{ ...headerCell, borderLeft:"2px solid #e0e0e0",
                borderRight:"2px solid #e0e0e0", minWidth:80, color:"#111" }}>
                Total Uses
              </th>
              {/* Sources headers */}
              {srcCols.map(name => (
                <th key={name} style={{ ...headerCell, minWidth:80, color:"#1a3a6b" }}>
                  {abbrev(name)}
                </th>
              ))}
              <th style={{ ...headerCell, borderLeft:"2px solid #e0e0e0",
                borderRight:"2px solid #e0e0e0", minWidth:80, color:"#1a3a6b" }}>
                Total Src
              </th>
              <th style={{ ...headerCell, minWidth:80, color:"#8B2500" }}>
                Gap
              </th>
              <th style={{ ...headerCell, minWidth:80, color:"#1a3a6b" }}>
                TE Bal
              </th>
            </tr>
          </thead>
          <tbody>
            {phases.map(pg => {
              const c = PERIOD_BG[pg.phase] || PERIOD_BG.Construction;
              const isExpanded = expandedPhases[pg.phase];
              return [
                renderPhaseSummary(pg),
                ...(isExpanded ? pg.rows.map((r, i) => renderRow(r, i, c.text)) : []),
              ];
            }).flat()}

            {/* Grand total */}
            <tr style={{ background:"#f0f0f0", borderTop:"3px solid #888" }}>
              <td style={{ ...cellBase, textAlign:"left", fontWeight:700, color:"#111",
                position:"sticky", left:0, zIndex:1, background:"#f0f0f0",
                borderRight:"2px solid #e0e0e0", fontSize:11 }}>
                TOTAL
              </td>
              {useCols.map(k => {
                const v = result.rows.reduce((s, r) => s + r.uses[k], 0);
                return (
                  <td key={k} style={{ ...cellBase, fontWeight:700, color:"#111" }}>
                    {v > 0.5 ? fmt$(v) : "—"}
                  </td>
                );
              })}
              <td style={{ ...cellBase, fontWeight:700, color:"#111", fontSize:11,
                borderLeft:"2px solid #e0e0e0", borderRight:"2px solid #e0e0e0" }}>
                {fmt$(grandUses)}
              </td>
              {srcCols.map(name => {
                const v = result.rows.reduce((s, r) => s + (r.sourceDraws[name] || 0), 0);
                return (
                  <td key={name} style={{ ...cellBase, fontWeight:700, color:"#1a3a6b" }}>
                    {v > 0.5 ? fmt$(v) : "—"}
                  </td>
                );
              })}
              <td style={{ ...cellBase, fontWeight:700, color:"#1a3a6b", fontSize:11,
                borderLeft:"2px solid #e0e0e0", borderRight:"2px solid #e0e0e0" }}>
                {fmt$(grandSrc)}
              </td>
              <td style={{ ...cellBase, fontWeight:700, fontSize:11,
                color: grandGap < -100 ? "#c41a1a" : "#1a6b3c",
                background: grandGap < -100 ? "#fff0f0" : "#f0f0f0" }}>
                {grandGap < -100 ? `(${fmt$(Math.abs(grandGap))})` : grandGap > 100 ? `+${fmt$(grandGap)}` : "—"}
              </td>
              <td style={{ ...cellBase, fontWeight:700, color:"#1a3a6b" }}>
                {result.finalTeLoanBalance > 0 ? fmt$(result.finalTeLoanBalance) : "—"}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}


// ─── MAIN PANEL ─────────────────────────────────────────────────────────────
export default function ConstructionCFPanel({ onInterestUpdate }) {
  const { moduleStates, updateModule } = useLihtc();

  const cf       = { ...DEFAULT_CF, ...moduleStates.construction_cf };
  const budget   = moduleStates.budget;
  const debt     = moduleStates.debt;
  const lihtcState = moduleStates.lihtc;
  const unitMix  = moduleStates.unit_mix;

  const totalUnits = (unitMix?.rows ?? []).reduce((s, r) => s + (r.count || 0), 0) || 175;

  // ── Pull budget numbers ────────────────────────────────────────────────────
  // Use computeBudgetCalcs for ALL section totals — single source of truth
  // so Const CF total uses = TDC on Dev Budget exactly
  const budgetCalcs = computeBudgetCalcs(budget, totalUnits);
  const a = budget?.assumptions ?? {};

  const acqTotal         = budgetCalcs.acqTotal;
  const hardCostsTotal   = budgetCalcs.hcTotal;
  const scTotal          = budgetCalcs.scTotal;
  const financingTotal   = budgetCalcs.finLessInterest;  // financing section less interest (interest is its own column)
  const orgTotal         = budgetCalcs.orgTotal;
  const devFeeCash       = budgetCalcs.cashDevFee;
  const deferredDevFee   = budgetCalcs.deferredDevFee;

  // ── Pull from Debt module — single source of truth for all sources ────────
  const debtConst = debt?.construction ?? {};
  const debtPerm  = debt?.permanent ?? {};
  // Subdebt = seller notes, CHIP, sponsor notes, DDF, etc. (from Debt module's subordinate debt stack)
  const subdebt   = debt?.subdebt ?? [
    { label: 'Seller Note',  loan_type: 'seller',  amount: 1000000 },
    { label: 'CHIP',         loan_type: 'soft',    amount: 900000  },
    { label: 'Sponsor Note', loan_type: 'sponsor', amount: 346031  },
  ];
  // Other sources = GP Equity, HOME Funds, FHLB AHP, etc.
  const otherSources = debt?.other_sources ?? [];

  // Construction loans — derived from Debt module sizing (TDC × %, same formula as Debt tab)
  // Single source of truth: bond_test_target_pct and ltc_pct on the Debt tab drive everything.
  const tdc = budgetCalcs.tdc;
  const teLoanMax      = tdc * (debtConst.bond_test_target_pct || 0.35);
  const taxableLoanMax = Math.max(0, tdc * (debtConst.ltc_pct || 0.82) - teLoanMax);
  const teRate         = debtConst.te_rate      ?? 0.0585;
  const taxableRate    = debtConst.taxable_rate ?? 0.0585;

  // Permanent loan
  const permLoanAmount = debtPerm.loan_amount ?? 34049115;

  // LIHTC equity — compute from Tax Credit module via shared calc
  const lihtcDefaults = {
    credit_type:"4pct", applicable_pct:0.04, basis_boost:true, boost_factor:1.30,
    applicable_fraction:1.0, credit_period:10, investor_price:0.82,
    commercial_costs:0, federal_grants:0, historic_reduction:0,
    state_credit_applies:false, state_credit_annual:0, state_credit_period:10, state_credit_price:0,
  };
  const lihtcResult = computeLIHTC({ ...lihtcDefaults, ...lihtcState }, budgetCalcs, totalUnits, teLoanMax);
  const lihtcEquityAmount = lihtcResult.equityRaised;

  const startingInterestEst = a.const_interest_est || 3164218;

  // ── Editable schedules from cf state ────────────────────────────────────────
  // Auto-compute convMonth so schedules can reference it
  const convMonth = 1 + cf.construction_period_months + cf.leaseup_period_months + cf.stabilized_months;

  // Default schedules keyed to computed timeline
  const defaultEquitySched = [
    { label: "Closing",    month: 0,         pct: 10 },
    { label: "CofO",       month: 1 + cf.construction_period_months, pct: 65 },
    { label: "Pre-Stab",   month: convMonth - 3, pct: 5 },
    { label: "Conversion", month: convMonth,  pct: 20 },
  ];
  const defaultDevFeeSched = [
    { label: "Closing",    month: 0,         pct: 25 },
    { label: "Conversion", month: convMonth,  pct: 75 },
  ];

  const equitySchedule = cf.equity_schedule ?? defaultEquitySched;
  const devFeeSchedule = cf.dev_fee_schedule ?? defaultDevFeeSched;

  // Build dev fee allocation by month from schedule
  const devFeeByMonth = useMemo(() => {
    const map = {};
    for (const entry of devFeeSchedule) {
      map[entry.month] = (map[entry.month] || 0) + devFeeCash * (entry.pct / 100);
    }
    return map;
  }, [devFeeSchedule, devFeeCash]);

  // ── Build uses ─────────────────────────────────────────────────────────────
  const uses = useMemo(() => ({
    acquisition:       acqTotal,
    hardCosts:         hardCostsTotal,
    softRemaining:     scTotal * (1 - cf.closing_soft_pct),
    softClosing:       scTotal * cf.closing_soft_pct,
    financing:         financingTotal,
    // Org costs: % of total at closing, balance at conversion
    orgClosing:        orgTotal * cf.closing_org_pct,
    orgConversion:     orgTotal * (1 - cf.closing_org_pct),
    // Dev fee: driven by editable schedule
    devFeeByMonth,
    deferredDevFee,
    // Keep totals for summary display
    devFeeCashTotal:   devFeeCash,
    orgTotal,
  }), [acqTotal, hardCostsTotal, scTotal, cf.closing_soft_pct, financingTotal,
       orgTotal, cf.closing_org_pct, devFeeByMonth, deferredDevFee, devFeeCash]);

  // ── Build sources dynamically from Debt + Tax Credit modules ───────────────
  // Every source amount flows from its authoritative module — no hardcoded defaults.
  // Mode, priority, schedule, and paydown_loans are CF-specific behaviors.
  const sources = useMemo(() => {
    // Subdebt entries from Debt module → CF source entries
    // DDF is handled separately (amount from budgetCalcs), skip it here
    const subdebtSources = subdebt
      .filter(sd => sd.loan_type !== 'deferred_fee' &&
        !(sd.label || sd.name || '').toLowerCase().includes('deferred'))
      .filter(sd => (sd.amount || 0) > 0) // skip zero-amount entries
      .map((sd, idx) => {
        const n = (sd.label || sd.name || '').toLowerCase();
        // Seller notes draw at closing (scheduled)
        if (n.includes('seller')) {
          return { name: sd.label || sd.name, mode: 'scheduled', priority: null,
            amount: sd.amount || 0,
            schedule: [{ month: 0, amount: sd.amount || 0 }] };
        }
        // Everything else (CHIP, Sponsor Note, etc.) is flex with ascending priority
        return { name: sd.label || sd.name, mode: 'flex', priority: idx + 2,
          amount: sd.amount || 0, schedule: null };
      });

    // Other sources from Debt module (GP Equity, HOME Funds, etc.) — flex, after subdebt
    const otherCFSources = otherSources
      .filter(os => (os.amount || 0) > 0)
      .map((os, idx) => ({
        name: os.label, mode: 'flex', priority: 10 + idx,
        amount: os.amount || 0, schedule: null,
      }));

    return [
      // Construction loans — from Debt module
      { name: 'Tax Exempt Construction Loan', mode: 'loan', priority: null,
        amount: teLoanMax, schedule: null },
      { name: 'Taxable Construction Loan', mode: 'loan', priority: null,
        amount: taxableLoanMax, schedule: null },
      // LIHTC equity — from Tax Credit module via computeLIHTC()
      { name: 'LIHTC Equity', mode: 'scheduled', priority: null,
        amount: lihtcEquityAmount,
        schedule: equitySchedule.map(e => ({ month: e.month, pct: e.pct / 100, label: e.label })),
        paydown_loans: true },
      // Subdebt from Debt module (Seller Note, CHIP, Sponsor Note, etc.)
      ...subdebtSources,
      // Other sources from Debt module (GP Equity, HOME, FHLB, etc.)
      ...otherCFSources,
      // Deferred developer fee — from budget calcs
      { name: 'Deferred Developer Fee', mode: 'scheduled', priority: null,
        amount: deferredDevFee,
        schedule: [{ month: convMonth, amount: deferredDevFee }] },
      // Permanent loan — from Debt module (draws at conversion, pays down const loans)
      { name: 'Permanent Amortizing Loan', mode: 'scheduled', priority: null,
        amount: permLoanAmount,
        schedule: [{ month: convMonth, amount: permLoanAmount }],
        paydown_loans: true },
    ];
  }, [teLoanMax, taxableLoanMax, lihtcEquityAmount, equitySchedule,
      subdebt, otherSources, deferredDevFee, permLoanAmount, convMonth]);

  const sourceNames = sources.map(s => s.name);

  // ── Build params ───────────────────────────────────────────────────────────
  const params = useMemo(() => ({
    constructionMonths: cf.construction_period_months,
    leaseupMonths:      cf.leaseup_period_months,
    stabilizedMonths:   cf.stabilized_months,
    closingDate:        cf.construction_start_date,
    uses,
    sources,
    teRate,
    taxableRate,
    teLoanMax,
    taxableLoanMax,
    drawCurve:          cf.draw_curve_hard_costs || "medium",
  }), [cf, uses, sources, teRate, taxableRate, teLoanMax, taxableLoanMax]);

  // ── Auto-run convergence ───────────────────────────────────────────────────
  // Run synchronously via useMemo — convergence is fast (<50ms).
  // This avoids useEffect timing issues with StrictMode and state loops.
  const result = useMemo(() => {
    try {
      const r = converge(params, startingInterestEst);
      return r;
    } catch (e) {
      console.error("Convergence error:", e);
      return null;
    }
  }, [params, startingInterestEst]);

  // Push converged interest back to budget (once, via effect)
  const pushedKeyRef = useRef(null);
  const pushedKey = result ? `${Math.round(result.totalConstInterest)}-${Math.round(result.totalLeaseupInterest)}` : null;

  useEffect(() => {
    if (!result || pushedKey === pushedKeyRef.current) return;
    pushedKeyRef.current = pushedKey;

    if (onInterestUpdate) {
      onInterestUpdate({
        const_interest_est:   result.totalConstInterest,
        leaseup_interest_est: result.totalLeaseupInterest,
      });
    }
    updateModule("budget", {
      assumptions: {
        ...(moduleStates.budget?.assumptions ?? {}),
        const_interest_est:   Math.round(result.totalConstInterest),
        leaseup_interest_est: Math.round(result.totalLeaseupInterest),
      }
    });
  }, [pushedKey]);

  const update = (patch) => updateModule("construction_cf", patch);

  return (
    <div style={{ fontFamily:"Inter, sans-serif" }}>
      {/* Header */}
      <div style={{ display:"flex", alignItems:"baseline", justifyContent:"space-between", marginBottom:16 }}>
        <div style={{ display:"flex", alignItems:"baseline", gap:10 }}>
          <h2 style={{ fontFamily:"'Playfair Display', serif", fontSize:20, fontWeight:400, color:"#111" }}>
            Construction Cash Flow
          </h2>
          <span style={{ fontSize:9, color:"#aaa", letterSpacing:"0.08em", textTransform:"uppercase" }}>
            MODULE 2B
          </span>
        </div>
        {result && (
          <span style={{ fontSize:10, color:"#1a6b3c", fontWeight:600 }}>
            Converged in {result.iterations} iteration{result.iterations !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Key metrics bar */}
      {result && (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(5, 1fr)", gap:10, marginBottom:16 }}>
          <div style={{ background:"#fce8e3", border:"1px solid #f5c2b0", borderRadius:6, padding:"8px 12px" }}>
            <div style={{ fontSize:8, color:"#8B2500", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:3 }}>Const. Interest</div>
            <div style={{ fontSize:15, fontWeight:700, color:"#8B2500" }}>{fmt$(result.totalConstInterest)}</div>
          </div>
          <div style={{ background:"#fdf8f0", border:"1px solid #e8d9b8", borderRadius:6, padding:"8px 12px" }}>
            <div style={{ fontSize:8, color:"#5a3a00", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:3 }}>L/U Interest</div>
            <div style={{ fontSize:15, fontWeight:700, color:"#5a3a00" }}>{fmt$(result.totalLeaseupInterest)}</div>
          </div>
          <div style={{ background:"#eef2f8", border:"1px solid #c8d6e8", borderRadius:6, padding:"8px 12px" }}>
            <div style={{ fontSize:8, color:"#1a3a6b", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:3 }}>TE Peak Bal.</div>
            <div style={{ fontSize:15, fontWeight:700, color:"#1a3a6b" }}>{fmt$(result.teLoanPeak)}</div>
            <div style={{ fontSize:8, color:"#888" }}>{fmtPct(result.teLoanPeak / teLoanMax)} of commitment</div>
          </div>
          <div style={{ background:"#eef2f8", border:"1px solid #c8d6e8", borderRadius:6, padding:"8px 12px" }}>
            <div style={{ fontSize:8, color:"#1a3a6b", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:3 }}>Taxable Peak Bal.</div>
            <div style={{ fontSize:15, fontWeight:700, color:"#1a3a6b" }}>{fmt$(result.taxableLoanPeak)}</div>
            <div style={{ fontSize:8, color:"#888" }}>{fmtPct(result.taxableLoanPeak / taxableLoanMax)} of commitment</div>
          </div>
          {(() => {
            const grandGap = result.rows.reduce((s, r) => s + r.surplus, 0);
            const hasGap = grandGap < -100;
            return (
              <div style={{ background: hasGap ? "#fff0f0" : "#f0f9f4",
                border: `1px solid ${hasGap ? "#f5b0b0" : "#b8dfc8"}`,
                borderRadius:6, padding:"8px 12px" }}>
                <div style={{ fontSize:8, color: hasGap ? "#c41a1a" : "#1a6b3c",
                  textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:3 }}>
                  {hasGap ? "FUNDING GAP" : "Surplus"}
                </div>
                <div style={{ fontSize:15, fontWeight:700, color: hasGap ? "#c41a1a" : "#1a6b3c" }}>
                  {hasGap ? `(${fmt$(Math.abs(grandGap))})` : fmt$(grandGap)}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* Phase summary bar */}
      <PhaseSummaryBar result={result} sources={sources} />

      {/* Main grid: inputs left, table right */}
      <div style={{ display:"grid", gridTemplateColumns:"260px 1fr", gap:16 }}>

        {/* LEFT — Inputs */}
        <div>
          <div style={{ background:"white", border:"1px solid #e0e0e0", borderRadius:6,
            padding:"12px 14px", marginBottom:12 }}>
            <div style={{ fontSize:9, fontWeight:700, color:"#1a3a6b", textTransform:"uppercase",
              letterSpacing:"0.08em", marginBottom:10 }}>Timeline</div>

            <FieldRow label="Construction" note="months">
              <NumInput value={cf.construction_period_months} step={1} min={12} max={48}
                onChange={v => update({ construction_period_months: v })} width={55} />
            </FieldRow>
            <FieldRow label="Lease-Up" note="months">
              <NumInput value={cf.leaseup_period_months} step={1} min={1} max={24}
                onChange={v => update({ leaseup_period_months: v })} width={55} />
            </FieldRow>
            <FieldRow label="Stabilized" note="months">
              <NumInput value={cf.stabilized_months} step={1} min={1} max={12}
                onChange={v => update({ stabilized_months: v })} width={55} />
            </FieldRow>
          </div>

          <div style={{ background:"white", border:"1px solid #e0e0e0", borderRadius:6,
            padding:"12px 14px", marginBottom:12 }}>
            <div style={{ fontSize:9, fontWeight:700, color:"#1a3a6b", textTransform:"uppercase",
              letterSpacing:"0.08em", marginBottom:10 }}>Construction Loans
              <span style={{ fontWeight:400, color:"#aaa", marginLeft:4 }}>from Debt tab</span>
            </div>

            <FieldRow label="TE Loan">
              <span style={{ fontSize:10, fontWeight:600, color:"#111" }}>{fmt$(teLoanMax)}</span>
            </FieldRow>
            <FieldRow label="Taxable Loan">
              <span style={{ fontSize:10, fontWeight:600, color:"#111" }}>{fmt$(taxableLoanMax)}</span>
            </FieldRow>
            <FieldRow label="Combined">
              <span style={{ fontSize:10, fontWeight:600, color:"#111" }}>{fmt$(teLoanMax + taxableLoanMax)}</span>
            </FieldRow>
            <div style={{ fontSize:7, color:"#aaa", marginTop:4, textAlign:"right" }}>
              {fmtPct(debtConst.bond_test_target_pct || 0.35)} TE · {fmtPct(debtConst.ltc_pct || 0.82)} LTC
            </div>

            <div style={{ borderTop:"1px solid #f0f0f0", paddingTop:8, marginTop:8 }}>
              <FieldRow label="TE Rate">
                <span style={{ fontSize:10, fontWeight:600, color:"#111" }}>{fmtPct(teRate)}</span>
              </FieldRow>
              <FieldRow label="Taxable Rate">
                <span style={{ fontSize:10, fontWeight:600, color:"#111" }}>{fmtPct(taxableRate)}</span>
              </FieldRow>
              <div style={{ fontSize:7, color:"#aaa", marginTop:2, textAlign:"right" }}>
                Edit rates on Debt tab
              </div>
            </div>
          </div>

          <div style={{ background:"white", border:"1px solid #e0e0e0", borderRadius:6,
            padding:"12px 14px", marginBottom:12 }}>
            <div style={{ fontSize:9, fontWeight:700, color:"#1a3a6b", textTransform:"uppercase",
              letterSpacing:"0.08em", marginBottom:10 }}>Spend-Down</div>
            <FieldRow label="Hard Cost Curve">
              <div style={{ display:"flex", gap:3 }}>
                {["flat","medium","steep"].map(shape => (
                  <button key={shape} onClick={() => update({ draw_curve_hard_costs: shape })}
                    style={{ padding:"3px 8px", borderRadius:3, border:"1px solid",
                      borderColor: (cf.draw_curve_hard_costs||"medium") === shape ? "#1a3a6b" : "#e0e0e0",
                      background: (cf.draw_curve_hard_costs||"medium") === shape ? "#1a3a6b" : "white",
                      color: (cf.draw_curve_hard_costs||"medium") === shape ? "white" : "#666",
                      fontSize:9, cursor:"pointer", textTransform:"capitalize" }}>
                    {shape}
                  </button>
                ))}
              </div>
            </FieldRow>

            <div style={{ borderTop:"1px solid #f0f0f0", paddingTop:8, marginTop:4 }}>
              <FieldRow label="Soft at Closing">
                <NumInput value={cf.closing_soft_pct} pct step={1} onChange={v => update({ closing_soft_pct: v })} width={55} />
              </FieldRow>
              <FieldRow label="Org at Closing">
                <NumInput value={cf.closing_org_pct} pct step={1} onChange={v => update({ closing_org_pct: v })} width={55} />
              </FieldRow>
            </div>
          </div>

          {/* Editable Schedules */}
          <div style={{ background:"white", border:"1px solid #e0e0e0", borderRadius:6,
            padding:"12px 14px", marginBottom:12 }}>
            <ScheduleEditor
              title="LIHTC Equity Pay-In"
              schedule={equitySchedule}
              onChange={next => update({ equity_schedule: next })}
              totalAmount={sources.find(s => s.name.toLowerCase().includes('equity'))?.amount || 0}
              color="#1a3a6b"
            />
            <div style={{ borderTop:"1px solid #f0f0f0", paddingTop:8, marginTop:4 }}>
              <ScheduleEditor
                title="Cash Dev Fee Pay-Out"
                schedule={devFeeSchedule}
                onChange={next => update({ dev_fee_schedule: next })}
                totalAmount={devFeeCash}
                color="#5a3a00"
              />
            </div>
          </div>

          {/* Schedule warnings */}
          {(() => {
            const maxMo = 1 + cf.construction_period_months + cf.leaseup_period_months + cf.stabilized_months;
            const warns = [];
            for (const e of equitySchedule) {
              if (e.month > maxMo) warns.push(`Equity "${e.label || 'Tranche'}" at Mo ${e.month} exceeds timeline (last month: ${maxMo})`);
            }
            for (const e of devFeeSchedule) {
              if (e.month > maxMo) warns.push(`Dev Fee "${e.label || 'Tranche'}" at Mo ${e.month} exceeds timeline (last month: ${maxMo})`);
            }
            if (warns.length === 0) return null;
            return (
              <div style={{ background:"#fef3cd", border:"1px solid #f0d68a", borderRadius:6,
                padding:"10px 12px", marginBottom:12 }}>
                <div style={{ fontSize:9, fontWeight:700, color:"#856404", marginBottom:4 }}>⚠ Schedule Warning</div>
                {warns.map((w, i) => (
                  <div key={i} style={{ fontSize:8, color:"#856404", marginBottom:2 }}>{w}</div>
                ))}
                <div style={{ fontSize:7, color:"#a07b10", marginTop:4 }}>
                  Increase timeline or adjust schedule months to fix.
                </div>
              </div>
            );
          })()}

          {/* Uses summary */}
          <div style={{ background:"#f8f9fc", border:"1px solid #e0e8f4", borderRadius:6,
            padding:"10px 12px", marginBottom:12 }}>
            <div style={{ fontSize:9, fontWeight:700, color:"#888", textTransform:"uppercase",
              letterSpacing:"0.07em", marginBottom:6 }}>Budget Uses</div>
            {[
              { l:"Acquisition",     v: acqTotal },
              { l:"Hard Costs",      v: hardCostsTotal },
              { l:"Soft Costs",      v: scTotal },
              { l:"Financing",       v: financingTotal, note: "less interest" },
              { l:"Org / Reserves",  v: orgTotal,
                note: `${(cf.closing_org_pct*100).toFixed(0)}% closing / ${((1-cf.closing_org_pct)*100).toFixed(0)}% conversion` },
              { l:"Cash Dev Fee",    v: devFeeCash },
              { l:"Deferred Dev Fee",v: deferredDevFee },
            ].map(r => (
              <div key={r.l} style={{ marginBottom:3 }}>
                <div style={{ display:"flex", justifyContent:"space-between", fontSize:9 }}>
                  <span style={{ color:"#888" }}>{r.l}</span>
                  <span style={{ color:"#111", fontWeight:500 }}>{fmt$(r.v)}</span>
                </div>
                {r.note && <div style={{ fontSize:7, color:"#bbb", textAlign:"right" }}>{r.note}</div>}
              </div>
            ))}
            {result && (
              <div style={{ borderTop:"1px solid #d0dae8", paddingTop:4, marginTop:4,
                display:"flex", justifyContent:"space-between", fontSize:9 }}>
                <span style={{ color:"#8B2500", fontWeight:600 }}>+ Interest</span>
                <span style={{ color:"#8B2500", fontWeight:600 }}>{fmt$(result.totalInterest)}</span>
              </div>
            )}
          </div>

          {/* Convergence feedback */}
          {result && (
            <div style={{ background:"#f0f3f9", border:"1px solid #b8c8e0", borderRadius:6,
              padding:"10px 12px" }}>
              <div style={{ fontSize:9, fontWeight:700, color:"#1a3a6b", textTransform:"uppercase",
                letterSpacing:"0.07em", marginBottom:6 }}>
                ↑ Synced to Dev Budget
              </div>
              {[
                { l:"Const. Interest", before: startingInterestEst, after: result.totalConstInterest },
                { l:"L/U Interest",    before: a.leaseup_interest_est || 0, after: result.totalLeaseupInterest },
              ].map(r => {
                const delta = r.after - r.before;
                const changed = Math.abs(delta) > 1;
                return (
                  <div key={r.l} style={{ marginBottom:4 }}>
                    <div style={{ fontSize:8, color:"#888" }}>{r.l}</div>
                    {changed ? (
                      <div style={{ fontSize:11, fontWeight:700, color: delta > 0 ? "#8B2500" : "#1a6b3c" }}>
                        {fmt$(r.after)}
                        <span style={{ fontSize:8, fontWeight:400, color:"#aaa", marginLeft:4 }}>
                          was {fmt$(r.before)} ({delta > 0 ? "+" : ""}{fmt$(delta)})
                        </span>
                      </div>
                    ) : (
                      <div style={{ fontSize:11, fontWeight:600, color:"#1a6b3c" }}>{fmt$(r.after)}</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* RIGHT — Table */}
        <div>
          {!result ? (
            <div style={{ background:"white", border:"2px dashed #e0e0e0", borderRadius:8,
              padding:40, textAlign:"center" }}>
              <div style={{ fontSize:13, color:"#ccc", fontWeight:600 }}>No data — check budget inputs</div>
            </div>
          ) : (
            <VerticalCFTable result={result} sourceNames={sourceNames} />
          )}
        </div>
      </div>

      {/* S-curve visualization */}
      {result && (
        <div style={{ background:"white", border:"1px solid #e0e0e0", borderRadius:6,
          padding:"12px 14px", marginTop:14 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
            <div style={{ fontSize:9, fontWeight:700, color:"#888", textTransform:"uppercase",
              letterSpacing:"0.07em" }}>
              Hard Cost Draw — {(cf.draw_curve_hard_costs||"medium").charAt(0).toUpperCase() +
              (cf.draw_curve_hard_costs||"medium").slice(1)} Curve
            </div>
          </div>
          <div style={{ display:"flex", alignItems:"flex-end", gap:2, height:50 }}>
            {generateSCurve(cf.construction_period_months, cf.draw_curve_hard_costs || "medium")
              .map((v, i, arr) => {
                const maxV = arr.reduce((a, b) => Math.max(a, b), 0);
                const isPeak = v >= maxV * 0.99;
                return (
                  <div key={i} title={`Month ${i+1}: ${(v*100).toFixed(1)}%`}
                    style={{ flex:1, background: isPeak ? "#8B2500" : "#d0d8e8",
                      height:`${Math.max(3, (v / maxV) * 46)}px`,
                      borderRadius:"2px 2px 0 0", minWidth:2 }} />
                );
              })}
          </div>
          <div style={{ display:"flex", justifyContent:"space-between", fontSize:8, color:"#aaa", marginTop:3 }}>
            <span>Month 1</span>
            <span>Month {cf.construction_period_months}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// DEFAULT_CF_SOURCES removed — sources are now built dynamically from
// Debt module (construction loans, perm loan, soft debt) and
// Tax Credit module (LIHTC equity via computeLIHTC).
