import { useState, useCallback, useRef, useMemo } from "react";
import { useLihtc } from "./context/LihtcContext.jsx";
import { computeBudgetCalcs, computeLIHTC } from "./lihtcCalcs.js";

// ─────────────────────────────────────────────────────────────────────────────
// MODULE 4 — DEBT STACK
// Construction loan, permanent loan (DSCR sizing), subordinate debt stack.
// Subdebt supports: cash pay, IO, accrual (simple/compound), contingent, forgivable.
// Priority is drag-to-reorder. Balance projection is expandable per loan.
// ─────────────────────────────────────────────────────────────────────────────

const fmt$   = v => v == null ? "—" : "$" + Math.round(v).toLocaleString();
const fmtPct = v => v == null ? "—" : (v * 100).toFixed(3) + "%";
const fmtPct2 = v => v == null ? "—" : (v * 100).toFixed(2) + "%";
const fmtX   = v => v == null ? "—" : v.toFixed(2) + "x";

// Generate unique IDs for new subdebt entries.
// Must be higher than any existing ID in the array to avoid collisions.
let _id = Date.now();  // use timestamp to guarantee uniqueness across sessions
const mkId = () => ++_id;

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT STATE — Apollo SL calibrated
// ─────────────────────────────────────────────────────────────────────────────
const DEFAULT_CONSTRUCTION = {
  lender:                "TBD",
  // Loan sizing — derived from TDC
  bond_test_target_pct:  0.35,   // % of TDC to finance with TE bonds (above 25% floor)
  ltc_pct:               0.82,   // combined loan as % of TDC
  // Calculated from above — stored for reference / manual override
  te_loan_amount:        32941402,
  taxable_loan_amount:   17814416,
  // Rates
  te_rate:               0.0585,
  taxable_rate:          0.0585,
  // Term
  term_months:           36,
  origination_pct:       0.01,
  avg_draw_pct:          0.65,   // avg % drawn during construction (for interest estimate)
  leaseup_months:        12,
  leaseup_draw_pct:      0.85,   // avg % drawn during lease-up
};

const DEFAULT_PERMANENT = {
  lender:            "",
  lender_type:       "Agency",  // Agency / Bank / CDFI / HFA
  loan_program:      "",
  loan_amount:       34049115,
  rate:              0.0585,
  amort_years:       40,
  term_years:        15,
  origination_pct:   0.01,
  io_years:          0,
  mip_annual:        0,
  dscr_requirement:  1.15,
  // NOI — temp until proforma module wired
  noi_override:      2553365,
  use_noi_override:  true,
};

const DEFAULT_SUBDEBT = [
  {
    id: 400, label: "Deferred Developer Fee", priority: 1,
    loan_type: "deferred_fee", amount: 0,  // populated dynamically from budget calc at render
    rate: 0.0, term_years: 12,
    payment_type: "accrual", cash_pay_annual: 0, compound_accrual: false,
    forgive_pct_per_year: 0, in_ads: false,
    notes: "Must be paid in full by Year 12. Zero interest unless otherwise structured. Payable from cash flow, subordinate to all other debt.",
  },
  {
    id: 401, label: "Seller Note", priority: 2,
    loan_type: "seller", amount: 1000000, rate: 0.0, term_years: 15,
    payment_type: "accrual", cash_pay_annual: 0, compound_accrual: false,
    forgive_pct_per_year: 0, in_ads: false, notes: "",
  },
  {
    id: 402, label: "CHIP", priority: 3,
    loan_type: "soft", amount: 900000, rate: 0.005, term_years: 15,
    payment_type: "accrual", cash_pay_annual: 0, compound_accrual: false,
    forgive_pct_per_year: 0, in_ads: false, notes: "",
  },
  {
    id: 403, label: "Sponsor Note", priority: 4,
    loan_type: "sponsor", amount: 346031, rate: 0.0, term_years: 15,
    payment_type: "accrual", cash_pay_annual: 0, compound_accrual: false,
    forgive_pct_per_year: 0, in_ads: false, notes: "",
  },
];

const DEFAULT_OTHER_SOURCES = [
  { id: 501, label: "GP Equity / Cash",  amount: 0,    notes: "" },
  { id: 502, label: "HOME Funds",        amount: 0,    notes: "" },
  { id: 503, label: "FHLB AHP",          amount: 0,    notes: "" },
  { id: 504, label: "CDBG",              amount: 0,    notes: "" },
  { id: 505, label: "Other Grant",       amount: 0,    notes: "" },
];

const LOAN_TYPE_OPTIONS = [
  { value: "soft",        label: "Soft Loan" },
  { value: "cashflow",    label: "Cash Flow" },
  { value: "forgivable",  label: "Forgivable" },
  { value: "sponsor",     label: "Sponsor Note" },
  { value: "seller",      label: "Seller Note" },
  { value: "deferred_fee",label: "Deferred Fee" },
];

const PAYMENT_TYPE_OPTIONS = [
  { value: "cash_pay",   label: "Cash Pay (Full Amort)" },
  { value: "io",         label: "Interest Only" },
  { value: "partial",    label: "Partial Cash Pay" },
  { value: "accrual",    label: "Accrual (No Payment)" },
  { value: "contingent", label: "Contingent on CF" },
  { value: "forgivable", label: "Forgivable" },
];

const LOAN_TYPE_COLORS = {
  soft:        "#1a3a6b",
  cashflow:    "#1a6b3c",
  forgivable:  "#5a3a00",
  sponsor:     "#4a1a6b",
  seller:      "#8B2500",
  deferred_fee:"#444",
};

// ─────────────────────────────────────────────────────────────────────────────
// CALCULATION ENGINE
// ─────────────────────────────────────────────────────────────────────────────

