/**
 * Disposition.jsx — Module 10: Disposition / Exit Analysis
 *
 * Year 15 reversion analysis: property valuation via cap rate,
 * sale waterfall (value → cost of sale → debt payoff → net proceeds → GP/LP split),
 * and recap/refinance scenario sizing.
 *
 * All data pulled live from LihtcContext — single source of truth.
 */
import { useMemo } from "react";
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
const fmtPct = v => v == null ? "—" : (v * 100).toFixed(2) + "%";

/* ── defaults ────────────────────────────────────────────────── */
const DEFAULT_DISPOSITION = {
  exit_year: 15,
  exit_cap_rate: 0.0625,
  cost_of_sale_pct: 0.035,
  lp_residual_pct: 0.10,
  gp_residual_pct: 0.90,
  lp_exit_tax: 1000000,
  // Recap scenario
  recap_dscr: 1.25,
  recap_rate: 0.0625,
  recap_amort_years: 35,
};

/* ── defaults for proforma inputs ────────────────────────────── */
const DEFAULT_OPEX_LINES = [
  { id: "payroll",    label: "Payroll",                  amount: 394000,  escalates: true },
  { id: "marketing",  label: "Marketing & Advertising",  amount: 43860,   escalates: true },
  { id: "maintenance",label: "Repair/Maint. & Cleaning", amount: 146274,  escalates: true },
  { id: "admin",      label: "Administrative",           amount: 33080,   escalates: true },
  { id: "management", label: "Management Fees",          amount: 0,       escalates: false, is_pct_egi: true, pct: 0.055 },
  { id: "utilities",  label: "Utilities",                amount: 337604,  escalates: true },
  { id: "re_taxes",   label: "Real Estate & Other Taxes",amount: 7680,    escalates: true },
  { id: "insurance",  label: "Insurance",                amount: 74476,   escalates: true },
];

const DEFAULT_OTHER_INCOME = [
  { id: "other_inc_1", label: "Other Income", annual: 245700, escalates: true },
  { id: "op_support",  label: "Operating Support Income", annual: 0, escalates: false },
];

/* ── loan balance at elapsed year ────────────────────────────── */
function loanBalance(principal, annualRate, amortYears, yearsElapsed) {
  if (!principal || !annualRate || !amortYears) return principal || 0;
  const r = annualRate / 12;
  const n = amortYears * 12;
  const t = yearsElapsed * 12;
  const balance = principal * (Math.pow(1 + r, n) - Math.pow(1 + r, t)) / (Math.pow(1 + r, n) - 1);
  return Math.max(0, balance);
}

/* ── compute exit year NOI from proforma inputs ──────────────── */
function computeExitNOI(moduleStates, exitYear) {
  const pf = moduleStates.proforma || {};
  const grossRent = moduleStates.unit_mix?.computed_annual_revenue || 0;
  const totalUnits = (moduleStates.unit_mix?.rows ?? []).reduce((s, r) => s + (r.count || 0), 0) || 175;
  const revEsc = pf.revenue_escalation || 0.02;
  const expEsc = pf.expense_escalation || 0.03;
  const vacRate = pf.vacancy_rate || 0.06;

  const escalR = Math.pow(1 + revEsc, exitYear - 1);
  const escalE = Math.pow(1 + expEsc, exitYear - 1);

  // Revenue
  const rev = grossRent * escalR;
  const otherIncomeLines = pf.other_income || DEFAULT_OTHER_INCOME;
  const customOtherIncome = pf.custom_other_income || [];
  const otherIncome = [...otherIncomeLines, ...customOtherIncome].reduce(
    (s, i) => s + (i.annual || 0) * (i.escalates !== false ? escalR : 1), 0
  );
  const egi = (rev + otherIncome) * (1 - vacRate);

  // OpEx
  const opexLines = pf.opex_lines || DEFAULT_OPEX_LINES;
  const customOpex = pf.custom_opex || [];
  let totalOpex = 0;
  [...opexLines, ...customOpex].forEach(line => {
    if (line.is_pct_egi) totalOpex += egi * (line.pct || 0);
    else totalOpex += (line.amount || 0) * (line.escalates !== false ? escalE : 1);
  });
  const repRes = totalUnits * (pf.replacement_reserve_per_unit || 350) *
    Math.pow(1 + (pf.reserve_escalation || 0.03), exitYear - 1);
  totalOpex += repRes;

  return egi - totalOpex;
}

