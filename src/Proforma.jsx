/**
 * Proforma.jsx — Module 6: 15-Year Operating Proforma (V2)
 *
 * Transposed table layout: Years across top, categories on left.
 * Matches standard property income statement format.
 * Revenue (from Unit Mix) → OpEx → NOI → Debt Service → Cash Flow → Waterfall
 * Wires Year 1 NOI back to Debt module for DSCR sizing.
 * Tracks DDF payoff + subordinate loan payoff from surplus cash flow.
 */
import { useState, useMemo, useEffect, useRef } from "react";
import { useLihtc } from "./context/LihtcContext.jsx";
import { computeBudgetCalcs } from "./lihtcCalcs.js";

/* ── formatters ──────────────────────────────────────────────── */
const fmt$ = v => v == null ? "—" : "$" + Math.round(Math.abs(v)).toLocaleString();
const fmtNeg$ = v => {
  if (v == null) return "—";
  const abs = Math.round(Math.abs(v));
  if (abs === 0) return "—";
  return v < 0 ? `($${abs.toLocaleString()})` : `$${abs.toLocaleString()}`;
};
const fmtPct = v => v == null ? "—" : (v * 100).toFixed(1) + "%";
const fmtX = v => v == null ? "—" : v.toFixed(2) + "x";

/* ── defaults ────────────────────────────────────────────────── */
const DEFAULT_OPEX_LINES = [
  { id: "payroll",       label: "Payroll",                       amount: 394000,  escalates: true },
  { id: "marketing",     label: "Marketing & Advertising",       amount: 43860,   escalates: true },
  { id: "maintenance",   label: "Repair/Maint. & Cleaning",      amount: 146274,  escalates: true },
  { id: "admin",         label: "Administrative",                amount: 33080,   escalates: true },
  { id: "management",    label: "Management Fees",               amount: 0,       escalates: false, is_pct_egi: true, pct: 0.055 },
  { id: "utilities",     label: "Utilities",                     amount: 337604,  escalates: true },
  { id: "re_taxes",      label: "Real Estate & Other Taxes",     amount: 7680,    escalates: true },
  { id: "insurance",     label: "Insurance",                     amount: 74476,   escalates: true },
];

const DEFAULT_OTHER_INCOME = [
  { id: "other_inc_1", label: "Other Income", annual: 245700, escalates: true },
  { id: "op_support",  label: "Operating Support Income", annual: 0, escalates: false },
];

const DEFAULT_CUSTOM_OPEX = [];
const DEFAULT_CUSTOM_OTHER_INCOME = [];

const DEFAULT_PROFORMA = {
  revenue_escalation:         0.02,
  expense_escalation:         0.03,
  vacancy_rate:               0.06,
  replacement_reserve_per_unit: 350,
  reserve_escalation:         0.03,
  ddf_payoff_pct:             1.0,
  opex_lines:                 DEFAULT_OPEX_LINES,
  other_income:               DEFAULT_OTHER_INCOME,
  custom_opex:                DEFAULT_CUSTOM_OPEX,
  custom_other_income:        DEFAULT_CUSTOM_OTHER_INCOME,
  // Adjustments
  lp_partnership_fee:         17500,
  gp_management_fee:          17500,
  adjustment_escalation:      0.03,
  // Sub loan waterfall
  sub_loan_rules:             [],  // [{ loan_id, label, pct_of_cf }] — filled from debt subdebt
};

