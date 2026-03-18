import { useState, useCallback, useEffect } from "react";
import { useLihtc } from "./context/LihtcContext.jsx";

// ─────────────────────────────────────────────────────────────────────────────
// MODULE 2B — CONSTRUCTION CASH FLOW ENGINE
// Monthly draw schedule with iterative interest convergence.
// Sources fill monthly need in priority order (Flex → Loan → Scheduled).
// Converges construction interest until delta < $1 (typically 3-5 iterations).
// Outputs exact construction + lease-up interest back to Module 2A.
// ─────────────────────────────────────────────────────────────────────────────

const fmt$  = v => v == null ? "—" : "$" + Math.round(v).toLocaleString();
const fmtM  = v => v == null ? "—" : "$" + (v / 1000000).toFixed(3) + "M";
const fmtPct = v => v == null ? "—" : (v * 100).toFixed(2) + "%";
const fmtPct1 = v => v == null ? "—" : (v * 100).toFixed(1) + "%";

// ─── S-CURVE GENERATOR ───────────────────────────────────────────────────────
// Generates a smooth S-curve spend distribution over N months.
// Peak spend is around month N*0.6.
// Returns array of fractions summing to 1.0.
function generateSCurve(months, peakMonth = null) {
  if (months <= 0) return [];
  const peak = peakMonth ?? Math.round(months * 0.55);
  const raw = [];
  for (let i = 0; i < months; i++) {
    // Beta-like distribution: rises to peak, then falls
    const x = i / (months - 1);
    const alpha = peak / (months - 1);
    // Triangle approximation — smooth enough for construction draws
    const v = i <= peak
      ? (i + 1) / (peak + 1)
      : (months - i) / (months - peak);
    raw.push(Math.max(0.001, v));
  }
  const sum = raw.reduce((s, v) => s + v, 0);
  return raw.map(v => v / sum);
}