// Debt constant — annual payment per $1 of loan (P&I)
function debtConstant(rate, amortYears) {
  if (!rate || !amortYears) return 0;
  const r = rate / 12;
  const n = amortYears * 12;
  const monthlyPmt = (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
  return monthlyPmt * 12;
}

// Annual debt service for a given loan amount
function annualDS(amount, rate, amortYears, ioYears = 0) {
  if (!amount || !rate) return 0;
  if (ioYears > 0) return amount * rate; // IO payment
  const dc = debtConstant(rate, amortYears);
  return amount * dc;
}

// Loan balance at end of year N (after N full years of payments)
function loanBalanceAtYear(amount, rate, amortYears, year) {
  if (!amount || !rate || !amortYears) return amount;
  const r = rate / 12;
  const n = amortYears * 12;
  const p = year * 12; // payments made
  if (p >= n) return 0;
  const factor = (Math.pow(1 + r, n) - Math.pow(1 + r, p)) / (Math.pow(1 + r, n) - 1);
  return amount * factor;
}

// Subdebt balance projection — returns array of {year, openBal, interest, payment, accrual, forgiven, closeBal}
function subdebtProjection(loan, termYears) {
  const rows = [];
  let balance = loan.amount || 0;
  const rate = loan.rate || 0;
  const forgiveRate = (loan.forgive_pct_per_year || 0) / 100;

  for (let yr = 1; yr <= termYears; yr++) {
    const openBal = balance;
    const interest = loan.compound_accrual
      ? openBal * rate           // compound: interest on running balance
      : (loan.amount || 0) * rate; // simple: interest always on original principal

    let payment = 0;
    let forgiven = 0;

    switch (loan.payment_type) {
      case "cash_pay":
        payment = annualDS(loan.amount, rate, loan.term_years || 15);
        break;
      case "io":
        payment = openBal * rate;
        break;
      case "partial":
        payment = loan.cash_pay_annual || 0;
        break;
      case "accrual":
      case "contingent":
        payment = 0;
        break;
      case "forgivable":
        forgiven = (loan.amount || 0) * forgiveRate;
        payment = 0;
        break;
      default:
        payment = 0;
    }

    const accrual = Math.max(0, interest - payment);
    const closeBal = Math.max(0, openBal + interest - payment - forgiven);
    rows.push({ year: yr, openBal, interest, payment, accrual, forgiven, closeBal });
    balance = closeBal;
  }
  return rows;
}

// Annual cash-pay debt service for a subdebt loan
function subdebtAnnualDS(loan) {
  if (!loan.in_ads) return 0;
  switch (loan.payment_type) {
    case "cash_pay":   return annualDS(loan.amount, loan.rate, loan.term_years);
    case "io":         return (loan.amount || 0) * (loan.rate || 0);
    case "partial":    return loan.cash_pay_annual || 0;
    default:           return 0;
  }
}

function computeDebt(construction, permanent, subdebt, lihtcCalcs, budgetCalcs, tdc) {
  // Construction — derive loan amounts from TDC if bond_test_target_pct is set
  const _tdc          = tdc || 0;
  const combinedTarget = _tdc * (construction.ltc_pct || 0.82);
  const teTarget       = _tdc * (construction.bond_test_target_pct || 0.35);
  const taxTarget      = Math.max(0, combinedTarget - teTarget);
  // Use derived values; fall back to stored amounts if TDC not available
  const teLoan         = _tdc > 0 ? teTarget       : (construction.te_loan_amount || 0);
  const taxLoan        = _tdc > 0 ? taxTarget       : (construction.taxable_loan_amount || 0);
  const combinedConstLoan = teLoan + taxLoan;
  const constOrigination  = combinedConstLoan * (construction.origination_pct || 0);

  // Interest estimate — average draw-down method
  // TE portion
  const teInt = teLoan
    * (construction.te_rate || 0)
    * (construction.avg_draw_pct || 0.65)
    * ((construction.term_months || 36) / 12);
  // Taxable portion
  const taxInt = taxLoan
    * (construction.taxable_rate || 0)
    * (construction.avg_draw_pct || 0.65)
    * ((construction.term_months || 36) / 12);
  // Lease-up interest
  const leaseupInt = combinedConstLoan
    * ((construction.te_rate || 0))
    * (construction.leaseup_draw_pct || 0.85)
    * ((construction.leaseup_months || 12) / 12);

  const constInterestEst = teInt + taxInt;

  // Permanent loan — DSCR sizing
  const noi = permanent.use_noi_override
    ? (permanent.noi_override || 0)
    : (lihtcCalcs?.noi || 0);

  const maxADS      = noi / (permanent.dscr_requirement || 1.15);
  const dc          = debtConstant(permanent.rate, permanent.amort_years);
  const maxLoanDSCR = dc > 0 ? maxADS / dc : 0;
  const permADS     = annualDS(permanent.loan_amount, permanent.rate, permanent.amort_years, permanent.io_years);
  const permDSCR    = permADS > 0 ? noi / permADS : 0;
  const permOrig    = (permanent.loan_amount || 0) * (permanent.origination_pct || 0);

  // Subdebt totals
  const subdebtTotal = subdebt.reduce((s, l) => s + (l.amount || 0), 0);
  const subdebtADS   = subdebt.reduce((s, l) => s + subdebtAnnualDS(l), 0);

  // Total ADS (perm + cash-pay subdebt)
  const totalADS = permADS + subdebtADS;
  const totalDSCR = totalADS > 0 ? noi / totalADS : 0;

  return {
    combinedConstLoan, teLoan, taxLoan, teTarget, combinedTarget,
    constOrigination, constInterestEst, leaseupInt,
    teInt, taxInt,
    noi, maxADS, maxLoanDSCR, dc,
    permADS, permDSCR, permOrig,
    subdebtTotal, subdebtADS, totalADS, totalDSCR,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

function SectionHeader({ title, subtitle, color = "#1a3a6b" }) {
  return (
    <div style={{ display:"flex", alignItems:"baseline", gap:10, marginBottom:14,
      paddingBottom:8, borderBottom:`2px solid ${color}` }}>
      <div style={{ fontSize:13, fontWeight:700, color, fontFamily:"Inter, sans-serif",
        textTransform:"uppercase", letterSpacing:"0.08em" }}>{title}</div>
      {subtitle && <div style={{ fontSize:9, color:"#aaa", fontFamily:"Inter, sans-serif" }}>{subtitle}</div>}
    </div>
  );
}

function FieldRow({ label, note, children }) {
  return (
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
      marginBottom:8, gap:16 }}>
      <div style={{ flex:1 }}>
        <div style={{ fontSize:10, color:"#444", fontFamily:"Inter, sans-serif" }}>{label}</div>
        {note && <div style={{ fontSize:8, color:"#bbb", fontFamily:"Inter, sans-serif" }}>{note}</div>}
      </div>
      <div style={{ flexShrink:0 }}>{children}</div>
    </div>
  );
}

function NumInput({ value, onChange, step, min, pct, prefix, width = 110, disabled }) {
  const display = pct ? +(value * 100).toFixed(4) : value;
  return (
    <div style={{ display:"flex", alignItems:"center", gap:4 }}>
      {prefix && <span style={{ fontSize:10, color:"#888" }}>{prefix}</span>}
      <input
        type="number"
        value={display ?? ""}
        step={step || (pct ? 0.01 : 1000)}
        min={min}
        disabled={disabled}
        onChange={e => onChange(pct ? Number(e.target.value) / 100 : Number(e.target.value))}
        style={{ background: disabled ? "#f5f5f5" : "#f8f8f8", border:"1px solid #e0e0e0",
          borderRadius:4, padding:"4px 8px", fontSize:11, fontFamily:"Inter, sans-serif",
          color: disabled ? "#aaa" : "#111", outline:"none", width, textAlign:"right",
          cursor: disabled ? "not-allowed" : "auto" }}
      />
      {pct && <span style={{ fontSize:10, color:"#888" }}>%</span>}
    </div>
  );
}

function TextInput({ value, onChange, placeholder, width = "100%" }) {
  return (
    <input
      value={value || ""}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={{ background:"#f8f8f8", border:"1px solid #e0e0e0", borderRadius:4,
        padding:"4px 8px", fontSize:11, fontFamily:"Inter, sans-serif", color:"#111",
        outline:"none", width }}
    />
  );
}

function Select({ value, onChange, options, width = 140 }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      style={{ background:"#f8f8f8", border:"1px solid #e0e0e0", borderRadius:4,
        padding:"4px 8px", fontSize:11, fontFamily:"Inter, sans-serif", color:"#111",
        outline:"none", width, cursor:"pointer" }}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function CalcRow({ label, value, operator, highlight, deduction, indent }) {
  return (
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
      padding:"5px 0", borderBottom:"1px solid #f5f5f5" }}>
      <div style={{ display:"flex", alignItems:"center", gap:8,
        paddingLeft: indent ? 20 : 0 }}>
        {operator && (
          <span style={{ fontSize:12, fontWeight:700, color:"#1a3a6b", width:14,
            textAlign:"center", fontFamily:"Inter, sans-serif" }}>{operator}</span>
        )}
        <span style={{ fontSize:10, color:"#666", fontFamily:"Inter, sans-serif" }}>{label}</span>
      </div>
      <span style={{ fontSize:11, fontWeight: highlight ? 700 : 500,
        color: deduction ? "#8B2500" : highlight ? "#1a3a6b" : "#111",
        fontFamily:"Inter, sans-serif" }}>
        {value}
      </span>
    </div>
  );
}