/* ── size new loan for recap scenario ────────────────────────── */
function sizeNewLoan(noi, dscr, rate, amortYears) {
  if (!noi || !dscr || !rate || !amortYears) return 0;
  const maxADS = noi / dscr;
  const monthlyPmt = maxADS / 12;
  const r = rate / 12;
  const n = amortYears * 12;
  return monthlyPmt * (1 - Math.pow(1 + r, -n)) / r;
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
        step={step || (pct ? 0.01 : 1000)}
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

/* ── SectionRow (matches SourcesUses pattern) ─────────────────── */
function SectionRow({ label, value, bold, border, accent, sub, indent }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: bold ? "8px 14px" : "5px 14px",
      paddingLeft: indent ? 28 : (bold ? 14 : 14),
      borderTop: border ? "2px solid #333" : "1px solid #f0f0f0",
      background: bold ? "#f5f5f0" : "transparent",
    }}>
      <span style={{
        fontSize: bold ? 12 : 11, fontWeight: bold ? 700 : 400,
        color: accent || "#222",
      }}>
        {label}
      </span>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
        <span style={{
          fontFamily: "Inter, sans-serif",
          fontSize: bold ? 13 : 11, fontWeight: bold ? 700 : 400,
          color: accent || "#222",
        }}>
          {value}
        </span>
        {sub && (
          <span style={{ fontSize: 8, color: "#999", marginTop: 1 }}>{sub}</span>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ══════════════════════════════════════════════════════════════════ */

export default function DispositionPanel() {
  const { moduleStates, updateModule } = useLihtc();

  // ── Pull disposition inputs ──
  const saved = moduleStates.disposition || {};
  const d = { ...DEFAULT_DISPOSITION, ...saved };
  const update = patch => updateModule("disposition", { ...d, ...patch });

  // ── Debt module ──
  const debt = moduleStates.debt || {};
  const permanent = debt.permanent || {};
  const permLoan = permanent.loan_amount || 0;
  const permRate = permanent.rate || 0.0585;
  const permAmort = permanent.amortization_years || 40;
  const rawSubdebt = debt.subdebt || [];

  // ── Budget → DDF ──
  const unitMix = moduleStates.unit_mix;
  const totalUnits = (unitMix?.rows ?? []).reduce((s, r) => s + (r.count || 0), 0) || 175;
  const bc = computeBudgetCalcs(moduleStates.budget, totalUnits);

  // ── Computed values ──
  const analysis = useMemo(() => {
    const exitYear = d.exit_year || 15;

    // NOI at exit year
    const exitNOI = computeExitNOI(moduleStates, exitYear);

    // Property valuation
    const grossValue = d.exit_cap_rate > 0 ? exitNOI / d.exit_cap_rate : 0;
    const costOfSale = grossValue * d.cost_of_sale_pct;

    // Outstanding perm loan balance
    const permBalance = loanBalance(permLoan, permRate, permAmort, exitYear);

    // Subdebt balances at exit (soft loans — assume accrual / no amortization paydown)
    const subdebtBalances = rawSubdebt.map(loan => ({
      ...loan,
      exitBalance: loan.amount || 0,
    }));
    const totalSubdebt = subdebtBalances.reduce((s, l) => s + l.exitBalance, 0);

    // Net sale proceeds
    const netSaleProceeds = grossValue - costOfSale - permBalance;

    // After LP exit tax
    const lpExitTax = d.lp_exit_tax || 0;
    const netToPartnership = netSaleProceeds - lpExitTax;

    // GP / LP split
    const lpResidual = netToPartnership * d.lp_residual_pct;
    const gpPromote = netToPartnership * d.gp_residual_pct;

    // ── Recap / Refinance scenario ──
    const newLoanAmount = sizeNewLoan(exitNOI, d.recap_dscr, d.recap_rate, d.recap_amort_years);
    const recapMaxADS = d.recap_dscr > 0 ? exitNOI / d.recap_dscr : 0;
    const recapMonthlyPmt = recapMaxADS / 12;
    const recapNetProceeds = newLoanAmount - permBalance;

    return {
      exitYear,
      exitNOI,
      grossValue,
      costOfSale,
      permBalance,
      subdebtBalances,
      totalSubdebt,
      netSaleProceeds,
      lpExitTax,
      netToPartnership,
      lpResidual,
      gpPromote,
      newLoanAmount,
      recapMaxADS,
      recapMonthlyPmt,
      recapNetProceeds,
    };
  }, [moduleStates, d, permLoan, permRate, permAmort, rawSubdebt, totalUnits]);

  // ── Styles ──
  const cardStyle = {
    background: "white", border: "1px solid #e0e0e0", borderRadius: 6,
    overflow: "hidden",
  };

  return (
    <div style={{ fontFamily: "Inter, sans-serif" }}>

      {/* ── HEADER ── */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 20, fontWeight: 400, color: "#111", margin: 0 }}>
            Disposition / Exit Analysis
          </h2>
          <span style={{ fontSize: 9, color: "#aaa", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            MODULE 10 · YEAR {analysis.exitYear} REVERSION
          </span>
        </div>
      </div>

      {/* ── METRICS BAR ── */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        {[
          { label: "Exit NOI",       value: fmt$(analysis.exitNOI),          sub: `Year ${analysis.exitYear}`, accent: "#1a6b3c", bg: "#f0f9f4", border: "#b8dfc8" },
          { label: "Property Value", value: fmt$(analysis.grossValue),       sub: `${fmtPct(d.exit_cap_rate)} cap`,  accent: "#1a3a6b", bg: "#f0f3f9", border: "#b8c8e0" },
          { label: "Net Proceeds",   value: fmt$(analysis.netSaleProceeds),  sub: "After debt payoff",        accent: "#5a3a00", bg: "#fdf8ef", border: "#e8d5a8" },
          { label: "GP Promote",     value: fmt$(analysis.gpPromote),        sub: `${fmtPct(d.gp_residual_pct)} share`, accent: "#1a3a6b", bg: "#f0f3f9", border: "#b8c8e0" },
        ].map(m => (
          <div key={m.label} style={{ background: m.bg, border: `1px solid ${m.border}`, borderRadius: 6, padding: "8px 12px", flex: "1 1 160px", minWidth: 160 }}>
            <div style={{ fontSize: 8, color: m.accent, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>{m.label}</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: m.accent }}>{m.value}</div>
            {m.sub && <div style={{ fontSize: 8, color: "#888", marginTop: 2 }}>{m.sub}</div>}
          </div>
        ))}
      </div>

      {/* ── MAIN GRID: Sale Waterfall + Inputs ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 }}>

        {/* ─── SALE ANALYSIS WATERFALL ─── */}
        <div style={cardStyle}>
          <div style={{
            padding: "12px 14px 8px", borderBottom: "2px solid #333",
            display: "flex", justifyContent: "space-between", alignItems: "baseline",
          }}>
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#888" }}>
              Sale Analysis
            </span>
            <span style={{ fontSize: 9, color: "#aaa" }}>Year {analysis.exitYear} Exit</span>
          </div>

          <SectionRow
            label="Gross Property Value"
            value={fmt$(analysis.grossValue)}
            accent="#1a6b3c"
            sub={`NOI ${fmt$(analysis.exitNOI)} / ${fmtPct(d.exit_cap_rate)} cap`}
          />
          <SectionRow
            label={`Less: Cost of Sale (${fmtPct(d.cost_of_sale_pct)})`}
            value={`(${fmt$(analysis.costOfSale)})`}
            accent="#8B2500"
          />
          <SectionRow
            label="Less: Outstanding Perm Loan"
            value={`(${fmt$(analysis.permBalance)})`}
            accent="#8B2500"
            sub={`${fmt$(permLoan)} original, ${permAmort}yr amort`}
          />
          <SectionRow
            label="Net Sale Proceeds"
            value={fmt$(analysis.netSaleProceeds)}
            bold
            border
            accent="#1a3a6b"
          />

          {/* Separator */}
          <div style={{ height: 4, background: "#f8f8f8" }} />

          <SectionRow
            label="Less: LP Exit Tax Estimate"
            value={`(${fmt$(analysis.lpExitTax)})`}
            accent="#8B2500"
          />
          <SectionRow
            label="Net to Partnership"
            value={fmt$(analysis.netToPartnership)}
            bold
            border
            accent="#1a3a6b"
          />

          {/* Separator */}
          <div style={{ height: 4, background: "#f8f8f8" }} />

          <SectionRow
            label={`LP Residual (${fmtPct(d.lp_residual_pct)})`}
            value={fmt$(analysis.lpResidual)}
            indent
          />
          <SectionRow
            label={`GP Promote (${fmtPct(d.gp_residual_pct)})`}
            value={fmt$(analysis.gpPromote)}
            indent
            accent="#1a3a6b"
          />

          {/* Subdebt outstanding */}
          {analysis.subdebtBalances.filter(l => l.exitBalance > 0).length > 0 && (
            <>
              <div style={{ height: 4, background: "#f8f8f8" }} />
              <div style={{
                padding: "6px 14px", fontSize: 9, fontWeight: 700, color: "#888",
                textTransform: "uppercase", letterSpacing: "0.06em",
                borderTop: "1px solid #f0f0f0",
              }}>
                Outstanding Subordinate Debt at Exit
              </div>
              {analysis.subdebtBalances.filter(l => l.exitBalance > 0).map(loan => (
                <SectionRow
                  key={loan.id}
                  label={loan.label}
                  value={fmt$(loan.exitBalance)}
                  accent="#5a3a00"
                  indent
                />
              ))}
              <SectionRow
                label="Total Outstanding Subdebt"
                value={fmt$(analysis.totalSubdebt)}
                bold
                border
                accent="#5a3a00"
              />
            </>
          )}
        </div>

        {/* ─── INPUTS CARD ─── */}
        <div style={cardStyle}>
          <div style={{
            padding: "12px 14px 8px", borderBottom: "2px solid #333",
          }}>
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#888" }}>
              Exit Assumptions
            </span>
          </div>
          <div style={{ padding: "12px 14px" }}>
            {[
              { label: "Exit Year",          val: d.exit_year,         key: "exit_year",         step: 1, width: 60 },
              { label: "Exit Cap Rate",       val: d.exit_cap_rate,    key: "exit_cap_rate",     pct: true, step: 0.25, suffix: "%" },
              { label: "Cost of Sale",        val: d.cost_of_sale_pct, key: "cost_of_sale_pct",  pct: true, step: 0.25, suffix: "%" },
              { label: "LP Residual Split",   val: d.lp_residual_pct,  key: "lp_residual_pct",   pct: true, step: 1, suffix: "%" },
              { label: "GP Residual Split",   val: d.gp_residual_pct,  key: "gp_residual_pct",   pct: true, step: 1, suffix: "%" },
              { label: "LP Exit Tax Estimate",val: d.lp_exit_tax,      key: "lp_exit_tax",       prefix: "$", step: 50000, width: 100 },
            ].map(f => (
              <div key={f.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: "#444" }}>{f.label}</span>
                <TinyInput
                  value={f.val}
                  onChange={v => update({ [f.key]: v })}
                  pct={f.pct}
                  prefix={f.prefix}
                  suffix={f.suffix}
                  width={f.width || 70}
                  step={f.step}
                />
              </div>
            ))}
          </div>

          {/* Divider */}
          <div style={{ borderTop: "1px solid #e0e0e0", margin: "0 14px" }} />

          {/* Read-only reference data */}
          <div style={{ padding: "12px 14px" }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
              From Other Modules
            </div>
            {[
              { label: "Perm Loan Amount",  value: fmt$(permLoan) },
              { label: "Perm Rate",         value: fmtPct(permRate) },
              { label: "Perm Amort",        value: `${permAmort} years` },
              { label: "Gross Annual Rent",  value: fmt$(moduleStates.unit_mix?.computed_annual_revenue || 0) },
              { label: "Deferred Dev Fee",   value: fmt$(bc.deferredDevFee || 0) },
            ].map(f => (
              <div key={f.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <span style={{ fontSize: 10, color: "#888" }}>{f.label}</span>
                <span style={{ fontSize: 10, color: "#555", fontFamily: "Inter, sans-serif" }}>{f.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── RECAP / REFINANCE SCENARIO ── */}
      <div style={{ ...cardStyle, marginBottom: 20 }}>
        <div style={{
          padding: "12px 14px 8px", borderBottom: "2px solid #333",
          display: "flex", justifyContent: "space-between", alignItems: "baseline",
        }}>
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#888" }}>
            Recap / Refinance Scenario
          </span>
          <span style={{ fontSize: 9, color: "#aaa" }}>Year {analysis.exitYear} Refi</span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>

          {/* Left: inputs */}
          <div style={{ borderRight: "1px solid #e0e0e0", padding: "12px 14px" }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: "#1a3a6b", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>
              New Loan Parameters
            </div>
            {[
              { label: "Target DSCR",     val: d.recap_dscr,        key: "recap_dscr",        step: 0.05, width: 60 },
              { label: "New Loan Rate",    val: d.recap_rate,        key: "recap_rate",        pct: true, step: 0.25, suffix: "%" },
              { label: "New Amort (years)",val: d.recap_amort_years, key: "recap_amort_years", step: 1, width: 60 },
            ].map(f => (
              <div key={f.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: "#444" }}>{f.label}</span>
                <TinyInput
                  value={f.val}
                  onChange={v => update({ [f.key]: v })}
                  pct={f.pct}
                  suffix={f.suffix}
                  width={f.width || 70}
                  step={f.step}
                />
              </div>
            ))}
          </div>

          {/* Right: computed results */}
          <div style={{ padding: 0 }}>
            <div style={{ padding: "12px 14px 6px" }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: "#1a6b3c", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
                Recap Results
              </div>
            </div>

            <SectionRow
              label="Exit Year NOI"
              value={fmt$(analysis.exitNOI)}
              accent="#1a6b3c"
            />
            <SectionRow
              label={`Max Annual DS (${d.recap_dscr}x DSCR)`}
              value={fmt$(analysis.recapMaxADS)}
              sub={`${fmt$(analysis.recapMonthlyPmt)} / month`}
            />
            <SectionRow
              label="New Loan Proceeds"
              value={fmt$(analysis.newLoanAmount)}
              accent="#1a3a6b"
              bold
              border
            />
            <SectionRow
              label="Less: Payoff Existing Perm"
              value={`(${fmt$(analysis.permBalance)})`}
              accent="#8B2500"
            />
            <SectionRow
              label="Net Recap Proceeds"
              value={analysis.recapNetProceeds >= 0 ? fmt$(analysis.recapNetProceeds) : `(${fmt$(analysis.recapNetProceeds)})`}
              bold
              border
              accent={analysis.recapNetProceeds >= 0 ? "#1a6b3c" : "#8B2500"}
            />
          </div>
        </div>
      </div>

      {/* ── BOTTOM SUMMARY METRICS ── */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {[
          { label: "Exit NOI",        value: fmt$(analysis.exitNOI) },
          { label: "Exit Cap Rate",   value: fmtPct(d.exit_cap_rate) },
          { label: "Gross Value",     value: fmt$(analysis.grossValue) },
          { label: "Perm Balance",    value: fmt$(analysis.permBalance) },
          { label: "Net Proceeds",    value: fmt$(analysis.netSaleProceeds) },
          { label: "GP Promote",      value: fmt$(analysis.gpPromote) },
          { label: "Recap Loan",      value: fmt$(analysis.newLoanAmount) },
          { label: "Net Recap",       value: fmt$(analysis.recapNetProceeds) },
        ].map(m => (
          <div key={m.label} style={{
            background: "white", border: "1px solid #e0e0e0", borderRadius: 5,
            padding: "8px 14px", minWidth: 110, flex: "1 1 110px",
          }}>
            <div style={{ fontSize: 8, color: "#888", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>
              {m.label}
            </div>
            <div style={{ fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: 13, color: "#111" }}>
              {m.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
