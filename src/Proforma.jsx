/**
 * Proforma.jsx — Module 6: 15-Year Operating Proforma
 *
 * Revenue (from Unit Mix) → OpEx → NOI → Debt Service → Cash Flow
 * Wires Year 1 NOI back to Debt module for DSCR sizing.
 * Tracks DDF payoff from surplus cash flow.
 */
import { useState, useMemo, useEffect } from "react";
import { useLihtc } from "./context/LihtcContext.jsx";
import { computeBudgetCalcs, computeLIHTC } from "./lihtcCalcs.js";

/* ── formatters ──────────────────────────────────────────────── */
const fmt$ = v => v == null ? "—" : "$" + Math.round(Math.abs(v)).toLocaleString();
const fmtK = v => v == null ? "—" : "$" + (Math.abs(v) / 1000).toFixed(0) + "K";
const fmtPct = v => v == null ? "—" : (v * 100).toFixed(1) + "%";
const fmtX = v => v == null ? "—" : v.toFixed(2) + "x";

/* ── defaults ────────────────────────────────────────────────── */
const DEFAULT_PROFORMA = {
  // Escalation rates
  revenue_escalation:   0.02,   // 2% annual
  expense_escalation:   0.03,   // 3% annual
  vacancy_rate:         0.05,   // 5%

  // Other income
  other_income: [
    { label: "Laundry / Vending",  annual: 0 },
    { label: "Parking",            annual: 0 },
    { label: "Other",              annual: 0 },
  ],

  // Operating expenses — Year 1 amounts
  opex: {
    management_fee_pct: 0.055,   // % of EGI
    payroll:            394000,
    admin:              76940,
    utilities:          337604,
    maintenance:        146274,
    insurance:          175000,
    real_estate_taxes:  125000,
    other_opex:         0,
  },
  replacement_reserve_per_unit: 350,

  // DDF payoff
  ddf_payoff_pct: 0.75,         // % of surplus cash flow applied to DDF
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
function computeProforma(inputs, grossRent, totalUnits, permLoan, permRate, permAmort, subdebt, deferredDevFee) {
  const p = inputs;
  const years = [];
  let ddfBalance = deferredDevFee || 0;
  let ddfPaidYear = null;

  // Senior debt service (fixed for all years)
  const seniorADS = annualDS(permLoan, permRate, permAmort);

  // Subdebt annual cash-pay (only in_ads items)
  const subdebtADS = (subdebt || []).reduce((sum, l) => {
    if (!l.in_ads) return sum;
    if (l.payment_type === "accrual" || l.payment_type === "forgivable") return sum;
    if (l.payment_type === "io") return sum + (l.amount || 0) * (l.rate || 0);
    return sum + annualDS(l.amount || 0, l.rate || 0, l.amortization_years || l.term_years || 15);
  }, 0);

  const totalADS = seniorADS + subdebtADS;

  for (let yr = 1; yr <= 15; yr++) {
    const escalR = Math.pow(1 + (p.revenue_escalation || 0), yr - 1);
    const escalE = Math.pow(1 + (p.expense_escalation || 0), yr - 1);

    // Revenue
    const gpr = (grossRent || 0) * escalR;
    const vacancy = gpr * (p.vacancy_rate || 0.05);
    const otherIncome = (p.other_income || []).reduce((s, o) => s + (o.annual || 0), 0) * escalR;
    const egi = gpr - vacancy + otherIncome;

    // Operating expenses
    const opex = p.opex || {};
    const mgmtFee = egi * (opex.management_fee_pct || 0);
    const payroll = (opex.payroll || 0) * escalE;
    const admin = (opex.admin || 0) * escalE;
    const utilities = (opex.utilities || 0) * escalE;
    const maintenance = (opex.maintenance || 0) * escalE;
    const insurance = (opex.insurance || 0) * escalE;
    const reTaxes = (opex.real_estate_taxes || 0) * escalE;
    const otherOpex = (opex.other_opex || 0) * escalE;
    const repReserve = totalUnits * (p.replacement_reserve_per_unit || 350);
    const totalOpex = mgmtFee + payroll + admin + utilities + maintenance + insurance + reTaxes + otherOpex + repReserve;

    // NOI
    const noi = egi - totalOpex;

    // Cash flow
    const cashFlow = noi - totalADS;

    // DSCR
    const seniorDSCR = seniorADS > 0 ? noi / seniorADS : 0;
    const totalDSCR = totalADS > 0 ? noi / totalADS : 0;

    // DDF payoff
    const ddfPayment = cashFlow > 0 ? Math.min(cashFlow * (p.ddf_payoff_pct || 0.75), ddfBalance) : 0;
    ddfBalance = Math.max(0, ddfBalance - ddfPayment);
    if (ddfBalance <= 0 && ddfPaidYear === null && deferredDevFee > 0) {
      ddfPaidYear = yr;
    }

    const residualCF = cashFlow - ddfPayment;

    years.push({
      year: yr,
      gpr, vacancy, otherIncome, egi,
      mgmtFee, payroll, admin, utilities, maintenance, insurance, reTaxes, otherOpex, repReserve,
      totalOpex,
      noi,
      seniorADS, subdebtADS, totalADS,
      seniorDSCR, totalDSCR,
      cashFlow,
      ddfPayment, ddfBalance, residualCF,
    });
  }

  return { years, ddfPaidYear, seniorADS, totalADS };
}

/* ── sub-components ──────────────────────────────────────────── */

function FieldRow({ label, note, children }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, gap: 8 }}>
      <div>
        <div style={{ fontSize: 10, color: "#444" }}>{label}</div>
        {note && <div style={{ fontSize: 8, color: "#bbb" }}>{note}</div>}
      </div>
      {children}
    </div>
  );
}