/* ── annual debt service (mirrors Debt.jsx logic) ────────────── */
function debtConstant(rate, amortYears) {
  if (!rate || rate <= 0 || !amortYears || amortYears <= 0) return 0;
  const r = rate / 12;
  const n = amortYears * 12;
  const monthlyPmt = (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
  return monthlyPmt * 12;
}

function annualDS(amount, rate, amortYears) {
  if (!amount || amount <= 0) return 0;
  return amount * debtConstant(rate, amortYears);
}

/* ── compute 15-year proforma rows ───────────────────────────── */
function computeProforma(inputs, grossRent, totalUnits, permLoan, permRate, permAmort, subdebt, deferredDevFee, subLoanRules) {
  const p = inputs;
  const years = [];
  let ddfBalance = deferredDevFee || 0;
  let ddfPaidYear = null;

  // Track sub loan balances for waterfall payoff
  const subLoanBalances = {};
  (subLoanRules || []).forEach(rule => {
    const loan = (subdebt || []).find(l => l.id === rule.loan_id);
    subLoanBalances[rule.loan_id] = loan?.amount || 0;
  });

  // Senior debt service (fixed for all years)
  const seniorADS = annualDS(permLoan, permRate, permAmort);

  const opexLines = p.opex_lines || DEFAULT_OPEX_LINES;
  const customOpex = p.custom_opex || [];
  const otherIncomeLines = p.other_income || DEFAULT_OTHER_INCOME;
  const customOtherIncome = p.custom_other_income || [];

  for (let yr = 1; yr <= 15; yr++) {
    const escalR = Math.pow(1 + (p.revenue_escalation || 0), yr - 1);
    const escalE = Math.pow(1 + (p.expense_escalation || 0), yr - 1);
    const escalRes = Math.pow(1 + (p.reserve_escalation || 0.03), yr - 1);
    const escalAdj = Math.pow(1 + (p.adjustment_escalation || 0.03), yr - 1);

    // Revenue
    const residentialRev = (grossRent || 0) * escalR;
    const commercialRev = 0;
    const totalRev = residentialRev + commercialRev;

    // Other income
    const otherIncomeDetail = {};
    let totalOtherIncome = 0;
    [...otherIncomeLines, ...customOtherIncome].forEach(item => {
      const amt = (item.annual || 0) * (item.escalates !== false ? escalR : 1);
      otherIncomeDetail[item.id] = amt;
      totalOtherIncome += amt;
    });

    const adjustedIncome = totalRev + totalOtherIncome;
    const vacancy = adjustedIncome * (p.vacancy_rate || 0.05);
    const egi = adjustedIncome - vacancy;

    // Operating expenses
    const opexDetail = {};
    let totalOpex = 0;

    [...opexLines, ...customOpex].forEach(line => {
      let amt;
      if (line.is_pct_egi) {
        amt = egi * (line.pct || 0);
      } else {
        amt = (line.amount || 0) * (line.escalates !== false ? escalE : 1);
      }
      opexDetail[line.id] = amt;
      totalOpex += amt;
    });

    // Replacement reserves
    const repReserve = totalUnits * (p.replacement_reserve_per_unit || 350) * escalRes;
    totalOpex += repReserve;

    // NOI
    const noi = egi - totalOpex;

    // Total debt service (senior only for hard pay)
    const totalADS = seniorADS;

    // DSCR
    const seniorDSCR = seniorADS > 0 ? noi / seniorADS : 0;

    // Cash flow
    const cashFlow = noi - totalADS;

    // ── DDF payoff ──
    const ddfPayment = cashFlow > 0
      ? Math.min(cashFlow * (p.ddf_payoff_pct ?? 1.0), ddfBalance)
      : 0;
    ddfBalance = Math.max(0, ddfBalance - ddfPayment);
    if (ddfBalance <= 0 && ddfPaidYear === null && deferredDevFee > 0) {
      ddfPaidYear = yr;
    }

    let residualAfterDDF = cashFlow - ddfPayment;

    // ── Sub loan waterfall (after DDF is paid off) ──
    const subLoanPayments = {};
    if (ddfBalance <= 0 && residualAfterDDF > 0 && subLoanRules?.length > 0) {
      subLoanRules.forEach(rule => {
        const balance = subLoanBalances[rule.loan_id] || 0;
        if (balance <= 0) {
          subLoanPayments[rule.loan_id] = 0;
          return;
        }
        const pct = rule.pct_of_cf || 0;
        const payment = Math.min(residualAfterDDF * pct, balance);
        subLoanPayments[rule.loan_id] = payment;
        subLoanBalances[rule.loan_id] = Math.max(0, balance - payment);
        residualAfterDDF -= payment;
      });
    }

    // Adjustments
    const lpFee = (p.lp_partnership_fee || 0) * escalAdj;
    const gpFee = (p.gp_management_fee || 0) * escalAdj;
    const totalAdjustments = -(lpFee + gpFee);
    const adjustedCF = cashFlow + totalAdjustments;

    years.push({
      year: yr,
      residentialRev, commercialRev, totalRev,
      otherIncomeDetail, totalOtherIncome,
      adjustedIncome, vacancy, egi,
      opexDetail, repReserve, totalOpex,
      noi,
      seniorADS, totalADS, seniorDSCR,
      cashFlow,
      ddfPayment, ddfBalance,
      subLoanPayments,
      lpFee, gpFee, totalAdjustments, adjustedCF,
      residualCF: residualAfterDDF,
    });
  }

  return { years, ddfPaidYear, seniorADS };
}

/* ── tiny inline input ──────────────────────────────────────── */
function TinyInput({ value, onChange, pct, prefix, suffix, width, step, placeholder }) {
  const display = pct ? (value * 100) : value;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
      {prefix && <span style={{ fontSize: 10, color: "#888" }}>{prefix}</span>}
      <input
        type="number"
        value={display || ""}
        step={step || (pct ? 0.1 : 1000)}
        placeholder={placeholder}
        onChange={e => {
          const v = Number(e.target.value);
          onChange(pct ? v / 100 : v);
        }}
        style={{
          width: width || 80, padding: "3px 6px", border: "1px solid #ddd",
          borderRadius: 3, fontSize: 11, outline: "none", textAlign: "right",
          fontFamily: "Inter, sans-serif",
        }}
      />
      {suffix && <span style={{ fontSize: 10, color: "#888" }}>{suffix}</span>}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ══════════════════════════════════════════════════════════════ */

export default function ProformaPanel() {
  const { moduleStates, updateModule } = useLihtc();

  // ── Pull inputs ──
  const saved = moduleStates.proforma || {};
  const pf = { ...DEFAULT_PROFORMA, ...saved };
  const opexLines = (pf.opex_lines || DEFAULT_OPEX_LINES).map((l, i) =>
    l.id ? l : { ...l, id: `opex_${i}_${l.label?.replace(/\s/g, '_') || i}` }
  );
  const customOpex = (pf.custom_opex || []).map((l, i) =>
    l.id ? l : { ...l, id: `custom_opex_${i}` }
  );
  const otherIncomeLines = (pf.other_income || DEFAULT_OTHER_INCOME).map((l, i) =>
    l.id ? l : { ...l, id: `oi_${i}_${l.label?.replace(/\s/g, '_') || i}` }
  );
  const customOtherIncome = (pf.custom_other_income || []).map((l, i) =>
    l.id ? l : { ...l, id: `custom_oi_${i}` }
  );
  const subLoanRules = pf.sub_loan_rules || [];

  const update = patch => updateModule("proforma", { ...pf, ...patch });

  const updateOpexLine = (id, patch) => {
    const isCustom = customOpex.some(l => l.id === id);
    if (isCustom) {
      update({ custom_opex: customOpex.map(l => l.id === id ? { ...l, ...patch } : l) });
    } else {
      update({ opex_lines: opexLines.map(l => l.id === id ? { ...l, ...patch } : l) });
    }
  };

  const addCustomOpex = () => {
    const id = `custom_opex_${Date.now()}`;
    update({ custom_opex: [...customOpex, { id, label: "New Expense", amount: 0, escalates: true }] });
  };

  const removeCustomOpex = (id) => {
    update({ custom_opex: customOpex.filter(l => l.id !== id) });
  };

  const updateOtherIncomeLine = (id, patch) => {
    const isCustom = customOtherIncome.some(l => l.id === id);
    if (isCustom) {
      update({ custom_other_income: customOtherIncome.map(l => l.id === id ? { ...l, ...patch } : l) });
    } else {
      update({ other_income: otherIncomeLines.map(l => l.id === id ? { ...l, ...patch } : l) });
    }
  };

  const addCustomOtherIncome = () => {
    const id = `custom_oi_${Date.now()}`;
    update({ custom_other_income: [...customOtherIncome, { id, label: "New Income", annual: 0, escalates: true }] });
  };

  const removeCustomOtherIncome = (id) => {
    update({ custom_other_income: customOtherIncome.filter(l => l.id !== id) });
  };

  // ── Unit Mix → Gross Rent ──
  const unitMix = moduleStates.unit_mix;
  const rows = unitMix?.rows ?? [];
  const totalUnits = rows.reduce((s, r) => s + (r.count || 0), 0) || 175;
  const grossRent = unitMix?.computed_annual_revenue || 0;

  // ── Debt module → ADS ──
  const debt = moduleStates.debt || {};
  const permanent = debt.permanent || {};
  const permLoan = permanent.loan_amount || 0;
  const permRate = permanent.rate || 0.0585;
  const permAmort = permanent.amortization_years || 40;
  const rawSubdebt = debt.subdebt || [];

  // ── Budget → DDF ──
  const budget = moduleStates.budget;
  const bc = computeBudgetCalcs(budget, totalUnits);
  const deferredDevFee = bc.deferredDevFee || 0;

  // ── Compute 15-year proforma ──
  const result = useMemo(
    () => computeProforma(pf, grossRent, totalUnits, permLoan, permRate, permAmort, rawSubdebt, deferredDevFee, subLoanRules),
    [pf, grossRent, totalUnits, permLoan, permRate, permAmort, rawSubdebt, deferredDevFee, subLoanRules]
  );

  const yr1 = result.years[0] || {};

  // ── Wire Year 1 NOI back to Debt module ──
  const prevNOI = useRef(0);
  useEffect(() => {
    if (yr1.noi > 0 && Math.abs(yr1.noi - prevNOI.current) > 100) {
      prevNOI.current = yr1.noi;
      updateModule("debt", {
        permanent: { ...permanent, noi_override: Math.round(yr1.noi), use_noi_override: true },
      });
    }
  }, [yr1.noi]);

  // ── Table display state ──
  const [showAllYears, setShowAllYears] = useState(false);
  const [showInputs, setShowInputs] = useState(true);
  const displayYears = showAllYears ? result.years : result.years.filter(y => y.year <= 5 || y.year === 10 || y.year === 15);

  // ── Styles ──
  const hdrCell = { padding: "6px 10px", textAlign: "right", fontSize: 9, fontWeight: 700, color: "#888", letterSpacing: "0.04em", whiteSpace: "nowrap", borderBottom: "2px solid #333" };
  const labelCell = { padding: "4px 10px 4px 16px", textAlign: "left", fontSize: 10, color: "#333", whiteSpace: "nowrap" };
  const labelCellBold = { ...labelCell, fontWeight: 700, color: "#111", paddingLeft: 10 };
  const labelCellSection = { ...labelCell, fontWeight: 700, fontSize: 9, color: "#888", textTransform: "uppercase", letterSpacing: "0.06em", paddingLeft: 10, paddingTop: 10 };
  const numCell = { padding: "4px 10px", textAlign: "right", fontSize: 10, fontFamily: "Inter, sans-serif", color: "#333", whiteSpace: "nowrap" };
  const numCellBold = { ...numCell, fontWeight: 700, color: "#111" };
  const numCellAccent = (color) => ({ ...numCellBold, color });
  const separatorRow = { height: 6 };
  const sectionBorderTop = { borderTop: "1px solid #ddd" };
  const heavyBorderTop = { borderTop: "2px solid #333" };

  const allOpexLines = [...opexLines, ...customOpex];
  const allOtherIncome = [...otherIncomeLines, ...customOtherIncome];

  const cardStyle = { background: "white", border: "1px solid #e0e0e0", borderRadius: 6, overflow: "hidden" };

  return (
    <div style={{ fontFamily: "Inter, sans-serif" }}>

      {/* ── HEADER ── */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 20, fontWeight: 400, color: "#111", margin: 0 }}>
            Operating Proforma
          </h2>
          <span style={{ fontSize: 9, color: "#aaa", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            MODULE 6 · 15-YEAR PROJECTION
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{
            padding: "4px 10px", borderRadius: 4, fontSize: 9, fontWeight: 700,
            background: yr1.seniorDSCR >= 1.15 ? "#f0f9f4" : "#fce8e3",
            color: yr1.seniorDSCR >= 1.15 ? "#1a6b3c" : "#8B2500",
            border: `1px solid ${yr1.seniorDSCR >= 1.15 ? "#b8dfc8" : "#f5c2b0"}`,
          }}>
            Yr 1 DSCR: {fmtX(yr1.seniorDSCR)}
          </div>
          {result.ddfPaidYear && (
            <div style={{
              padding: "4px 10px", borderRadius: 4, fontSize: 9, fontWeight: 700,
              background: "#fdf8ef", color: "#5a3a00", border: "1px solid #e8d5a8",
            }}>
              DDF Paid: Year {result.ddfPaidYear}
            </div>
          )}
        </div>
      </div>

      {/* ── METRICS BAR ── */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        {[
          { label: "Gross Pot. Rent",  value: fmt$(yr1.residentialRev), sub: `${totalUnits} units`, accent: "#1a3a6b", bg: "#f0f3f9", border: "#b8c8e0" },
          { label: "Yr 1 EGI",        value: fmt$(yr1.egi), sub: `${fmtPct(pf.vacancy_rate)} vacancy`, accent: "#1a6b3c", bg: "#f0f9f4", border: "#b8dfc8" },
          { label: "Yr 1 NOI",        value: fmt$(yr1.noi), sub: `${fmtPct(yr1.noi / yr1.egi)} margin`, accent: "#1a6b3c", bg: "#f0f9f4", border: "#b8dfc8" },
          { label: "Cash Flow",       value: yr1.cashFlow < 0 ? `(${fmt$(yr1.cashFlow)})` : fmt$(yr1.cashFlow), sub: "After debt service", accent: yr1.cashFlow >= 0 ? "#5a3a00" : "#8B2500", bg: yr1.cashFlow >= 0 ? "#fdf8ef" : "#fce8e3", border: yr1.cashFlow >= 0 ? "#e8d5a8" : "#f5c2b0" },
          { label: "Sr. Debt Service", value: fmt$(result.seniorADS), sub: `${fmtX(yr1.seniorDSCR)} DSCR`, accent: "#1a3a6b", bg: "#f0f3f9", border: "#b8c8e0" },
        ].map(m => (
          <div key={m.label} style={{ background: m.bg, border: `1px solid ${m.border}`, borderRadius: 6, padding: "8px 12px", flex: "1 1 140px", minWidth: 140 }}>
            <div style={{ fontSize: 8, color: m.accent, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>{m.label}</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: m.accent }}>{m.value}</div>
            {m.sub && <div style={{ fontSize: 8, color: "#888", marginTop: 2 }}>{m.sub}</div>}
          </div>
        ))}
      </div>

      {/* ── TOGGLE INPUTS ── */}
      <div style={{ marginBottom: 12, display: "flex", gap: 8 }}>
        <button onClick={() => setShowInputs(!showInputs)} style={{
          background: "none", border: "1px solid #ddd", borderRadius: 3,
          padding: "4px 10px", fontSize: 9, color: "#888", cursor: "pointer",
        }}>
          {showInputs ? "Hide Inputs" : "Show Inputs"}
        </button>
        <button onClick={() => setShowAllYears(!showAllYears)} style={{
          background: "none", border: "1px solid #ddd", borderRadius: 3,
          padding: "4px 10px", fontSize: 9, color: "#888", cursor: "pointer",
        }}>
          {showAllYears ? "Summary Years" : "All 15 Years"}
        </button>
      </div>

      {/* ── INPUTS PANEL (collapsible) ── */}
      {showInputs && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 16 }}>

          {/* Assumptions */}
          <div style={{ ...cardStyle, padding: "12px 14px" }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: "#1a3a6b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
              Assumptions
            </div>
            {[
              { label: "Vacancy Rate", val: pf.vacancy_rate, key: "vacancy_rate", pct: true },
              { label: "Revenue Escalation", val: pf.revenue_escalation, key: "revenue_escalation", pct: true, suffix: "/ yr" },
              { label: "Expense Escalation", val: pf.expense_escalation, key: "expense_escalation", pct: true, suffix: "/ yr" },
              { label: "Reserve Escalation", val: pf.reserve_escalation, key: "reserve_escalation", pct: true, suffix: "/ yr" },
              { label: "Repl. Reserve / Unit", val: pf.replacement_reserve_per_unit, key: "replacement_reserve_per_unit", prefix: "$", step: 25 },
              { label: "DDF Payoff Rate", val: pf.ddf_payoff_pct, key: "ddf_payoff_pct", pct: true, note: "% of CF to DDF" },
            ].map(f => (
              <div key={f.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                <div>
                  <div style={{ fontSize: 10, color: "#444" }}>{f.label}</div>
                  {f.note && <div style={{ fontSize: 8, color: "#bbb" }}>{f.note}</div>}
                </div>
                <TinyInput value={f.val} onChange={v => update({ [f.key]: v })} pct={f.pct} prefix={f.prefix} suffix={f.pct ? (f.suffix ? `% ${f.suffix}` : "%") : f.suffix} width={60} step={f.step} />
              </div>
            ))}
          </div>

          {/* Year 1 Operating Expenses */}
          <div style={{ ...cardStyle, padding: "12px 14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: "#8B2500", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                Year 1 Operating Expenses
              </span>
              <button onClick={addCustomOpex} style={{
                background: "none", border: "1px solid #ddd", borderRadius: 3,
                padding: "2px 6px", fontSize: 8, color: "#888", cursor: "pointer",
              }}>+ Add Line</button>
            </div>
            {opexLines.map(line => (
              <div key={line.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <span style={{ fontSize: 10, color: "#444" }}>{line.label}</span>
                {line.is_pct_egi ? (
                  <TinyInput value={line.pct} onChange={v => updateOpexLine(line.id, { pct: v })} pct suffix="% EGI" width={55} />
                ) : (
                  <TinyInput value={line.amount} onChange={v => updateOpexLine(line.id, { amount: v })} prefix="$" width={80} />
                )}
              </div>
            ))}
            {customOpex.map(line => (
              <div key={line.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4, gap: 4 }}>
                <input
                  value={line.label}
                  onChange={e => updateOpexLine(line.id, { label: e.target.value })}
                  style={{ fontSize: 10, border: "1px solid #eee", borderRadius: 3, padding: "2px 4px", width: 100, outline: "none" }}
                />
                <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                  <TinyInput value={line.amount} onChange={v => updateOpexLine(line.id, { amount: v })} prefix="$" width={70} />
                  <button onClick={() => removeCustomOpex(line.id)} style={{
                    background: "none", border: "none", color: "#ccc", cursor: "pointer", fontSize: 12, padding: "0 2px",
                  }}>×</button>
                </div>
              </div>
            ))}
            <div style={{ borderTop: "2px solid #333", marginTop: 8, paddingTop: 6, display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontSize: 10, fontWeight: 700 }}>Total Yr 1 OpEx</span>
              <span style={{ fontSize: 10, fontWeight: 700 }}>{fmt$(yr1.totalOpex)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3 }}>
              <span style={{ fontSize: 8, color: "#888" }}>Per unit / year</span>
              <span style={{ fontSize: 8, color: "#888" }}>{fmt$(yr1.totalOpex / totalUnits)}</span>
            </div>
          </div>

          {/* Other Income + Adjustments */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ ...cardStyle, padding: "12px 14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <span style={{ fontSize: 9, fontWeight: 700, color: "#1a6b3c", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  Other Income (Annual)
                </span>
                <button onClick={addCustomOtherIncome} style={{
                  background: "none", border: "1px solid #ddd", borderRadius: 3,
                  padding: "2px 6px", fontSize: 8, color: "#888", cursor: "pointer",
                }}>+ Add Line</button>
              </div>
              {otherIncomeLines.map(item => (
                <div key={item.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <span style={{ fontSize: 10, color: "#444" }}>{item.label}</span>
                  <TinyInput value={item.annual} onChange={v => updateOtherIncomeLine(item.id, { annual: v })} prefix="$" width={80} />
                </div>
              ))}
              {customOtherIncome.map(item => (
                <div key={item.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4, gap: 4 }}>
                  <input
                    value={item.label}
                    onChange={e => updateOtherIncomeLine(item.id, { label: e.target.value })}
                    style={{ fontSize: 10, border: "1px solid #eee", borderRadius: 3, padding: "2px 4px", width: 100, outline: "none" }}
                  />
                  <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                    <TinyInput value={item.annual} onChange={v => updateOtherIncomeLine(item.id, { annual: v })} prefix="$" width={70} />
                    <button onClick={() => removeCustomOtherIncome(item.id)} style={{
                      background: "none", border: "none", color: "#ccc", cursor: "pointer", fontSize: 12, padding: "0 2px",
                    }}>×</button>
                  </div>
                </div>
              ))}
            </div>

            {/* Adjustments */}
            <div style={{ ...cardStyle, padding: "12px 14px" }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: "#555", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
                Adjustments
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <span style={{ fontSize: 10, color: "#444" }}>LP Partnership Fee</span>
                <TinyInput value={pf.lp_partnership_fee} onChange={v => update({ lp_partnership_fee: v })} prefix="$" width={80} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <span style={{ fontSize: 10, color: "#444" }}>GP Management Fee</span>
                <TinyInput value={pf.gp_management_fee} onChange={v => update({ gp_management_fee: v })} prefix="$" width={80} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <span style={{ fontSize: 10, color: "#444" }}>Adj. Escalation</span>
                <TinyInput value={pf.adjustment_escalation} onChange={v => update({ adjustment_escalation: v })} pct suffix="% / yr" width={55} />
              </div>
            </div>

            {/* Sub Loan Waterfall Rules */}
            {rawSubdebt.filter(l => l.loan_type !== "deferred_fee").length > 0 && (
              <div style={{ ...cardStyle, padding: "12px 14px" }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: "#5a3a00", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
                  Sub Loan Payoff Rules
                </div>
                <div style={{ fontSize: 8, color: "#999", marginBottom: 6 }}>
                  % of remaining CF after DDF paid off
                </div>
                {rawSubdebt.filter(l => l.loan_type !== "deferred_fee").map(loan => {
                  const rule = subLoanRules.find(r => r.loan_id === loan.id);
                  const pctVal = rule?.pct_of_cf || 0;
                  return (
                    <div key={loan.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                      <span style={{ fontSize: 10, color: "#444" }}>{loan.label}</span>
                      <TinyInput
                        value={pctVal}
                        onChange={v => {
                          const updated = subLoanRules.filter(r => r.loan_id !== loan.id);
                          if (v > 0) updated.push({ loan_id: loan.id, label: loan.label, pct_of_cf: v });
                          update({ sub_loan_rules: updated });
                        }}
                        pct suffix="%" width={50}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════
         TRANSPOSED PROFORMA TABLE
         Years across top, categories on left
         ══════════════════════════════════════════════════════════════ */}
      <div style={{ ...cardStyle, padding: 0 }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", fontSize: 10, width: "100%", minWidth: 800 }}>
            <thead>
              <tr>
                <th style={{ ...hdrCell, textAlign: "left", minWidth: 200, position: "sticky", left: 0, background: "white", zIndex: 1 }}>
                  OPERATING PROFORMA
                </th>
                {displayYears.map(y => (
                  <th key={y.year} style={hdrCell}>EOY {y.year}</th>
                ))}
              </tr>
            </thead>
            <tbody>

              {/* ── INCOME SECTION ── */}
              <tr>
                <td style={labelCellSection} colSpan={displayYears.length + 1}>Income</td>
              </tr>
              <ProformaRow label="Residential Revenue" years={displayYears} getter={y => y.residentialRev} />
              {/* Commercial only if non-zero */}
              {displayYears.some(y => y.commercialRev > 0) && (
                <ProformaRow label="Commercial Revenue" years={displayYears} getter={y => y.commercialRev} />
              )}
              <ProformaRow label="Total Revenue" years={displayYears} getter={y => y.totalRev} bold />

              {/* Other income lines */}
              {allOtherIncome.map(item => (
                <ProformaRow key={item.id} label={item.label} years={displayYears} getter={y => y.otherIncomeDetail[item.id] || 0} />
              ))}

              <ProformaRow label="Adjusted Income" years={displayYears} getter={y => y.adjustedIncome} bold border />
              <ProformaRow label={`Vacancy (${fmtPct(pf.vacancy_rate)})`} years={displayYears} getter={y => -y.vacancy} deduct />
              <ProformaRow label="Effective Gross Income" years={displayYears} getter={y => y.egi} bold border />

              {/* ── SEPARATOR ── */}
              <tr><td style={separatorRow} colSpan={displayYears.length + 1} /></tr>

              {/* ── OPERATING EXPENSES ── */}
              <tr>
                <td style={labelCellSection} colSpan={displayYears.length + 1}>Operating Expenses</td>
              </tr>
              {allOpexLines.map(line => (
                <ProformaRow key={line.id} label={line.label} years={displayYears} getter={y => -(y.opexDetail[line.id] || 0)} deduct />
              ))}
              <ProformaRow label="Replacement Reserves" years={displayYears} getter={y => -y.repReserve} deduct />
              <ProformaRow label="Total Operating Expenses" years={displayYears} getter={y => -y.totalOpex} bold border deduct />

              {/* ── SEPARATOR ── */}
              <tr><td style={separatorRow} colSpan={displayYears.length + 1} /></tr>

              {/* ── NOI ── */}
              <ProformaRow label="Net Operating Income" years={displayYears} getter={y => y.noi} bold heavy accent="#1a6b3c" />

              {/* ── SEPARATOR ── */}
              <tr><td style={separatorRow} colSpan={displayYears.length + 1} /></tr>

              {/* ── DEBT SERVICE ── */}
              <ProformaRow label="ADS (Senior)" years={displayYears} getter={y => -y.seniorADS} deduct />
              <ProformaRow label="Total Hard Pay Debt Service" years={displayYears} getter={y => -y.totalADS} bold border deduct />

              {/* ── DSCR ── */}
              <tr>
                <td style={{ ...labelCell, fontWeight: 600, color: "#1a3a6b" }}>DSCR</td>
                {displayYears.map(y => (
                  <td key={y.year} style={{
                    ...numCell, fontWeight: 700,
                    color: y.seniorDSCR >= 1.15 ? "#1a6b3c" : "#8B2500",
                  }}>
                    {fmtX(y.seniorDSCR)}
                  </td>
                ))}
              </tr>

              {/* ── SEPARATOR ── */}
              <tr><td style={separatorRow} colSpan={displayYears.length + 1} /></tr>

              {/* ── CASH FLOW ── */}
              <ProformaRow label="Cash Flow" years={displayYears} getter={y => y.cashFlow} bold heavy accent="#5a3a00" signed />

              {/* ── SEPARATOR ── */}
              <tr><td style={separatorRow} colSpan={displayYears.length + 1} /></tr>

              {/* ── ADJUSTMENTS ── */}
              <tr>
                <td style={labelCellSection} colSpan={displayYears.length + 1}>Adjustments</td>
              </tr>
              <ProformaRow label="LP Partnership Mgt Fee" years={displayYears} getter={y => -y.lpFee} deduct />
              <ProformaRow label="GP Management Fee" years={displayYears} getter={y => -y.gpFee} deduct />
              <ProformaRow label="Total Adjustments" years={displayYears} getter={y => y.totalAdjustments} bold border deduct />

              {/* ── SEPARATOR ── */}
              <tr><td style={separatorRow} colSpan={displayYears.length + 1} /></tr>

              {/* ── ADJUSTED CF ── */}
              <ProformaRow label="Adjusted Cash Flow" years={displayYears} getter={y => y.adjustedCF} bold heavy accent="#5a3a00" signed />

              {/* ── SEPARATOR ── */}
              <tr><td style={separatorRow} colSpan={displayYears.length + 1} /></tr>

              {/* ── DDF PAYOFF ── */}
              {deferredDevFee > 0 && (
                <>
                  <tr>
                    <td style={labelCellSection} colSpan={displayYears.length + 1}>
                      Deferred Developer Fee Payoff ({fmtPct(pf.ddf_payoff_pct)} of CF)
                    </td>
                  </tr>
                  <ProformaRow label="DDF Payment" years={displayYears} getter={y => -y.ddfPayment} deduct />
                  <ProformaRow label="DDF Balance" years={displayYears} getter={y => y.ddfBalance} bold
                    cellColor={y => y.ddfBalance <= 0 ? "#1a6b3c" : "#5a3a00"} />
                </>
              )}

              {/* ── SUB LOAN PAYOFF ── */}
              {subLoanRules.length > 0 && (
                <>
                  <tr><td style={separatorRow} colSpan={displayYears.length + 1} /></tr>
                  <tr>
                    <td style={labelCellSection} colSpan={displayYears.length + 1}>Subordinate Loan Payoff</td>
                  </tr>
                  {subLoanRules.map(rule => (
                    <ProformaRow key={rule.loan_id} label={`${rule.label} Payment`} years={displayYears}
                      getter={y => -(y.subLoanPayments[rule.loan_id] || 0)} deduct />
                  ))}
                </>
              )}

              {/* ── RESIDUAL CF ── */}
              <tr><td style={separatorRow} colSpan={displayYears.length + 1} /></tr>
              <ProformaRow label="Residual Cash Flow" years={displayYears} getter={y => y.residualCF} bold heavy accent="#1a3a6b" signed />

            </tbody>
          </table>
        </div>
      </div>

      {/* ── DDF PAYOFF SUMMARY ── */}
      {deferredDevFee > 0 && (
        <div style={{
          marginTop: 12, padding: "8px 14px", borderRadius: 4, fontSize: 10,
          background: result.ddfPaidYear ? "#f0f9f4" : "#fce8e3",
          border: `1px solid ${result.ddfPaidYear ? "#b8dfc8" : "#f5c2b0"}`,
          color: result.ddfPaidYear ? "#1a6b3c" : "#8B2500",
        }}>
          <strong>DDF Payoff:</strong>{" "}
          {result.ddfPaidYear
            ? `Deferred Developer Fee (${fmt$(deferredDevFee)}) fully repaid by Year ${result.ddfPaidYear} from ${fmtPct(pf.ddf_payoff_pct)} of surplus cash flow.`
            : `Deferred Developer Fee (${fmt$(deferredDevFee)}) NOT fully repaid within 15 years. Remaining balance: ${fmt$(result.years[14]?.ddfBalance || 0)}.`
          }
        </div>
      )}
    </div>
  );
}

/* ── Proforma table row component ──────────────────────────── */
function ProformaRow({ label, years, getter, bold, heavy, border, deduct, accent, signed, cellColor }) {
  const labelStyle = {
    padding: bold ? "5px 10px" : "4px 10px 4px 16px",
    textAlign: "left", fontSize: bold ? 10 : 10, whiteSpace: "nowrap",
    fontWeight: bold ? 700 : 400,
    color: accent || (deduct && !bold ? "#888" : bold ? "#111" : "#333"),
    ...(border ? { borderTop: "1px solid #ddd" } : {}),
    ...(heavy ? { borderTop: "2px solid #333" } : {}),
    position: "sticky", left: 0, background: "white", zIndex: 1,
    paddingLeft: bold ? 10 : 16,
  };

  return (
    <tr>
      <td style={labelStyle}>{label}</td>
      {years.map(y => {
        const v = getter(y);
        const color = cellColor ? cellColor(y) : (accent || (deduct && !bold ? "#888" : bold ? "#111" : "#333"));
        return (
          <td key={y.year} style={{
            padding: bold ? "5px 10px" : "4px 10px",
            textAlign: "right", fontSize: 10, fontFamily: "Inter, sans-serif",
            fontWeight: bold ? 700 : 400,
            color,
            whiteSpace: "nowrap",
            ...(border ? { borderTop: "1px solid #ddd" } : {}),
            ...(heavy ? { borderTop: "2px solid #333" } : {}),
          }}>
            {signed || deduct ? fmtNeg$(v) : fmt$(Math.abs(v))}
          </td>
        );
      })}
    </tr>
  );
}