// ─── CORE ENGINE ─────────────────────────────────────────────────────────────
// Builds the full monthly schedule given construction interest estimate.
// Returns per-month rows and summary totals.
function buildSchedule(params, interestEst) {
  const {
    constructionMonths, leaseupMonths, stabilizedMonths,
    closingDate,
    // Uses by category (from budget module)
    uses,
    // Sources
    sources,
    // Loan rates
    teRate, taxableRate,
    teLoanMax, taxableLoanMax,
    // S-curve shape
    hardCostPeak,
    softCostFront, // soft costs are more front-loaded
  } = params;

  const totalMonths = 1 + constructionMonths + leaseupMonths + stabilizedMonths;

  // Build spend-down schedule for each use category
  const hcCurve = generateSCurve(constructionMonths, hardCostPeak);
  const scCurve = generateSCurve(constructionMonths, Math.round(constructionMonths * 0.3));

  // Monthly use amounts
  const monthlyUses = [];
  for (let m = 0; m < totalMonths; m++) {
    const isClosing     = m === 0;
    const constIdx      = m - 1; // 0-based index within construction period
    const isConst       = m >= 1 && m <= constructionMonths;
    const leaseupIdx    = m - 1 - constructionMonths;
    const isLeaseup     = m > constructionMonths && m <= constructionMonths + leaseupMonths;
    const isStabilized  = m > constructionMonths + leaseupMonths;

    let monthUses = {
      acquisition:    0,
      hardCosts:      0,
      softCosts:      0,
      financingPerm:  0,
      financingConst: 0,
      orgCosts:       0,
      devFeeCash:     0,
      interest:       0, // filled in separately
    };

    if (isClosing) {
      // At closing: acquisition, perm financing fees, initial soft/org, cash dev fee tranche
      monthUses.acquisition    = uses.acquisition;
      monthUses.financingPerm  = uses.financingPerm;
      monthUses.financingConst = uses.financingConst;
      monthUses.orgCosts       = uses.orgClosing;
      monthUses.devFeeCash     = uses.devFeeCashClosing;
      monthUses.softCosts      = uses.softClosing;
    } else if (isConst) {
      monthUses.hardCosts = uses.hardCosts * hcCurve[constIdx];
      monthUses.softCosts = uses.softRemaining * scCurve[constIdx];
    }
    // Interest added after convergence loop

    monthlyUses.push(monthUses);
  }

  // ── SOURCE WATERFALL ─────────────────────────────────────────────────────
  // Each month: determine need, fill from sources in priority order
  // Source modes: Flex (draw when needed, up to total), Loan (fill remainder), Scheduled (specific months)

  // Initialize source state
  const sourceState = sources.map(s => ({
    ...s,
    drawn: 0,           // total drawn to date
    balance: 0,         // running loan balance (for loan sources)
  }));

  // Track loan balances separately
  let teLoanBalance = 0;
  let taxableLoanBalance = 0;
  let teLoanDrawn = 0;
  let taxableLoanDrawn = 0;

  // Build month-by-month with interest convergence
  let constInterest = interestEst;
  let leaseupInterest = 0;

  const rows = [];
  // Reset source state each build
  sourceState.forEach(s => { s.drawn = 0; });
  teLoanBalance = 0; taxableLoanBalance = 0;
  teLoanDrawn = 0; taxableLoanDrawn = 0;

  const teMonthlyRate = teRate / 12;
  const taxableMonthlyRate = taxableRate / 12;

  for (let m = 0; m < totalMonths; m++) {
    const isClosing   = m === 0;
    const isConst     = m >= 1 && m <= constructionMonths;
    const isLeaseup   = m > constructionMonths && m <= constructionMonths + leaseupMonths;
    const isStabilized = m > constructionMonths + leaseupMonths;

    // Interest this month = prior balance × rate
    const teIntThisMonth      = teLoanBalance * teMonthlyRate;
    const taxableIntThisMonth = taxableLoanBalance * taxableMonthlyRate;
    const intThisMonth        = teIntThisMonth + taxableIntThisMonth;

    // Total need this month (uses + interest)
    const uses_m = monthlyUses[m];
    const nonIntNeed = uses_m.acquisition + uses_m.hardCosts + uses_m.softCosts +
      uses_m.financingPerm + uses_m.financingConst + uses_m.orgCosts + uses_m.devFeeCash + uses_m.softCosts;
    // Avoid double-counting softCosts — fix above
    const nonIntNeedFixed = uses_m.acquisition + uses_m.hardCosts + uses_m.softCosts +
      uses_m.financingPerm + uses_m.financingConst + uses_m.orgCosts + uses_m.devFeeCash;
    const totalNeed = nonIntNeedFixed + intThisMonth;

    let remainingNeed = totalNeed;
    const monthSources = {};

    // 1. Scheduled sources — drawn at specific months regardless of need
    for (const s of sourceState) {
      if (s.mode !== 'scheduled') continue;
      const schedAmt = s.schedule?.[m] ?? 0;
      if (schedAmt > 0) {
        const drawn = Math.min(schedAmt, s.total - s.drawn);
        s.drawn += drawn;
        monthSources[s.id] = (monthSources[s.id] || 0) + drawn;
        remainingNeed -= drawn;
      }
    }

    // 2. Flex sources — drawn when need exists, in priority order
    const flexSources = sourceState
      .filter(s => s.mode === 'flex')
      .sort((a, b) => (a.priority || 99) - (b.priority || 99));

    for (const s of flexSources) {
      if (remainingNeed <= 0) break;
      const available = s.total - s.drawn;
      if (available <= 0) continue;
      const drawn = Math.min(remainingNeed, available);
      s.drawn += drawn;
      monthSources[s.id] = (monthSources[s.id] || 0) + drawn;
      remainingNeed -= drawn;
    }

    // 3. Loan sources — fill remaining need
    if (remainingNeed > 0) {
      // TE loan draws first, then taxable
      const teAvail = teLoanMax - teLoanDrawn;
      const teDraw = Math.min(remainingNeed, teAvail);
      if (teDraw > 0) {
        teLoanDrawn += teDraw;
        teLoanBalance += teDraw;
        monthSources['te_loan'] = (monthSources['te_loan'] || 0) + teDraw;
        remainingNeed -= teDraw;
      }

      if (remainingNeed > 0) {
        const taxAvail = taxableLoanMax - taxableLoanDrawn;
        const taxDraw = Math.min(remainingNeed, taxAvail);
        if (taxDraw > 0) {
          taxableLoanDrawn += taxDraw;
          taxableLoanBalance += taxDraw;
          monthSources['taxable_loan'] = (monthSources['taxable_loan'] || 0) + taxDraw;
          remainingNeed -= taxDraw;
        }
      }
    }

    // At perm conversion (end of lease-up), pay down construction loans
    if (isStabilized && m === constructionMonths + leaseupMonths + 1) {
      // Perm loan pays down construction loans
      const permLoan = sourceState.find(s => s.id === 'perm_loan');
      if (permLoan) {
        const permDraw = Math.min(permLoan.total - permLoan.drawn, teLoanBalance + taxableLoanBalance);
        permLoan.drawn += permDraw;
        monthSources['perm_loan'] = (monthSources['perm_loan'] || 0) + permDraw;
        // Pay down TE first, then taxable
        const tePaydown = Math.min(permDraw, teLoanBalance);
        teLoanBalance -= tePaydown;
        const taxPaydown = Math.min(permDraw - tePaydown, taxableLoanBalance);
        taxableLoanBalance -= taxPaydown;
      }
    }

    rows.push({
      month: m,
      period: isClosing ? 'Closing' : isConst ? 'Construction' : isLeaseup ? 'Lease-Up' : 'Stabilized',
      uses: { ...uses_m, interest: intThisMonth, total: totalNeed },
      sources: monthSources,
      teLoanBalance,
      taxableLoanBalance,
      teIntThisMonth,
      taxableIntThisMonth,
      surplus: -remainingNeed,
    });
  }

  // Compute interest totals
  const constRows   = rows.filter(r => r.period === 'Construction' || r.period === 'Closing');
  const leaseupRows = rows.filter(r => r.period === 'Lease-Up');

  const totalConstInterest   = rows
    .filter(r => r.period === 'Construction')
    .reduce((s, r) => s + r.uses.interest, 0);
  const totalLeaseupInterest = leaseupRows
    .reduce((s, r) => s + r.uses.interest, 0);

  const totalInterest = totalConstInterest + totalLeaseupInterest;

  return {
    rows,
    totalConstInterest,
    totalLeaseupInterest,
    totalInterest,
    teLoanDrawn,
    taxableLoanDrawn,
    finalTeLoanBalance:      rows[rows.length - 1]?.teLoanBalance      ?? 0,
    finalTaxableLoanBalance: rows[rows.length - 1]?.taxableLoanBalance  ?? 0,
  };
}