function InputField({ value, onChange, prefix, suffix, width, step, pct }) {
  const display = pct ? (value * 100) : value;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
      {prefix && <span style={{ fontSize: 10, color: "#888" }}>{prefix}</span>}
      <input
        type="number"
        value={display || ""}
        step={step || (pct ? 0.1 : 1000)}
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

function MetricCard({ label, value, sub, accent }) {
  const colors = {
    navy:  { bg: "#f0f3f9", border: "#b8c8e0", text: "#1a3a6b" },
    green: { bg: "#f0f9f4", border: "#b8dfc8", text: "#1a6b3c" },
    red:   { bg: "#fce8e3", border: "#f5c2b0", text: "#8B2500" },
    amber: { bg: "#fdf8ef", border: "#e8d5a8", text: "#5a3a00" },
    gray:  { bg: "#f5f5f3", border: "#e0e0e0", text: "#555" },
  };
  const c = colors[accent] || colors.gray;
  return (
    <div style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 6, padding: "8px 12px", flex: "1 1 120px", minWidth: 120 }}>
      <div style={{ fontSize: 8, color: c.text, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: c.text }}>{value}</div>
      {sub && <div style={{ fontSize: 8, color: "#888", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ══════════════════════════════════════════════════════════════ */

export default function ProformaPanel() {
  const { moduleStates, updateModule } = useLihtc();

  // ── Pull inputs ──
  const pf = { ...DEFAULT_PROFORMA, ...moduleStates.proforma };
  const opex = { ...DEFAULT_PROFORMA.opex, ...(pf.opex || {}) };
  const pfWithOpex = { ...pf, opex };

  const update = patch => updateModule("proforma", { ...pf, ...patch });
  const updateOpex = patch => update({ opex: { ...opex, ...patch } });

  // ── Unit Mix → Gross Rent ──
  const unitMix = moduleStates.unit_mix;
  const rows = unitMix?.rows ?? [];
  const totalUnits = rows.reduce((s, r) => s + (r.count || 0), 0) || 175;

  // Read computed annual revenue published by UnitMix module
  // Falls back to 0 if UnitMix hasn't rendered yet (user should visit Unit Mix tab first)
  const grossRent = unitMix?.computed_annual_revenue || 0;

  // ── Debt module → ADS ──
  const debt = moduleStates.debt || {};
  const permanent = debt.permanent || {};
  const permLoan = permanent.loan_amount || 0;
  const permRate = permanent.rate || 0.0585;
  const permAmort = permanent.amortization_years || 40;
  const subdebt = debt.subdebt || [];

  // ── Budget → DDF ──
  const budget = moduleStates.budget;
  const bc = computeBudgetCalcs(budget, totalUnits);
  const deferredDevFee = bc.deferredDevFee || 0;

  // ── Compute 15-year proforma ──
  const result = useMemo(
    () => computeProforma(pfWithOpex, grossRent, totalUnits, permLoan, permRate, permAmort, subdebt, deferredDevFee),
    [pfWithOpex, grossRent, totalUnits, permLoan, permRate, permAmort, subdebt, deferredDevFee]
  );

  const yr1 = result.years[0] || {};

  // ── Wire Year 1 NOI back to Debt module ──
  useEffect(() => {
    if (yr1.noi > 0 && Math.abs(yr1.noi - (permanent.noi_override || 0)) > 100) {
      updateModule("debt", {
        permanent: { ...permanent, noi_override: Math.round(yr1.noi), use_noi_override: true },
      });
    }
  }, [yr1.noi]);

  // ── Table display state ──
  const [showAllYears, setShowAllYears] = useState(false);
  const displayYears = showAllYears ? result.years : result.years.filter(y => y.year <= 5 || y.year === 10 || y.year === 15);

  const cardStyle = { background: "white", border: "1px solid #e0e0e0", borderRadius: 6, padding: "16px 18px", marginBottom: 16 };

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
        <MetricCard label="Gross Pot. Rent" value={fmt$(yr1.gpr)} sub={`${totalUnits} units`} accent="navy" />
        <MetricCard label="Yr 1 EGI" value={fmt$(yr1.egi)} sub={`${fmtPct(pf.vacancy_rate)} vacancy`} accent="green" />
        <MetricCard label="Yr 1 NOI" value={fmt$(yr1.noi)} sub={`${fmtPct(yr1.totalOpex / yr1.egi)} expense ratio`} accent="green" />
        <MetricCard label="Cash Flow" value={yr1.cashFlow < 0 ? `(${fmt$(yr1.cashFlow)})` : fmt$(yr1.cashFlow)} sub="After debt service" accent={yr1.cashFlow >= 0 ? "amber" : "red"} />
        <MetricCard label="Sr. Debt Service" value={fmt$(result.seniorADS)} sub={`${fmtX(yr1.seniorDSCR)} DSCR`} accent="navy" />
      </div>

      {/* ── MAIN GRID: Inputs left, Table right ── */}
      <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 16 }}>

        {/* ─── LEFT: INPUTS ─── */}
        <div>
          {/* Assumptions */}
          <div style={cardStyle}>
            <div style={{ fontSize: 9, fontWeight: 700, color: "#1a3a6b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
              Assumptions
            </div>
            <FieldRow label="Vacancy Rate">
              <InputField value={pf.vacancy_rate} onChange={v => update({ vacancy_rate: v })} pct suffix="%" width={60} />
            </FieldRow>
            <FieldRow label="Revenue Escalation">
              <InputField value={pf.revenue_escalation} onChange={v => update({ revenue_escalation: v })} pct suffix="% / yr" width={60} />
            </FieldRow>
            <FieldRow label="Expense Escalation">
              <InputField value={pf.expense_escalation} onChange={v => update({ expense_escalation: v })} pct suffix="% / yr" width={60} />
            </FieldRow>
            <FieldRow label="DDF Payoff Rate" note="% of surplus CF to DDF">
              <InputField value={pf.ddf_payoff_pct} onChange={v => update({ ddf_payoff_pct: v })} pct suffix="%" width={60} />
            </FieldRow>
            <FieldRow label="Repl. Reserve / Unit">
              <InputField value={pf.replacement_reserve_per_unit} onChange={v => update({ replacement_reserve_per_unit: v })} prefix="$" width={70} step={25} />
            </FieldRow>
          </div>

          {/* Operating Expenses */}
          <div style={cardStyle}>
            <div style={{ fontSize: 9, fontWeight: 700, color: "#8B2500", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
              Year 1 Operating Expenses
            </div>
            <FieldRow label="Management Fee" note="% of EGI">
              <InputField value={opex.management_fee_pct} onChange={v => updateOpex({ management_fee_pct: v })} pct suffix="%" width={60} />
            </FieldRow>
            <FieldRow label="Payroll">
              <InputField value={opex.payroll} onChange={v => updateOpex({ payroll: v })} prefix="$" width={90} />
            </FieldRow>
            <FieldRow label="Administrative">
              <InputField value={opex.admin} onChange={v => updateOpex({ admin: v })} prefix="$" width={90} />
            </FieldRow>
            <FieldRow label="Utilities">
              <InputField value={opex.utilities} onChange={v => updateOpex({ utilities: v })} prefix="$" width={90} />
            </FieldRow>
            <FieldRow label="Maintenance">
              <InputField value={opex.maintenance} onChange={v => updateOpex({ maintenance: v })} prefix="$" width={90} />
            </FieldRow>
            <FieldRow label="Insurance">
              <InputField value={opex.insurance} onChange={v => updateOpex({ insurance: v })} prefix="$" width={90} />
            </FieldRow>
            <FieldRow label="Real Estate Taxes">
              <InputField value={opex.real_estate_taxes} onChange={v => updateOpex({ real_estate_taxes: v })} prefix="$" width={90} />
            </FieldRow>
            <FieldRow label="Other OpEx">
              <InputField value={opex.other_opex} onChange={v => updateOpex({ other_opex: v })} prefix="$" width={90} />
            </FieldRow>

            {/* Total */}
            <div style={{ borderTop: "2px solid #333", marginTop: 10, paddingTop: 8, display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontSize: 11, fontWeight: 700 }}>Total Year 1 OpEx</span>
              <span style={{ fontSize: 11, fontWeight: 700 }}>{fmt$(yr1.totalOpex)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
              <span style={{ fontSize: 9, color: "#888" }}>Per unit</span>
              <span style={{ fontSize: 9, color: "#888" }}>{fmt$(yr1.totalOpex / totalUnits)} / yr</span>
            </div>
          </div>

          {/* Other Income */}
          <div style={cardStyle}>
            <div style={{ fontSize: 9, fontWeight: 700, color: "#1a6b3c", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
              Other Income (Annual)
            </div>
            {(pf.other_income || DEFAULT_PROFORMA.other_income).map((item, i) => (
              <FieldRow key={i} label={item.label}>
                <InputField
                  value={item.annual}
                  onChange={v => {
                    const arr = [...(pf.other_income || DEFAULT_PROFORMA.other_income)];
                    arr[i] = { ...arr[i], annual: v };
                    update({ other_income: arr });
                  }}
                  prefix="$" width={90}
                />
              </FieldRow>
            ))}
          </div>

          {/* Year 1 Waterfall */}
          <div style={cardStyle}>
            <div style={{ fontSize: 9, fontWeight: 700, color: "#555", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
              Year 1 Waterfall
            </div>
            {[
              { label: "Gross Potential Rent",   value: yr1.gpr,       indent: 0 },
              { label: `Less Vacancy (${fmtPct(pf.vacancy_rate)})`, value: -yr1.vacancy, indent: 0, deduct: true },
              { label: "Other Income",            value: yr1.otherIncome, indent: 0 },
              { label: "Effective Gross Income",  value: yr1.egi,       indent: 0, bold: true },
              null,
              { label: "Less Operating Expenses", value: -yr1.totalOpex, indent: 0, deduct: true },
              { label: "Net Operating Income",    value: yr1.noi,       indent: 0, bold: true, accent: "#1a6b3c" },
              null,
              { label: "Senior Debt Service",     value: -yr1.seniorADS, indent: 0, deduct: true },
              { label: "Subordinate DS",          value: -yr1.subdebtADS, indent: 0, deduct: true },
              { label: "Cash Flow After DS",      value: yr1.cashFlow,  indent: 0, bold: true, accent: yr1.cashFlow >= 0 ? "#5a3a00" : "#8B2500" },
            ].map((r, i) => r === null ? (
              <div key={i} style={{ height: 6 }} />
            ) : (
              <div key={i} style={{
                display: "flex", justifyContent: "space-between",
                padding: r.bold ? "5px 0" : "2px 0",
                borderTop: r.bold ? "1px solid #ddd" : "none",
              }}>
                <span style={{ fontSize: 10, fontWeight: r.bold ? 700 : 400, color: r.deduct ? "#888" : "#333", paddingLeft: r.indent * 12 }}>
                  {r.label}
                </span>
                <span style={{ fontSize: 10, fontWeight: r.bold ? 700 : 400, color: r.accent || (r.deduct ? "#888" : "#333") }}>
                  {r.deduct ? `(${fmt$(Math.abs(r.value))})` : (r.value < 0 ? `(${fmt$(r.value)})` : fmt$(r.value))}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ─── RIGHT: 15-YEAR TABLE ─── */}
        <div style={{ ...cardStyle, padding: "12px 14px", overflow: "auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: "#1a3a6b", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              15-Year Projection
            </div>
            <button
              onClick={() => setShowAllYears(!showAllYears)}
              style={{
                background: "none", border: "1px solid #ddd", borderRadius: 3,
                padding: "3px 8px", fontSize: 9, color: "#888", cursor: "pointer",
              }}
            >
              {showAllYears ? "Summary View" : "All Years"}
            </button>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", fontSize: 10, width: "100%", minWidth: 600 }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #333" }}>
                  <th style={thStyle}>Year</th>
                  <th style={thStyleR}>GPR</th>
                  <th style={thStyleR}>EGI</th>
                  <th style={thStyleR}>OpEx</th>
                  <th style={{ ...thStyleR, color: "#1a6b3c" }}>NOI</th>
                  <th style={thStyleR}>ADS</th>
                  <th style={{ ...thStyleR, color: "#5a3a00" }}>Cash Flow</th>
                  <th style={{ ...thStyleR, color: "#1a3a6b" }}>Sr. DSCR</th>
                  <th style={{ ...thStyleR, color: "#5a3a00" }}>DDF Bal.</th>
                </tr>
              </thead>
              <tbody>
                {displayYears.map((y, idx) => {
                  const dscrOk = y.seniorDSCR >= 1.15;
                  return (
                    <tr key={y.year} style={{ borderBottom: "1px solid #f0f0f0", background: idx % 2 === 0 ? "white" : "#fafafa" }}>
                      <td style={tdStyle}>{y.year}</td>
                      <td style={tdStyleR}>{fmtK(y.gpr)}</td>
                      <td style={tdStyleR}>{fmtK(y.egi)}</td>
                      <td style={tdStyleR}>{fmtK(y.totalOpex)}</td>
                      <td style={{ ...tdStyleR, fontWeight: 600, color: "#1a6b3c" }}>{fmtK(y.noi)}</td>
                      <td style={tdStyleR}>{fmtK(y.totalADS)}</td>
                      <td style={{ ...tdStyleR, fontWeight: 600, color: y.cashFlow >= 0 ? "#5a3a00" : "#8B2500" }}>
                        {y.cashFlow < 0 ? `(${fmtK(Math.abs(y.cashFlow))})` : fmtK(y.cashFlow)}
                      </td>
                      <td style={{ ...tdStyleR, fontWeight: 600, color: dscrOk ? "#1a6b3c" : "#8B2500" }}>
                        {fmtX(y.seniorDSCR)}
                      </td>
                      <td style={{ ...tdStyleR, color: y.ddfBalance > 0 ? "#5a3a00" : "#1a6b3c" }}>
                        {y.ddfBalance > 0 ? fmtK(y.ddfBalance) : "Paid ✓"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* DDF payoff summary */}
          {deferredDevFee > 0 && (
            <div style={{
              marginTop: 12, padding: "8px 12px", borderRadius: 4, fontSize: 10,
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
      </div>
    </div>
  );
}

/* ── table styles ────────────────────────────────────────────── */
const thStyle = { padding: "5px 8px", textAlign: "left", fontSize: 8, color: "#888", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 };
const thStyleR = { ...thStyle, textAlign: "right" };
const tdStyle = { padding: "6px 8px", fontSize: 10 };
const tdStyleR = { ...tdStyle, textAlign: "right" };