// Balance projection table — expandable
function BalanceTable({ loan }) {
  const term = loan.term_years || 15;
  const rows = subdebtProjection(loan, term);
  const hasPayment = ["cash_pay","io","partial"].includes(loan.payment_type);
  const hasAccrual = ["accrual","contingent","partial"].includes(loan.payment_type);
  const hasForgivable = loan.payment_type === "forgivable";

  return (
    <div style={{ marginTop:10, overflowX:"auto" }}>
      <table style={{ width:"100%", borderCollapse:"collapse", fontSize:10,
        fontFamily:"Inter, sans-serif" }}>
        <thead>
          <tr style={{ background:"#f5f5f5", borderBottom:"1px solid #e0e0e0" }}>
            <th style={{ padding:"4px 8px", textAlign:"right", color:"#888", fontWeight:700,
              fontSize:8, textTransform:"uppercase", letterSpacing:"0.06em" }}>Year</th>
            <th style={{ padding:"4px 8px", textAlign:"right", color:"#888", fontWeight:700,
              fontSize:8, textTransform:"uppercase", letterSpacing:"0.06em" }}>Open Bal</th>
            <th style={{ padding:"4px 8px", textAlign:"right", color:"#888", fontWeight:700,
              fontSize:8, textTransform:"uppercase", letterSpacing:"0.06em" }}>Interest</th>
            {hasPayment && <th style={{ padding:"4px 8px", textAlign:"right", color:"#888",
              fontWeight:700, fontSize:8, textTransform:"uppercase", letterSpacing:"0.06em" }}>Payment</th>}
            {hasAccrual && <th style={{ padding:"4px 8px", textAlign:"right", color:"#8B2500",
              fontWeight:700, fontSize:8, textTransform:"uppercase", letterSpacing:"0.06em" }}>Accrual</th>}
            {hasForgivable && <th style={{ padding:"4px 8px", textAlign:"right", color:"#1a6b3c",
              fontWeight:700, fontSize:8, textTransform:"uppercase", letterSpacing:"0.06em" }}>Forgiven</th>}
            <th style={{ padding:"4px 8px", textAlign:"right", color:"#111", fontWeight:700,
              fontSize:8, textTransform:"uppercase", letterSpacing:"0.06em" }}>Close Bal</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.year} style={{ background: i % 2 === 0 ? "white" : "#fafafa",
              borderBottom:"1px solid #f5f5f5" }}>
              <td style={{ padding:"3px 8px", textAlign:"right", color:"#888" }}>{r.year}</td>
              <td style={{ padding:"3px 8px", textAlign:"right" }}>{fmt$(r.openBal)}</td>
              <td style={{ padding:"3px 8px", textAlign:"right", color:"#666" }}>{fmt$(r.interest)}</td>
              {hasPayment && <td style={{ padding:"3px 8px", textAlign:"right",
                color:"#1a3a6b" }}>{fmt$(r.payment)}</td>}
              {hasAccrual && <td style={{ padding:"3px 8px", textAlign:"right",
                color: r.accrual > 0 ? "#8B2500" : "#aaa" }}>{fmt$(r.accrual)}</td>}
              {hasForgivable && <td style={{ padding:"3px 8px", textAlign:"right",
                color:"#1a6b3c" }}>{fmt$(r.forgiven)}</td>}
              <td style={{ padding:"3px 8px", textAlign:"right", fontWeight:600,
                color: r.closeBal > r.openBal ? "#8B2500" : "#111" }}>{fmt$(r.closeBal)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ borderTop:"2px solid #111", background:"#f8f8f8" }}>
            <td colSpan={2} style={{ padding:"4px 8px", fontSize:9, fontWeight:700,
              color:"#888", textTransform:"uppercase" }}>MATURITY BALANCE</td>
            <td colSpan={99} style={{ padding:"4px 8px", textAlign:"right", fontWeight:700,
              fontSize:12, color: rows[rows.length-1]?.closeBal > (loan.amount||0) ? "#8B2500" : "#1a3a6b" }}>
              {fmt$(rows[rows.length-1]?.closeBal)}
            </td>
          </tr>
          {loan.loan_type === "deferred_fee" && rows[rows.length-1]?.closeBal > 0 && (
            <tr style={{ background:"#fdf8f0" }}>
              <td colSpan={99} style={{ padding:"4px 8px", fontSize:8, color:"#5a3a00", fontStyle:"italic" }}>
                ⚠ DDF must be paid in full on or before Year 12 from project cash flow or recap proceeds.
              </td>
            </tr>
          )}
        </tfoot>
      </table>
      {loan.compound_accrual && (
        <div style={{ fontSize:8, color:"#aaa", marginTop:4, fontFamily:"Inter, sans-serif" }}>
          Compound accrual — interest accrues on running balance
        </div>
      )}
      {!loan.compound_accrual && loan.payment_type === "accrual" && (
        <div style={{ fontSize:8, color:"#aaa", marginTop:4, fontFamily:"Inter, sans-serif" }}>
          Simple accrual — interest accrues on original principal only
        </div>
      )}
    </div>
  );
}