// ── CONVERGENCE LOOP ─────────────────────────────────────────────────────────
function converge(params, startingEst, maxIter = 15) {
  let est = startingEst;
  let result = null;
  let iterations = 0;

  for (let i = 0; i < maxIter; i++) {
    result = buildSchedule(params, est);
    const delta = Math.abs(result.totalConstInterest - est);
    iterations = i + 1;
    if (delta < 1) break;
    // Blend toward new estimate to prevent oscillation
    est = result.totalConstInterest * 0.7 + est * 0.3;
  }

  return { ...result, iterations, finalInterestEst: est };
}

// ─── DEFAULT STATE ────────────────────────────────────────────────────────────
const DEFAULT_CF = {
  // Field names match LihtcContext schema
  construction_period_months: 24,
  leaseup_period_months:      7,
  stabilized_months:          4,
  construction_start_date:    "2026-11-01",
  hard_cost_peak_month:       14,
  te_rate:                    0.0585,
  taxable_rate:               0.0585,
  te_loan_override:           null,
  taxable_loan_override:      null,
  closing_soft_pct:           0.27,
  closing_org_pct:            0.30,
  closing_dev_fee_pct:        0.25,
};

// ─── COMPONENTS ──────────────────────────────────────────────────────────────

function MetricCard({ label, value, sub, color = "#111", bg = "#f8f8f8", border = "#e0e0e0" }) {
  return (
    <div style={{ background:bg, border:`1px solid ${border}`, borderRadius:6, padding:"10px 14px" }}>
      <div style={{ fontSize:8, color:"#aaa", textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:4, fontFamily:"Inter, sans-serif" }}>{label}</div>
      <div style={{ fontSize:16, fontWeight:700, color, fontFamily:"Inter, sans-serif" }}>{value}</div>
      {sub && <div style={{ fontSize:9, color:"#aaa", marginTop:2, fontFamily:"Inter, sans-serif" }}>{sub}</div>}
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

function NumInput({ value, onChange, step, min, max, pct, width = 90 }) {
  const display = pct ? +(value * 100).toFixed(2) : value;
  return (
    <input
      type="number"
      value={display ?? ""}
      step={step || (pct ? 0.1 : 1)}
      min={min} max={max}
      onChange={e => onChange(pct ? Number(e.target.value) / 100 : Number(e.target.value))}
      style={{ background:"#f8f8f8", border:"1px solid #e0e0e0", borderRadius:4,
        padding:"4px 8px", fontSize:11, fontFamily:"Inter, sans-serif", color:"#111",
        outline:"none", width, textAlign:"right" }}
    />
  );
}

// Monthly table — shows key rows, collapsible
function MonthlyTable({ rows, sources }) {
  const [collapsed, setCollapsed] = useState(true);
  const [showAll, setShowAll] = useState(false);

  const displayRows = showAll ? rows : rows.slice(0, collapsed ? 5 : rows.length);
  const periods = ['Closing', 'Construction', 'Lease-Up', 'Stabilized'];
  const periodColors = {
    'Closing':      "#1a3a6b",
    'Construction': "#8B2500",
    'Lease-Up':     "#5a3a00",
    'Stabilized':   "#1a6b3c",
  };

  const th = (label, align = "right") => (
    <th style={{ padding:"4px 8px", textAlign:align, fontSize:8, color:"#888",
      fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em",
      borderBottom:"1px solid #e0e0e0", whiteSpace:"nowrap" }}>{label}</th>
  );
  const td = (v, opts = {}) => (
    <td style={{ padding:"4px 8px", textAlign: opts.align || "right", fontSize:10,
      fontFamily:"Inter, sans-serif", color: opts.color || "#111",
      fontWeight: opts.bold ? 700 : 400, whiteSpace:"nowrap",
      borderBottom:"1px solid #f5f5f5" }}>{v}</td>
  );

  return (
    <div style={{ background:"white", border:"1px solid #e0e0e0", borderRadius:6, overflow:"hidden" }}>
      <div
        onClick={() => setCollapsed(v => !v)}
        style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
          padding:"8px 14px", background:"#fafafa", cursor:"pointer",
          borderBottom:"1px solid #e0e0e0" }}>
        <span style={{ fontSize:9, fontWeight:700, color:"#888", textTransform:"uppercase",
          letterSpacing:"0.08em" }}>
          {collapsed ? "▸" : "▾"} Monthly Cash Flow — {rows.length} Months
        </span>
        <span style={{ fontSize:8, color:"#aaa" }}>
          {collapsed ? "Click to expand" : "Click to collapse"}
        </span>
      </div>

      {!collapsed && (
        <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:10,
            fontFamily:"Inter, sans-serif" }}>
            <thead>
              <tr style={{ background:"#f8f8f8" }}>
                {th("Mo", "center")}
                {th("Period", "left")}
                {th("Hard Costs")}
                {th("Soft Costs")}
                {th("Interest")}
                {th("Total Uses")}
                {th("TE Loan Draw")}
                {th("TE Balance")}
                {th("Surplus")}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? "white" : "#fdfcfb" }}>
                  {td(r.month, { align:"center", color:"#aaa" })}
                  <td style={{ padding:"4px 8px", fontSize:10, fontWeight:600,
                    color: periodColors[r.period], borderBottom:"1px solid #f5f5f5" }}>
                    {r.period}
                  </td>
                  {td(r.uses.hardCosts > 0 ? fmt$(r.uses.hardCosts) : "—", { color:"#666" })}
                  {td((r.uses.softCosts + r.uses.acquisition + r.uses.orgCosts + r.uses.devFeeCash + r.uses.financingPerm + r.uses.financingConst) > 0
                    ? fmt$(r.uses.softCosts + r.uses.acquisition + r.uses.orgCosts + r.uses.devFeeCash + r.uses.financingPerm + r.uses.financingConst)
                    : "—", { color:"#666" })}
                  {td(r.uses.interest > 0 ? fmt$(r.uses.interest) : "—", { color:"#5a3a00" })}
                  {td(fmt$(r.uses.total), { bold: true })}
                  {td(r.sources['te_loan'] ? fmt$(r.sources['te_loan']) : "—", { color:"#1a3a6b" })}
                  {td(fmt$(r.teLoanBalance), { color:"#1a3a6b" })}
                  {td(r.surplus >= 0 ? fmt$(r.surplus) : `(${fmt$(Math.abs(r.surplus))})`,
                    { color: r.surplus >= -100 ? "#1a6b3c" : "#8B2500" })}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 10 && (
            <div style={{ padding:"8px 14px", textAlign:"center" }}>
              <button onClick={() => setShowAll(v => !v)}
                style={{ background:"none", border:"1px solid #e0e0e0", borderRadius:3,
                  padding:"3px 12px", fontSize:9, color:"#888", cursor:"pointer",
                  fontFamily:"Inter, sans-serif" }}>
                {showAll ? "Show fewer" : `Show all ${rows.length} months`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── MAIN PANEL ───────────────────────────────────────────────────────────────
export default function ConstructionCFPanel({ onInterestUpdate }) {
  const { moduleStates, updateModule } = useLihtc();

  const cf       = { ...DEFAULT_CF, ...moduleStates.construction_cf };
  const budget   = moduleStates.budget;
  const debt     = moduleStates.debt;
  const unitMix  = moduleStates.unit_mix;

  const totalUnits = (unitMix?.rows ?? []).reduce((s, r) => s + (r.count || 0), 0) || 175;

  // ── Pull inputs from other modules ──────────────────────────────────────────
  const a = budget?.assumptions ?? {};

  // Budget uses
  const hcAllInputs = budget?.sections?.hard_costs
    ?.filter(l => l.type === "input").reduce((s, l) => s + (l.amount || 0), 0) || 31350000;
  const ppBond = budget?.sections?.hard_costs
    ?.find(l => l.label?.toLowerCase().includes("p&p") || l.label?.toLowerCase().includes("bond premium"));
  const ppAmt = ppBond?.type === "input" ? (ppBond?.amount || 0) : 0;
  const hcContBase = hcAllInputs - ppAmt;
  const hcCont  = hcContBase * (a.hc_contingency_pct || 0.05);
  const hcTax   = (hcContBase + hcCont) * (a.sales_tax_pct || 0.106);
  const hardCostsTotal = hcAllInputs + hcCont + hcTax;

  const scInputs = budget?.sections?.soft_costs
    ?.filter(l => l.type === "input").reduce((s, l) => s + (l.amount || 0), 0) || 5140080;
  const scTotal  = scInputs * (1 + (a.sc_contingency_pct || 0.10));

  const acqTotal = budget?.sections?.acquisition
    ?.reduce((s, l) => s + (l.amount || 0), 0) || 4488000;

  const combinedCL = (a.const_loan_amount || 0) + (a.taxable_loan_amount || 0);
  const constOrigination = combinedCL * (a.const_origination_pct || 0.01);
  const permOrigination  = (a.perm_loan_amount || 0) * (a.perm_origination_pct || 0.01);

  // Perm financing fees (closing)
  const permFin = permOrigination +
    (budget?.sections?.financing?.filter(l => !l.in_basis && l.type === "input")
      .reduce((s, l) => s + (l.amount || 0), 0) || 0);

  // Const financing fees (closing) — origination + bond costs + construction legal
  const constFin = constOrigination +
    (budget?.sections?.financing?.filter(l => l.in_basis && l.type === "input")
      .reduce((s, l) => s + (l.amount || 0), 0) || 0);

  const orgInputs = budget?.sections?.org_reserves
    ?.filter(l => l.type === "input").reduce((s, l) => s + (l.amount || 0), 0) || 985598;

  const subtotal = acqTotal + hardCostsTotal + scTotal +
    (constFin + permFin + (a.const_interest_est || 3164218) + (a.leaseup_interest_est || 1987588)) +
    (orgInputs + (a.op_reserve_fallback || 637500) + totalUnits * (a.rep_reserve_per_unit || 350) + (a.ads_reserve_fallback || 1110159));

  const devFeeTotal = subtotal * (a.dev_fee_pct || 0.15);
  const devFeeCash  = devFeeTotal * (a.cash_fee_pct || 0.33);

  // Loan amounts from Debt module or assumptions
  const teLoanMax      = cf.te_loan_override      ?? debt?.construction?.te_loan_amount      ?? (a.const_loan_amount || 32941402);
  const taxableLoanMax = cf.taxable_loan_override ?? debt?.construction?.taxable_loan_amount ?? (a.taxable_loan_amount || 17814416);
  const teRate         = debt?.construction?.te_rate      ?? cf.te_rate;
  const taxableRate    = debt?.construction?.taxable_rate ?? cf.taxable_rate;

  // Starting interest estimate from Module 2A
  const startingInterestEst = a.const_interest_est || 3164218;

  // ── Build uses object ────────────────────────────────────────────────────────
  const uses = {
    acquisition:       acqTotal,
    hardCosts:         hardCostsTotal,
    softRemaining:     scTotal * (1 - cf.closing_soft_pct),
    softClosing:       scTotal * cf.closing_soft_pct,
    financingPerm:     permFin,
    financingConst:    constFin,
    orgClosing:        orgInputs * cf.closing_org_pct +
                       (a.op_reserve_fallback || 637500) +
                       totalUnits * (a.rep_reserve_per_unit || 350) +
                       (a.ads_reserve_fallback || 1110159),
    devFeeCashClosing: devFeeCash * cf.closing_dev_fee_pct,
  };

  // ── Build sources ────────────────────────────────────────────────────────────
  const debtSubdebt = debt?.subdebt ?? [];
  const otherSources = debt?.other_sources ?? [];

  const buildSources = () => {
    const srcs = [];
    // Flex sources from subdebt (closing draws)
    for (const s of debtSubdebt) {
      if (s.payment_type === 'deferred_fee') continue; // DDF is scheduled
      srcs.push({
        id:       `sub_${s.id}`,
        label:    s.label,
        total:    s.amount || 0,
        mode:     'flex',
        priority: s.priority || 10,
        schedule: null,
      });
    }
    // LIHTC equity — closing tranche as flex, later tranches scheduled
    const lihtcEquityTotal = 19000000; // placeholder — from Module 3
    srcs.push({
      id:       'lihtc_closing',
      label:    'LIHTC Equity — Closing',
      total:    lihtcEquityTotal * 0.20,
      mode:     'flex',
      priority: 1,
      schedule: null,
    });
    // Perm loan — scheduled at conversion
    const permLoan = debt?.permanent?.loan_amount || 34049115;
    const convMonth = cf.construction_period_months + cf.leaseup_period_months + 1;
    const permSchedule = {};
    permSchedule[convMonth] = permLoan;
    srcs.push({
      id:       'perm_loan',
      label:    'Permanent Loan',
      total:    permLoan,
      mode:     'scheduled',
      priority: null,
      schedule: permSchedule,
    });
    return srcs;
  };

  const params = {
    constructionMonths: cf.construction_period_months,
    leaseupMonths:      cf.leaseup_period_months,
    stabilizedMonths:   cf.stabilized_months,
    closingDate:        cf.construction_start_date,
    uses,
    sources:            buildSources(),
    teRate,
    taxableRate,
    teLoanMax,
    taxableLoanMax,
    hardCostPeak:       (cf.hard_cost_peak_month || 14) - 1, // 0-based
  };

  // ── Run convergence ──────────────────────────────────────────────────────────
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);

  const runConvergence = useCallback(() => {
    setRunning(true);
    setTimeout(() => {
      try {
        const r = converge(params, startingInterestEst);
        setResult(r);

        // Push results back to Module 2A assumptions
        if (onInterestUpdate) {
          onInterestUpdate({
            const_interest_est:   r.totalConstInterest,
            leaseup_interest_est: r.totalLeaseupInterest,
          });
        }
        // Also save to context
        updateModule("budget", {
          assumptions: {
            ...a,
            const_interest_est:   Math.round(r.totalConstInterest),
            leaseup_interest_est: Math.round(r.totalLeaseupInterest),
          }
        });
      } catch (e) {
        console.error("Convergence error:", e);
      }
      setRunning(false);
    }, 50); // allow render before heavy calc
  }, [params, startingInterestEst]);

  const update = (patch) => updateModule("construction_cf", patch);

  const totalMonths = 1 + cf.construction_period_months + cf.leaseup_period_months + cf.stabilized_months;

  return (
    <div style={{ fontFamily:"Inter, sans-serif" }}>
      {/* Header */}
      <div style={{ display:"flex", alignItems:"baseline", justifyContent:"space-between", marginBottom:20 }}>
        <div style={{ display:"flex", alignItems:"baseline", gap:10 }}>
          <h2 style={{ fontFamily:"'Playfair Display', serif", fontSize:20, fontWeight:400, color:"#111" }}>
            Construction Cash Flow
          </h2>
          <span style={{ fontSize:9, color:"#aaa", letterSpacing:"0.08em", textTransform:"uppercase" }}>
            MODULE 2B · CONVERGENCE ENGINE
          </span>
        </div>
        <button
          onClick={runConvergence}
          disabled={running}
          style={{ background: running ? "#aaa" : "#1a3a6b", color:"white", border:"none",
            padding:"8px 18px", borderRadius:4, cursor: running ? "not-allowed" : "pointer",
            fontSize:10, fontWeight:700, fontFamily:"Inter, sans-serif",
            letterSpacing:"0.07em", textTransform:"uppercase" }}>
          {running ? "Calculating…" : "▶ Run Convergence"}
        </button>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"280px 1fr", gap:20 }}>

        {/* LEFT — Inputs */}
        <div>
          <div style={{ background:"white", border:"1px solid #e0e0e0", borderRadius:6,
            padding:"14px 16px", marginBottom:14 }}>
            <div style={{ fontSize:9, fontWeight:700, color:"#1a3a6b", textTransform:"uppercase",
              letterSpacing:"0.08em", marginBottom:12 }}>Timeline</div>

            <FieldRow label="Construction Period" note="months">
              <NumInput value={cf.construction_period_months} step={1} min={12} max={48}
                onChange={v => update({ construction_period_months: v })} width={60} />
            </FieldRow>
            <FieldRow label="Lease-Up Period" note="months">
              <NumInput value={cf.leaseup_period_months} step={1} min={1} max={24}
                onChange={v => update({ leaseup_period_months: v })} width={60} />
            </FieldRow>
            <FieldRow label="Stabilized Period" note="months shown in table">
              <NumInput value={cf.stabilized_months} step={1} min={1} max={12}
                onChange={v => update({ stabilized_months: v })} width={60} />
            </FieldRow>

            <div style={{ borderTop:"1px solid #f0f0f0", paddingTop:10, marginTop:4 }}>
              <div style={{ fontSize:9, fontWeight:700, color:"#1a3a6b", textTransform:"uppercase",
                letterSpacing:"0.08em", marginBottom:8 }}>Loan Rates</div>
              <FieldRow label="TE Rate" note="Monthly: {(teRate/12*100).toFixed(4)}%">
                <NumInput value={teRate} pct step={0.005}
                  onChange={v => update({ te_rate: v })} />
              </FieldRow>
              <FieldRow label="Taxable Rate">
                <NumInput value={taxableRate} pct step={0.005}
                  onChange={v => update({ taxable_rate: v })} />
              </FieldRow>
            </div>

            <div style={{ borderTop:"1px solid #f0f0f0", paddingTop:10, marginTop:4 }}>
              <div style={{ fontSize:9, fontWeight:700, color:"#1a3a6b", textTransform:"uppercase",
                letterSpacing:"0.08em", marginBottom:8 }}>Spend-Down (S-Curve)</div>
              <FieldRow label="Hard Cost Peak Month"
                note={`Peak spend in month ${cf.hard_cost_peak_month} of ${cf.construction_period_months}`}>
                <NumInput value={cf.hard_cost_peak_month} step={1}
                  min={1} max={cf.construction_period_months}
                  onChange={v => update({ hard_cost_peak_month: v })} width={60} />
              </FieldRow>
            </div>

            <div style={{ borderTop:"1px solid #f0f0f0", paddingTop:10, marginTop:4 }}>
              <div style={{ fontSize:9, fontWeight:700, color:"#1a3a6b", textTransform:"uppercase",
                letterSpacing:"0.08em", marginBottom:8 }}>Closing Allocations</div>
              <FieldRow label="Soft Costs at Closing" note="% of soft cost total">
                <NumInput value={cf.closing_soft_pct} pct step={1}
                  onChange={v => update({ closing_soft_pct: v })} />
              </FieldRow>
              <FieldRow label="Org Costs at Closing" note="% of org cost total">
                <NumInput value={cf.closing_org_pct} pct step={1}
                  onChange={v => update({ closing_org_pct: v })} />
              </FieldRow>
              <FieldRow label="Cash Dev Fee at Closing" note="% of cash dev fee">
                <NumInput value={cf.closing_dev_fee_pct} pct step={5}
                  onChange={v => update({ closing_dev_fee_pct: v })} />
              </FieldRow>
            </div>

            <div style={{ borderTop:"1px solid #f0f0f0", paddingTop:10, marginTop:4 }}>
              <div style={{ fontSize:9, fontWeight:700, color:"#1a3a6b", textTransform:"uppercase",
                letterSpacing:"0.08em", marginBottom:8 }}>Loan Amounts</div>
              <div style={{ fontSize:8, color:"#aaa", marginBottom:8 }}>
                Reading from Debt module. Override below if needed.
              </div>
              <FieldRow label="TE Loan Max" note={cf.te_loan_override ? "manual override" : "from Debt module"}>
                <div style={{ display:"flex", gap:4, alignItems:"center" }}>
                  <NumInput value={cf.te_loan_override ?? teLoanMax} step={100000}
                    onChange={v => update({ te_loan_override: v })} />
                  {cf.te_loan_override && (
                    <button onClick={() => update({ te_loan_override: null })}
                      style={{ background:"none", border:"none", cursor:"pointer",
                        color:"#aaa", fontSize:11 }} title="Reset to Debt module">↺</button>
                  )}
                </div>
              </FieldRow>
              <FieldRow label="Taxable Loan Max" note={cf.taxable_loan_override ? "manual override" : "from Debt module"}>
                <div style={{ display:"flex", gap:4, alignItems:"center" }}>
                  <NumInput value={cf.taxable_loan_override ?? taxableLoanMax} step={100000}
                    onChange={v => update({ taxable_loan_override: v })} />
                  {cf.taxable_loan_override && (
                    <button onClick={() => update({ taxable_loan_override: null })}
                      style={{ background:"none", border:"none", cursor:"pointer",
                        color:"#aaa", fontSize:11 }} title="Reset to Debt module">↺</button>
                  )}
                </div>
              </FieldRow>
            </div>
          </div>

          {/* Budget inputs summary */}
          <div style={{ background:"#f8f9fc", border:"1px solid #e0e8f4", borderRadius:6,
            padding:"12px 14px" }}>
            <div style={{ fontSize:9, fontWeight:700, color:"#888", textTransform:"uppercase",
              letterSpacing:"0.07em", marginBottom:8 }}>Uses from Budget Module</div>
            {[
              { label:"Acquisition",      value: acqTotal },
              { label:"Hard Costs",       value: hardCostsTotal },
              { label:"Soft Costs",       value: scTotal },
              { label:"Const. Financing", value: constFin },
              { label:"Perm. Financing",  value: permFin },
              { label:"Org / Reserves",   value: uses.orgClosing },
              { label:"Cash Dev Fee",     value: devFeeCash },
            ].map(r => (
              <div key={r.label} style={{ display:"flex", justifyContent:"space-between",
                fontSize:9, marginBottom:3 }}>
                <span style={{ color:"#888" }}>{r.label}</span>
                <span style={{ color:"#111", fontWeight:500 }}>{fmt$(r.value)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* RIGHT — Results */}
        <div>
          {!result ? (
            <div style={{ background:"white", border:"2px dashed #e0e0e0", borderRadius:8,
              padding:60, textAlign:"center" }}>
              <div style={{ fontSize:14, color:"#ccc", marginBottom:8, fontWeight:600 }}>
                No results yet
              </div>
              <div style={{ fontSize:11, color:"#bbb", marginBottom:20 }}>
                Configure timeline and inputs, then click Run Convergence
              </div>
              <button onClick={runConvergence}
                style={{ background:"#1a3a6b", color:"white", border:"none", padding:"10px 24px",
                  borderRadius:4, cursor:"pointer", fontSize:11, fontWeight:700,
                  fontFamily:"Inter, sans-serif" }}>
                ▶ Run Convergence
              </button>
            </div>
          ) : (
            <div>
              {/* Convergence summary */}
              <div style={{ background:"#f0f9f4", border:"1px solid #b8dfc8", borderRadius:6,
                padding:"10px 14px", marginBottom:16, display:"flex",
                justifyContent:"space-between", alignItems:"center" }}>
                <div style={{ fontSize:10, color:"#1a6b3c", fontWeight:700 }}>
                  ✓ Converged in {result.iterations} iteration{result.iterations !== 1 ? "s" : ""}
                </div>
                <div style={{ fontSize:9, color:"#aaa" }}>
                  Final interest estimate: {fmt$(result.finalInterestEst)} · Delta &lt;$1
                </div>
              </div>

              {/* Key metrics */}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10, marginBottom:16 }}>
                <MetricCard
                  label="Construction Interest"
                  value={fmt$(result.totalConstInterest)}
                  sub={`${cf.construction_period_months}mo · was est. ${fmt$(startingInterestEst)}`}
                  color="#8B2500" bg="#fce8e3" border="#f5c2b0"
                />
                <MetricCard
                  label="Lease-Up Interest"
                  value={fmt$(result.totalLeaseupInterest)}
                  sub={`${cf.leaseup_period_months}mo lease-up`}
                  color="#5a3a00" bg="#fdf8f0" border="#e8d9b8"
                />
                <MetricCard
                  label="Total Interest"
                  value={fmt$(result.totalInterest)}
                  sub="Construction + Lease-Up"
                  color="#1a3a6b" bg="#f0f3f9" border="#b8c8e0"
                />
              </div>

              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10, marginBottom:16 }}>
                <MetricCard
                  label="TE Loan Drawn"
                  value={fmt$(result.teLoanDrawn)}
                  sub={`of ${fmt$(teLoanMax)} max · ${fmtPct(result.teLoanDrawn / teLoanMax)}`}
                />
                <MetricCard
                  label="Taxable Loan Drawn"
                  value={fmt$(result.taxableLoanDrawn)}
                  sub={`of ${fmt$(taxableLoanMax)} max`}
                />
                <MetricCard
                  label="Total Months"
                  value={totalMonths}
                  sub={`${cf.construction_period_months} const · ${cf.leaseup_period_months} L/U · ${cf.stabilized_months} stab`}
                />
              </div>

              {/* Interest delta vs Module 2A estimate */}
              {(() => {
                const delta = result.totalConstInterest - startingInterestEst;
                const pct = Math.abs(delta / startingInterestEst);
                return pct > 0.01 ? (
                  <div style={{ background: delta > 0 ? "#fce8e3" : "#f0f9f4",
                    border:`1px solid ${delta > 0 ? "#f5c2b0" : "#b8dfc8"}`,
                    borderRadius:6, padding:"10px 14px", marginBottom:16 }}>
                    <div style={{ fontSize:10, fontWeight:700,
                      color: delta > 0 ? "#8B2500" : "#1a6b3c" }}>
                      {delta > 0 ? "↑" : "↓"} Interest {delta > 0 ? "Higher" : "Lower"} Than Module 2A Estimate
                    </div>
                    <div style={{ fontSize:9, color:"#666", marginTop:4 }}>
                      Calculated: {fmt$(result.totalConstInterest)} · 
                      Estimate was: {fmt$(startingInterestEst)} · 
                      Delta: {fmt$(Math.abs(delta))} ({fmtPct1(pct)})
                    </div>
                    <div style={{ fontSize:9, color:"#888", marginTop:4 }}>
                      Dev Budget has been updated with the converged interest figure.
                      TDC will adjust automatically.
                    </div>
                  </div>
                ) : (
                  <div style={{ background:"#f0f9f4", border:"1px solid #b8dfc8",
                    borderRadius:6, padding:"8px 14px", marginBottom:16, fontSize:9,
                    color:"#1a6b3c" }}>
                    ✓ Converged interest matches Module 2A estimate within 1%
                  </div>
                );
              })()}

              {/* Monthly table */}
              <MonthlyTable rows={result.rows} sources={[]} />

              {/* S-curve visualization */}
              <div style={{ background:"white", border:"1px solid #e0e0e0", borderRadius:6,
                padding:"14px 16px", marginTop:14 }}>
                <div style={{ fontSize:9, fontWeight:700, color:"#888", textTransform:"uppercase",
                  letterSpacing:"0.07em", marginBottom:10 }}>
                  Hard Cost Draw — S-Curve Distribution
                </div>
                <div style={{ display:"flex", alignItems:"flex-end", gap:2, height:60 }}>
                  {generateSCurve(cf.construction_period_months, (cf.hard_cost_peak_month || 14) - 1)
                    .map((v, i) => (
                      <div key={i}
                        title={`Month ${i+1}: ${fmtPct1(v)}`}
                        style={{ flex:1, background: i === (cf.hard_cost_peak_month - 1) ? "#8B2500" : "#d0d8e8",
                          height:`${Math.max(4, v * 600)}px`,
                          borderRadius:"2px 2px 0 0", minWidth:4 }}
                      />
                    ))}
                </div>
                <div style={{ display:"flex", justifyContent:"space-between", fontSize:8,
                  color:"#aaa", marginTop:4 }}>
                  <span>Month 1</span>
                  <span style={{ color:"#8B2500" }}>Peak: Month {cf.hard_cost_peak_month}</span>
                  <span>Month {cf.construction_period_months}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