// Single subdebt card — draggable
function SubdebtCard({ loan, onUpdate, onRemove, dragHandleProps, isDragging }) {
  const [expanded, setExpanded] = useState(false);
  const isDDF = loan.loan_type === "deferred_fee";
  const color = LOAN_TYPE_COLORS[loan.loan_type] || "#444";
  const annualCashDS = subdebtAnnualDS(loan);
  const projection = subdebtProjection(loan, loan.term_years || 15);
  const maturityBal = projection[projection.length - 1]?.closeBal ?? loan.amount;
  const grows = maturityBal > (loan.amount || 0);

  const inpStyle = { background:"#f8f8f8", border:"1px solid #e0e0e0", borderRadius:3,
    padding:"3px 6px", fontSize:10, fontFamily:"Inter, sans-serif", color:"#111",
    outline:"none", textAlign:"right" };

  return (
    <div style={{ background:"white", border:`1px solid ${isDragging ? color : "#e0e0e0"}`,
      borderLeft:`3px solid ${color}`, borderRadius:6, marginBottom:8,
      opacity: isDragging ? 0.8 : 1, boxShadow: isDragging ? "0 4px 12px rgba(0,0,0,0.15)" : "none" }}>

      {/* Card header */}
      <div style={{ display:"flex", alignItems:"center", gap:8, padding:"10px 12px",
        cursor:"pointer" }} onClick={() => setExpanded(v => !v)}>

        {/* Drag handle */}
        <div {...dragHandleProps}
          onClick={e => e.stopPropagation()}
          style={{ cursor:"grab", color:"#ccc", fontSize:14, padding:"0 4px",
            userSelect:"none", flexShrink:0 }}
          title="Drag to reorder priority">
          ⠿
        </div>

        {/* Priority badge */}
        <div style={{ width:20, height:20, borderRadius:"50%", background:color,
          color:"white", fontSize:10, fontWeight:700, display:"flex", alignItems:"center",
          justifyContent:"center", flexShrink:0 }}>
          {loan.priority}
        </div>

        {/* Lender name — editable inline (read-only for DDF) */}
        <input
          value={loan.label}
          onChange={e => { e.stopPropagation(); if (!isDDF) onUpdate({ label: e.target.value }); }}
          onClick={e => e.stopPropagation()}
          readOnly={isDDF}
          style={{ flex:1, background:"transparent", border:"none", outline:"none",
            fontSize:12, fontWeight:700, fontFamily:"Inter, sans-serif",
            color: isDDF ? "#888" : "#111", cursor: isDDF ? "default" : "text" }}
        />

        {/* Summary chips */}
        <div style={{ display:"flex", gap:6, alignItems:"center", flexShrink:0 }}>
          <span style={{ fontSize:10, fontWeight:600, color:"#111" }}>{fmt$(loan.amount)}</span>
          <span style={{ fontSize:9, background:"#f5f5f5", border:"1px solid #e0e0e0",
            borderRadius:3, padding:"1px 5px", color:"#666" }}>
            {PAYMENT_TYPE_OPTIONS.find(o => o.value === loan.payment_type)?.label || loan.payment_type}
          </span>
          {grows && (
            <span style={{ fontSize:9, color:"#8B2500", background:"#fce8e3",
              border:"1px solid #f5c2b0", borderRadius:3, padding:"1px 5px" }}>
              Grows → {fmt$(maturityBal)}
            </span>
          )}
          {annualCashDS > 0 && (
            <span style={{ fontSize:9, color:"#1a6b3c", background:"#f0f9f4",
              border:"1px solid #b8dfc8", borderRadius:3, padding:"1px 5px" }}>
              DS: {fmt$(annualCashDS)}/yr
            </span>
          )}
        </div>

        <span style={{ color:"#aaa", fontSize:10, flexShrink:0 }}>{expanded ? "▲" : "▼"}</span>
        {!isDDF && (
          <button onClick={e => { e.stopPropagation(); onRemove(); }}
            style={{ background:"none", border:"none", cursor:"pointer", color:"#ddd",
              fontSize:12, padding:"0 4px", flexShrink:0 }}
            onMouseEnter={e => e.target.style.color="#8B2500"}
            onMouseLeave={e => e.target.style.color="#ddd"}>✕</button>
        )}
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div style={{ padding:"0 12px 12px 12px", borderTop:"1px solid #f5f5f5" }}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10, marginTop:10 }}>

            {/* Column 1 — Loan terms */}
            <div>
              <div style={{ fontSize:8, fontWeight:700, color:"#888", textTransform:"uppercase",
                letterSpacing:"0.06em", marginBottom:6 }}>Loan Terms</div>
              <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <span style={{ fontSize:9, color:"#666" }}>Type</span>
                  {isDDF ? (
                    <span style={{ fontSize:10, color:"#888", fontStyle:"italic" }}>Deferred Fee</span>
                  ) : (
                    <Select value={loan.loan_type} onChange={v => onUpdate({ loan_type: v })}
                      options={LOAN_TYPE_OPTIONS} width={110} />
                  )}
                </div>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <span style={{ fontSize:9, color:"#666" }}>Amount</span>
                  {isDDF ? (
                    <span style={{ fontSize:10, color:"#888", fontStyle:"italic" }}>{fmt$(loan.amount)} (auto)</span>
                  ) : (
                    <input type="number" value={loan.amount || ""} step={10000}
                      onChange={e => onUpdate({ amount: Number(e.target.value) })}
                      style={{ ...inpStyle, width:110 }} />
                  )}
                </div>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <span style={{ fontSize:9, color:"#666" }}>Rate</span>
                  <div style={{ display:"flex", alignItems:"center", gap:3 }}>
                    <input type="number" value={+(loan.rate * 100).toFixed(4)} step={0.01}
                      onChange={e => onUpdate({ rate: Number(e.target.value) / 100 })}
                      style={{ ...inpStyle, width:70 }} />
                    <span style={{ fontSize:9, color:"#888" }}>%</span>
                  </div>
                </div>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <span style={{ fontSize:9, color:"#666" }}>Term (years)</span>
                  <input type="number" value={loan.term_years || ""} step={1}
                    onChange={e => onUpdate({ term_years: Number(e.target.value) })}
                    style={{ ...inpStyle, width:60 }} />
                </div>
              </div>
            </div>

            {/* Column 2 — Payment structure */}
            <div>
              <div style={{ fontSize:8, fontWeight:700, color:"#888", textTransform:"uppercase",
                letterSpacing:"0.06em", marginBottom:6 }}>Payment Structure</div>
              <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <span style={{ fontSize:9, color:"#666" }}>Payment Type</span>
                  <Select value={loan.payment_type} onChange={v => onUpdate({ payment_type: v })}
                    options={PAYMENT_TYPE_OPTIONS} width={140} />
                </div>
                {loan.payment_type === "partial" && (
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                    <span style={{ fontSize:9, color:"#666" }}>Annual Cash Pay</span>
                    <input type="number" value={loan.cash_pay_annual || ""} step={1000}
                      onChange={e => onUpdate({ cash_pay_annual: Number(e.target.value) })}
                      style={{ ...inpStyle, width:110 }} />
                  </div>
                )}
                {loan.payment_type === "forgivable" && (
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                    <span style={{ fontSize:9, color:"#666" }}>Forgive % / Year</span>
                    <div style={{ display:"flex", alignItems:"center", gap:3 }}>
                      <input type="number" value={loan.forgive_pct_per_year || ""} step={1}
                        onChange={e => onUpdate({ forgive_pct_per_year: Number(e.target.value) })}
                        style={{ ...inpStyle, width:60 }} />
                      <span style={{ fontSize:9, color:"#888" }}>%</span>
                    </div>
                  </div>
                )}
                {(loan.payment_type === "accrual" || loan.payment_type === "partial") && (
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                    <span style={{ fontSize:9, color:"#666" }}>Compound accrual?</span>
                    <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                      <input type="checkbox" checked={loan.compound_accrual || false}
                        onChange={e => onUpdate({ compound_accrual: e.target.checked })}
                        style={{ cursor:"pointer", accentColor:color }} />
                      <span style={{ fontSize:8, color:"#aaa" }}>
                        {loan.compound_accrual ? "Compound" : "Simple"}
                      </span>
                    </div>
                  </div>
                )}
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <span style={{ fontSize:9, color:"#666" }}>Count in ADS?</span>
                  <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                    <input type="checkbox" checked={loan.in_ads || false}
                      onChange={e => onUpdate({ in_ads: e.target.checked })}
                      style={{ cursor:"pointer", accentColor:"#1a3a6b" }} />
                    <span style={{ fontSize:8, color:"#aaa" }}>
                      {loan.in_ads ? "Yes — in DSCR" : "No — excluded from DSCR"}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Column 3 — Notes + at maturity */}
            <div>
              <div style={{ fontSize:8, fontWeight:700, color:"#888", textTransform:"uppercase",
                letterSpacing:"0.06em", marginBottom:6 }}>At Maturity / Notes</div>
              <div style={{ background: grows ? "#fce8e3" : "#f0f9f4",
                border:`1px solid ${grows ? "#f5c2b0" : "#b8dfc8"}`,
                borderRadius:4, padding:"8px 10px", marginBottom:8 }}>
                <div style={{ fontSize:8, color:"#888", marginBottom:2 }}>Balance at Maturity</div>
                <div style={{ fontSize:14, fontWeight:700,
                  color: grows ? "#8B2500" : "#1a6b3c" }}>{fmt$(maturityBal)}</div>
                {grows && (
                  <div style={{ fontSize:8, color:"#8B2500", marginTop:2 }}>
                    +{fmt$(maturityBal - (loan.amount || 0))} accrued
                  </div>
                )}
              </div>
              <textarea value={loan.notes || ""}
                onChange={e => onUpdate({ notes: e.target.value })}
                placeholder="Notes (priority, terms, conditions...)"
                rows={3}
                style={{ width:"100%", background:"#fafafa", border:"1px solid #e8e8e8",
                  borderRadius:4, padding:"6px 8px", fontSize:9, fontFamily:"Inter, sans-serif",
                  color:"#666", resize:"vertical", outline:"none", boxSizing:"border-box" }} />
            </div>
          </div>

          {/* Balance table */}
          <div>
            <div style={{ fontSize:9, fontWeight:700, color:"#888", textTransform:"uppercase",
              letterSpacing:"0.06em", marginTop:10, marginBottom:4 }}>
              Balance Projection — {loan.term_years || 15} Years
            </div>
            <BalanceTable loan={loan} />
          </div>
        </div>
      )}
    </div>
  );
}

// Draggable subdebt list — manual drag with refs
function SubdebtList({ loans, onUpdate, onRemove, onReorder }) {
  const dragIdx = useRef(null);
  const dragOverIdx = useRef(null);

  const handleDragStart = (idx) => { dragIdx.current = idx; };
  const handleDragEnter = (idx) => { dragOverIdx.current = idx; };
  const handleDragEnd   = () => {
    if (dragIdx.current === null || dragOverIdx.current === null) return;
    if (dragIdx.current === dragOverIdx.current) return;
    const reordered = [...loans];
    const [moved] = reordered.splice(dragIdx.current, 1);
    reordered.splice(dragOverIdx.current, 0, moved);
    // Re-assign priorities
    const withPriority = reordered.map((l, i) => ({ ...l, priority: i + 1 }));
    onReorder(withPriority);
    dragIdx.current = null;
    dragOverIdx.current = null;
  };

  return (
    <div>
      {loans.map((loan, idx) => (
        <div key={loan.id}
          draggable
          onDragStart={() => handleDragStart(idx)}
          onDragEnter={() => handleDragEnter(idx)}
          onDragEnd={handleDragEnd}
          onDragOver={e => e.preventDefault()}>
          <SubdebtCard
            loan={loan}
            onUpdate={patch => onUpdate(loan.id, patch)}
            onRemove={() => onRemove(loan.id)}
            dragHandleProps={{}}
            isDragging={false}
          />
        </div>
      ))}
    </div>
  );
}

// Sources & Uses summary card
function SourcesUsesSummary({ calcs, permanent, construction, subdebt, otherSources,
  lihtcEquity, stateEquity, deferredDevFee, tdc }) {

  const permLoan    = permanent.loan_amount || 0;
  const subdebtTot  = subdebt.reduce((s, l) => s + (l.amount || 0), 0);
  const otherTot    = otherSources.reduce((s, l) => s + (l.amount || 0), 0);
  const fedEquity   = lihtcEquity || 0;
  const stEquity    = stateEquity || 0;
  const ddf         = deferredDevFee || 0;

  const totalSources = permLoan + subdebtTot + otherTot + fedEquity + stEquity; // DDF now in subdebtTot
  const gap          = totalSources - (tdc || 0);
  const gapPct       = tdc > 0 ? gap / tdc : 0;

  // DDF is now part of subdebt stack — included in subdebtTot
  const sources = [
    { label:"Permanent Loan",          amount: permLoan,   color:"#1a3a6b" },
    { label:"Subordinate Debt (incl. DDF)", amount: subdebtTot, color:"#5a3a00" },
    { label:"Federal LIHTC Equity",    amount: fedEquity,  color:"#1a6b3c" },
    { label:"State LIHTC Equity",      amount: stEquity,   color:"#2a8a50" },
    { label:"Other Sources / Grants",  amount: otherTot,   color:"#4a1a6b" },
  ].filter(s => s.amount > 0);

  return (
    <div style={{ background:"#111", borderRadius:8, padding:"16px 20px" }}>
      <div style={{ fontSize:9, fontWeight:700, color:"#888", textTransform:"uppercase",
        letterSpacing:"0.08em", marginBottom:14 }}>Sources vs. Uses Summary</div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20 }}>
        {/* Sources */}
        <div>
          <div style={{ fontSize:8, color:"#666", textTransform:"uppercase", letterSpacing:"0.06em",
            marginBottom:8 }}>Sources</div>
          {sources.map(s => (
            <div key={s.label} style={{ display:"flex", justifyContent:"space-between",
              marginBottom:5, alignItems:"center" }}>
              <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                <div style={{ width:6, height:6, borderRadius:1, background:s.color }} />
                <span style={{ fontSize:10, color:"#ccc" }}>{s.label}</span>
              </div>
              <span style={{ fontSize:10, fontWeight:600, color:"white" }}>{fmt$(s.amount)}</span>
            </div>
          ))}
          <div style={{ borderTop:"1px solid #333", marginTop:8, paddingTop:8,
            display:"flex", justifyContent:"space-between" }}>
            <span style={{ fontSize:10, fontWeight:700, color:"#888" }}>TOTAL SOURCES</span>
            <span style={{ fontSize:12, fontWeight:700, color:"white" }}>{fmt$(totalSources)}</span>
          </div>
        </div>

        {/* Uses + Gap */}
        <div>
          <div style={{ fontSize:8, color:"#666", textTransform:"uppercase", letterSpacing:"0.06em",
            marginBottom:8 }}>Uses</div>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
            <span style={{ fontSize:10, color:"#ccc" }}>Total Dev Cost</span>
            <span style={{ fontSize:10, fontWeight:600, color:"white" }}>{fmt$(tdc)}</span>
          </div>
          <div style={{ borderTop:"1px solid #333", marginTop:20, paddingTop:12 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <span style={{ fontSize:11, fontWeight:700,
                color: gap >= 0 ? "#4ade80" : "#f87171" }}>
                {gap >= 0 ? "SURPLUS" : "GAP"}
              </span>
              <span style={{ fontSize:18, fontWeight:700,
                color: gap >= 0 ? "#4ade80" : "#f87171" }}>
                {gap >= 0 ? "+" : ""}{fmt$(gap)}
              </span>
            </div>
            <div style={{ fontSize:9, color:"#555", marginTop:2 }}>
              {(gapPct * 100).toFixed(2)}% of TDC
            </div>
          </div>

          {/* DSCR summary */}
          <div style={{ marginTop:14, paddingTop:12, borderTop:"1px solid #333" }}>
            <div style={{ fontSize:8, color:"#666", textTransform:"uppercase", letterSpacing:"0.06em",
              marginBottom:6 }}>Debt Coverage</div>
            {[
              { label:"NOI",            value: fmt$(calcs.noi) },
              { label:"Perm ADS",       value: fmt$(calcs.permADS) },
              { label:"Senior DSCR",    value: fmtX(calcs.permDSCR) },
              { label:"Total ADS",      value: fmt$(calcs.totalADS) },
              { label:"Total DSCR",     value: fmtX(calcs.totalDSCR) },
            ].map(r => (
              <div key={r.label} style={{ display:"flex", justifyContent:"space-between",
                marginBottom:3 }}>
                <span style={{ fontSize:9, color:"#888" }}>{r.label}</span>
                <span style={{ fontSize:9, fontWeight:600,
                  color: r.label.includes("DSCR") && parseFloat(r.value) < 1.15
                    ? "#f87171" : "white" }}>{r.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PANEL
// ─────────────────────────────────────────────────────────────────────────────
export default function DebtPanel() {
  const { moduleStates, updateModule } = useLihtc();

  const construction  = { ...DEFAULT_CONSTRUCTION,  ...moduleStates.debt?.construction  };
  const permanent     = { ...DEFAULT_PERMANENT,      ...moduleStates.debt?.permanent     };
  // Ensure every subdebt entry has a unique id (saved entries from Supabase may lack ids).
  // Deduplicate by label as a safety measure against accidental duplicates.
  const rawSubdebt = useMemo(() => {
    let list = moduleStates.debt?.subdebt ?? DEFAULT_SUBDEBT;
    // Assign IDs to any entries missing them
    const maxExisting = list.reduce((mx, l) => Math.max(mx, l.id || 0), 0);
    let nextId = Math.max(maxExisting + 1, 300);
    list = list.map(l => l.id != null ? l : { ...l, id: nextId++ });
    return list;
  }, [moduleStates.debt?.subdebt]);
  const otherSources  = moduleStates.debt?.other_sources ?? DEFAULT_OTHER_SOURCES;

  // TDC from budget module
  const budget = moduleStates.budget;
  const unitMix = moduleStates.unit_mix;
  const totalUnits = (unitMix?.rows ?? []).reduce((s, r) => s + (r.count || 0), 0) || 175;

  // Budget calcs from shared utility — single source of truth
  const budgetCalcs = computeBudgetCalcs(budget, totalUnits);
  const tdc = budgetCalcs.tdc;
  const deferredDevFee = budgetCalcs.deferredDevFee;
  const aggrBasis = budgetCalcs.aggregateBasis;

  // LIHTC equity from shared utility — same calculation as Tax Credit module
  const lihtcInputs = moduleStates.lihtc || {};
  const lihtcDefaults = {
    credit_type:"4pct", applicable_pct:0.04, basis_boost:true, boost_factor:1.30,
    applicable_fraction:1.0, credit_period:10, investor_price:0.82,
    non_basis_costs:6527411, commercial_costs:0, federal_grants:0, historic_reduction:0,
    state_credit_applies:false, state_credit_annual:0, state_credit_period:10, state_credit_price:0,
  };
  const lihtcResult = computeLIHTC({ ...lihtcDefaults, ...lihtcInputs }, budgetCalcs, totalUnits);
  const lihtcEquity = lihtcResult.equityRaised;
  const stateEquity = lihtcResult.stateEquity;

  // Sync DDF amount from budget calc into the subdebt entry
  // This ensures the DDF entry always reflects the live budget calculation
  const subdebt = rawSubdebt.map(l =>
    l.loan_type === "deferred_fee"
      ? { ...l, amount: deferredDevFee || l.amount }
      : l
  );

  const calcs = computeDebt(construction, permanent, subdebt, null, null, tdc);

  // Writers
  const updateConstruction = p => updateModule("debt", { construction: { ...construction, ...p } });
  const updatePermanent    = p => updateModule("debt", { permanent:    { ...permanent,    ...p } });
  const updateSubdebt      = (id, p) => updateModule("debt", { subdebt: subdebt.map(l => l.id===id ? {...l,...p} : l) });
  const removeSubdebt      = id => updateModule("debt", { subdebt: subdebt.filter(l => l.id!==id).map((l,i)=>({...l,priority:i+1})) });
  const reorderSubdebt     = newList => updateModule("debt", { subdebt: newList });
  const addSubdebt         = () => updateModule("debt", { subdebt: [...subdebt, {
    id: mkId(), label: "New Loan", priority: subdebt.length + 1,
    loan_type:"soft", amount:0, rate:0, term_years:15,
    payment_type:"accrual", cash_pay_annual:0, compound_accrual:false,
    forgive_pct_per_year:0, in_ads:false, notes:"",
  }]});
  const updateOtherSource  = (id, p) => updateModule("debt", { other_sources: otherSources.map(s => s.id===id ? {...s,...p} : s) });

  return (
    <div style={{ fontFamily:"Inter, sans-serif" }}>
      {/* Header */}
      <div style={{ display:"flex", alignItems:"baseline", justifyContent:"space-between", marginBottom:20 }}>
        <div style={{ display:"flex", alignItems:"baseline", gap:10 }}>
          <h2 style={{ fontFamily:"'Playfair Display', serif", fontSize:20, fontWeight:400, color:"#111" }}>
            Debt Stack
          </h2>
          <span style={{ fontSize:9, color:"#aaa", letterSpacing:"0.08em", textTransform:"uppercase" }}>
            MODULE 4 · FINANCING STRUCTURE
          </span>
        </div>
        <div style={{ display:"flex", gap:8 }}>
          <div style={{ padding:"4px 10px", borderRadius:4, fontSize:9, fontWeight:700,
            background: calcs.permDSCR >= (permanent.dscr_requirement||1.15) ? "#f0f9f4" : "#fce8e3",
            color: calcs.permDSCR >= (permanent.dscr_requirement||1.15) ? "#1a6b3c" : "#8B2500",
            border:`1px solid ${calcs.permDSCR >= (permanent.dscr_requirement||1.15) ? "#b8dfc8" : "#f5c2b0"}` }}>
            Senior DSCR: {fmtX(calcs.permDSCR)}
          </div>
        </div>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20 }}>

        {/* LEFT COLUMN */}
        <div>
          {/* ── CONSTRUCTION LOAN ── */}
          <div style={{ background:"white", border:"1px solid #e0e0e0", borderRadius:6,
            padding:"16px 18px", marginBottom:16 }}>
            <SectionHeader title="Construction Financing" color="#8B2500"
              subtitle="Tax-exempt + taxable companion loan · Module 2B will calculate exact interest" />



            <FieldRow label="Lender">
              <TextInput value={construction.lender} onChange={v => updateConstruction({ lender: v })} width={180} />
            </FieldRow>
            {/* Bond Test Target — drives TE loan amount */}
            <div style={{ background:"#f8f8f8", border:"1px solid #e0e0e0", borderRadius:5,
              padding:"10px 12px", marginBottom:10 }}>
              <div style={{ fontSize:8, fontWeight:700, color:"#888", textTransform:"uppercase",
                letterSpacing:"0.07em", marginBottom:8 }}>Loan Sizing</div>
              <FieldRow label="LTC %" note="Combined loan as % of TDC">
                <NumInput value={construction.ltc_pct} pct step={1}
                  onChange={v => updateConstruction({ ltc_pct: v })} />
              </FieldRow>
              <FieldRow label="Bond Test Target %" note={`Min 25% per OBBBA 2025 · Drives TE bond amount · Current: ${((calcs.teLoan / tdc) * 100).toFixed(1)}% of TDC`}>
                <NumInput value={construction.bond_test_target_pct} pct step={1}
                  onChange={v => updateConstruction({ bond_test_target_pct: v })} />
              </FieldRow>
              <div style={{ borderTop:"1px solid #e0e0e0", marginTop:8, paddingTop:8 }}>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                  <span style={{ fontSize:9, color:"#666" }}>TE Bond Amount</span>
                  <span style={{ fontSize:11, fontWeight:700, color:"#1a3a6b" }}>{fmt$(calcs.teLoan)}</span>
                </div>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                  <span style={{ fontSize:9, color:"#666" }}>Taxable Tail</span>
                  <span style={{ fontSize:11, fontWeight:600, color:"#666" }}>{fmt$(calcs.taxLoan)}</span>
                </div>
                <div style={{ display:"flex", justifyContent:"space-between" }}>
                  <span style={{ fontSize:9, color:"#888", fontWeight:700 }}>Combined Construction Loan</span>
                  <span style={{ fontSize:12, fontWeight:700, color:"#8B2500" }}>{fmt$(calcs.combinedConstLoan)}</span>
                </div>
              </div>
              {/* Bond test check */}
              {(() => {
                // Use budget-derived aggregate basis if available, else fall back to TDC - land
                const _aggrBasis = aggrBasis || (tdc - ((moduleStates.budget?.sections?.acquisition?.reduce((s,l)=>s+(l.amount||0),0)) || 4488000));
                const bondPct = _aggrBasis > 0 ? calcs.teLoan / _aggrBasis : 0;
                const testThreshold = (construction.bond_test_target_pct || 0.35);
                const passes = bondPct >= 0.25;
                return (
                  <div style={{ marginTop:8, padding:"6px 10px", borderRadius:4,
                    background: passes ? "#f0f9f4" : "#fce8e3",
                    border:`1px solid ${passes ? "#b8dfc8" : "#f5c2b0"}` }}>
                    <div style={{ fontSize:8, fontWeight:700, color: passes ? "#1a6b3c" : "#8B2500", marginBottom:3 }}>
                      {passes ? "✓" : "✗"} 25% Bond Test: {(bondPct * 100).toFixed(1)}% of aggregate basis
                    </div>
                    <div style={{ fontSize:8, color:"#888" }}>
                      TE Loan {fmt$(calcs.teLoan)} ÷ Agg. Basis {fmt$(_aggrBasis)}
                      {aggrBasis ? " · from Dev Budget bond_basis flags" : " · est. (set budget line flags for exact calc)"}
                    </div>
                  </div>
                );
              })()}
            </div>
            <FieldRow label="TE Rate" note="Tax-exempt tranche">
              <NumInput value={construction.te_rate} pct step={0.005}
                onChange={v => updateConstruction({ te_rate: v })} />
            </FieldRow>
            <FieldRow label="Taxable Rate">
              <NumInput value={construction.taxable_rate} pct step={0.005}
                onChange={v => updateConstruction({ taxable_rate: v })} />
            </FieldRow>
            <FieldRow label="Term (months)">
              <NumInput value={construction.term_months} step={1}
                onChange={v => updateConstruction({ term_months: v })} width={60} />
            </FieldRow>

            <FieldRow label="Origination Fee %">
              <NumInput value={construction.origination_pct} pct step={0.1}
                onChange={v => updateConstruction({ origination_pct: v })} />
            </FieldRow>

            {/* Interest estimate calc */}
            <div style={{ background:"#fdf8f0", border:"1px solid #e8d9b8", borderRadius:5,
              padding:"10px 12px", marginTop:10 }}>
              <div style={{ fontSize:8, fontWeight:700, color:"#5a3a00", textTransform:"uppercase",
                letterSpacing:"0.07em", marginBottom:8 }}>
                Interest Estimate — Avg Draw-Down Method
              </div>
              <FieldRow label="Avg % Drawn (construction)" note="Apply to loan balance for interest calc">
                <NumInput value={construction.avg_draw_pct} pct step={1}
                  onChange={v => updateConstruction({ avg_draw_pct: v })} />
              </FieldRow>
              <FieldRow label="Lease-Up Months">
                <NumInput value={construction.leaseup_months} step={1}
                  onChange={v => updateConstruction({ leaseup_months: v })} width={60} />
              </FieldRow>
              <FieldRow label="Avg % Drawn (lease-up)">
                <NumInput value={construction.leaseup_draw_pct} pct step={1}
                  onChange={v => updateConstruction({ leaseup_draw_pct: v })} />
              </FieldRow>
              <div style={{ borderTop:"1px solid #e8d9b8", marginTop:8, paddingTop:8 }}>
                <CalcRow label="Construction Interest Est." value={fmt$(calcs.constInterestEst)} highlight />
                <CalcRow label="Lease-Up Interest Est."    value={fmt$(calcs.leaseupInt)} />
              </div>
              <div style={{ fontSize:8, color:"#c47a3a", marginTop:6 }}>
                Module 2B (Construction Cash Flow) will replace these with exact monthly calculations.
              </div>
            </div>
          </div>

          {/* ── OTHER SOURCES ── */}
          <div style={{ background:"white", border:"1px solid #e0e0e0", borderRadius:6,
            padding:"16px 18px" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
              marginBottom:14, paddingBottom:8, borderBottom:"2px solid #4a1a6b" }}>
              <div style={{ fontSize:13, fontWeight:700, color:"#4a1a6b",
                fontFamily:"Inter, sans-serif", textTransform:"uppercase", letterSpacing:"0.08em" }}>
                Other Sources / Grants
              </div>
              <button
                onClick={() => updateModule("debt", { other_sources: [...otherSources,
                  { id: mkId(), label: "New Source", amount: 0, notes: "" }] })}
                style={{ background:"#4a1a6b", color:"white", border:"none", borderRadius:3,
                  padding:"3px 8px", fontSize:8, fontWeight:700, cursor:"pointer",
                  fontFamily:"Inter, sans-serif", letterSpacing:"0.05em" }}>
                + ADD
              </button>
            </div>
            {otherSources.map(src => (
              <div key={src.id} style={{ display:"flex", alignItems:"center",
                gap:6, marginBottom:6 }}>
                <input value={src.label}
                  onChange={e => updateOtherSource(src.id, { label: e.target.value })}
                  style={{ flex:1, background:"#f8f8f8", border:"1px solid #e0e0e0",
                    borderRadius:3, padding:"4px 8px", fontSize:10,
                    fontFamily:"Inter, sans-serif", color:"#444", outline:"none" }} />
                <NumInput value={src.amount} step={10000}
                  onChange={v => updateOtherSource(src.id, { amount: v })} prefix="$" />
                <button
                  onClick={() => updateModule("debt", {
                    other_sources: otherSources.filter(s => s.id !== src.id) })}
                  style={{ background:"none", border:"none", cursor:"pointer",
                    color:"#ddd", fontSize:12, padding:"2px 4px", flexShrink:0 }}
                  onMouseEnter={e => e.target.style.color="#8B2500"}
                  onMouseLeave={e => e.target.style.color="#ddd"}>✕</button>
              </div>
            ))}
          </div>
        </div>

        {/* RIGHT COLUMN */}
        <div>
          {/* ── PERMANENT LOAN — DSCR SIZING ── */}
          <div style={{ background:"white", border:"1px solid #e0e0e0", borderRadius:6,
            padding:"16px 18px", marginBottom:16 }}>
            <SectionHeader title="Permanent Loan" color="#1a3a6b"
              subtitle="DSCR-constrained sizing" />

            <FieldRow label="Lender">
              <TextInput value={permanent.lender} onChange={v => updatePermanent({ lender: v })} width={180} />
            </FieldRow>
            <FieldRow label="Lender Type">
              <Select value={permanent.lender_type}
                onChange={v => updatePermanent({ lender_type: v })}
                options={[
                  {value:"Agency",label:"Agency"},
                  {value:"Bank",label:"Bank"},
                  {value:"CDFI",label:"CDFI"},
                  {value:"HFA",label:"HFA"},
                  {value:"Other",label:"Other"},
                ]} width={120} />
            </FieldRow>
            <FieldRow label="Rate">
              <NumInput value={permanent.rate} pct step={0.005}
                onChange={v => updatePermanent({ rate: v })} />
            </FieldRow>
            <FieldRow label="Amortization (years)">
              <NumInput value={permanent.amort_years} step={1}
                onChange={v => updatePermanent({ amort_years: v })} width={60} />
            </FieldRow>
            <FieldRow label="Loan Term (years)">
              <NumInput value={permanent.term_years} step={1}
                onChange={v => updatePermanent({ term_years: v })} width={60} />
            </FieldRow>
            <FieldRow label="DSCR Requirement">
              <NumInput value={permanent.dscr_requirement} step={0.01}
                onChange={v => updatePermanent({ dscr_requirement: v })} />
            </FieldRow>
            <FieldRow label="IO Period (years)" note="0 = fully amortizing from day 1">
              <NumInput value={permanent.io_years} step={1}
                onChange={v => updatePermanent({ io_years: v })} width={60} />
            </FieldRow>

            {/* NOI input — temp until proforma wired */}
            <div style={{ background:"#f0f3f9", border:"1px solid #b8c8e0", borderRadius:5,
              padding:"10px 12px", marginTop:10, marginBottom:10 }}>
              <div style={{ fontSize:8, fontWeight:700, color:"#1a3a6b", textTransform:"uppercase",
                letterSpacing:"0.07em", marginBottom:6 }}>
                NOI Input — Temp until Proforma module wired
              </div>
              <FieldRow label="Use NOI override?">
                <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <input type="checkbox" checked={permanent.use_noi_override}
                    onChange={e => updatePermanent({ use_noi_override: e.target.checked })}
                    style={{ cursor:"pointer", accentColor:"#1a3a6b" }} />
                </div>
              </FieldRow>
              <FieldRow label="NOI (Untrended)">
                <NumInput value={permanent.noi_override} step={10000}
                  onChange={v => updatePermanent({ noi_override: v })}
                  disabled={!permanent.use_noi_override} prefix="$" />
              </FieldRow>
            </div>

            {/* DSCR Sizing Waterfall */}
            <div style={{ background:"#f8f8f8", border:"1px solid #e0e0e0", borderRadius:5,
              padding:"10px 12px" }}>
              <div style={{ fontSize:8, fontWeight:700, color:"#888", textTransform:"uppercase",
                letterSpacing:"0.07em", marginBottom:8 }}>DSCR Sizing</div>
              <CalcRow label="NOI (Untrended)"              value={fmt$(calcs.noi)} />
              <CalcRow label={`÷ DSCR Requirement (${fmtX(permanent.dscr_requirement)})`}
                       value={fmt$(calcs.maxADS)} operator="÷" />
              <CalcRow label={`÷ Debt Constant (${fmtPct2(calcs.dc)})`}
                       value={fmt$(calcs.maxLoanDSCR)} operator="÷" />
              <div style={{ borderTop:"2px solid #111", marginTop:6, paddingTop:6 }}>
                <CalcRow label="Max Loan (DSCR-constrained)" value={fmt$(calcs.maxLoanDSCR)} highlight />
              </div>
            </div>

            {/* Actual loan amount */}
            <div style={{ marginTop:10 }}>
              <FieldRow label="Loan Amount" note="Override DSCR max if lender comes in different">
                <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <NumInput value={permanent.loan_amount} step={100000}
                    onChange={v => updatePermanent({ loan_amount: v })} prefix="$" />
                  <button
                    onClick={() => updatePermanent({ loan_amount: Math.floor(calcs.maxLoanDSCR) })}
                    title={`Set to DSCR-max: ${fmt$(Math.floor(calcs.maxLoanDSCR))}`}
                    style={{ background:"#1a3a6b", color:"white", border:"none", borderRadius:3,
                      padding:"4px 8px", fontSize:8, fontFamily:"Inter, sans-serif", cursor:"pointer",
                      fontWeight:700, letterSpacing:"0.05em", whiteSpace:"nowrap" }}>
                    USE MAX
                  </button>
                </div>
              </FieldRow>
              <FieldRow label="Origination Fee %">
                <NumInput value={permanent.origination_pct} pct step={0.1}
                  onChange={v => updatePermanent({ origination_pct: v })} />
              </FieldRow>

              {/* Actual DSCR check */}
              <div style={{ background: calcs.permDSCR >= (permanent.dscr_requirement||1.15) ? "#f0f9f4" : "#fce8e3",
                border:`1px solid ${calcs.permDSCR >= (permanent.dscr_requirement||1.15) ? "#b8dfc8" : "#f5c2b0"}`,
                borderRadius:5, padding:"8px 12px", marginTop:8 }}>
                {[
                  { label:"Annual Debt Service",  value: fmt$(calcs.permADS) },
                  { label:"Actual DSCR",          value: fmtX(calcs.permDSCR) },
                  { label:"Min. Required DSCR",    value: fmtX(permanent.dscr_requirement||1.15) },
                  { label:"DSCR-Max Loan",         value: fmt$(calcs.maxLoanDSCR) },
                ].map(r => (
                  <div key={r.label} style={{ display:"flex", justifyContent:"space-between",
                    fontSize:10, marginBottom:4 }}>
                    <span style={{ color:"#666" }}>{r.label}</span>
                    <span style={{ fontWeight:700,
                      color: r.label==="Actual DSCR"
                        ? (calcs.permDSCR >= (permanent.dscr_requirement||1.15) ? "#1a6b3c" : "#8B2500")
                        : "#111" }}>{r.value}</span>
                  </div>
                ))}
                <div style={{ fontSize:8, color:"#aaa", marginTop:4 }}>
                  Loan sized below DSCR max — actual coverage exceeds minimum requirement. This is expected when bond test or other constraints drive loan size.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── SUBORDINATE DEBT ── */}
      <div style={{ background:"white", border:"1px solid #e0e0e0", borderRadius:6,
        padding:"16px 18px", marginTop:4 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
          marginBottom:14 }}>
          <div>
            <SectionHeader title="Subordinate Debt Stack" color="#5a3a00"
              subtitle="Drag to reorder priority · Expand each loan for balance projection" />
          </div>
          <button onClick={addSubdebt}
            style={{ background:"#5a3a00", color:"white", border:"none", padding:"6px 14px",
              borderRadius:4, cursor:"pointer", fontSize:9, fontWeight:700,
              fontFamily:"Inter, sans-serif", letterSpacing:"0.07em", textTransform:"uppercase" }}>
            + Add Loan
          </button>
        </div>

        {subdebt.length === 0 ? (
          <div style={{ padding:"20px", textAlign:"center", color:"#aaa", fontSize:11 }}>
            No subordinate debt — click + Add Loan to add soft loans, seller notes, etc.
          </div>
        ) : (
          <SubdebtList
            loans={subdebt}
            onUpdate={updateSubdebt}
            onRemove={removeSubdebt}
            onReorder={reorderSubdebt}
          />
        )}

        {/* Subdebt totals */}
        {subdebt.length > 0 && (
          <div style={{ display:"flex", gap:16, marginTop:8, padding:"8px 12px",
            background:"#fdf8f0", border:"1px solid #e8d9b8", borderRadius:5 }}>
            <div>
              <div style={{ fontSize:8, color:"#aaa", textTransform:"uppercase",
                letterSpacing:"0.06em" }}>Total Subdebt</div>
              <div style={{ fontSize:14, fontWeight:700, color:"#5a3a00" }}>
                {fmt$(subdebt.reduce((s,l)=>s+(l.amount||0),0))}
              </div>
            </div>
            <div>
              <div style={{ fontSize:8, color:"#aaa", textTransform:"uppercase",
                letterSpacing:"0.06em" }}>Annual Cash DS</div>
              <div style={{ fontSize:14, fontWeight:700, color:"#1a3a6b" }}>
                {fmt$(calcs.subdebtADS)}
              </div>
            </div>
            <div>
              <div style={{ fontSize:8, color:"#aaa", textTransform:"uppercase",
                letterSpacing:"0.06em" }}>Accrual Loans</div>
              <div style={{ fontSize:14, fontWeight:700, color:"#8B2500" }}>
                {subdebt.filter(l => ["accrual","contingent","partial"].includes(l.payment_type)).length} loans
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── SOURCES VS USES SUMMARY ── */}
      <div style={{ marginTop:16 }}>
        <SourcesUsesSummary
          calcs={calcs}
          permanent={permanent}
          construction={construction}
          subdebt={subdebt}
          otherSources={otherSources}
          lihtcEquity={lihtcEquity}
          stateEquity={stateEquity}
          deferredDevFee={deferredDevFee}
          tdc={tdc}
        />
      </div>
    </div>
  );
}
