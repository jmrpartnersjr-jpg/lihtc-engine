/**
 * Dashboard.jsx — Project Summary / Front Page
 *
 * Read-only executive summary pulling live data from all modules.
 * Mirrors the Excel "Project Summary Sheet" layout: project info,
 * sources & uses snapshot, unit mix, proforma Year 1, schedule,
 * debt & equity, underwriting notes — all in one place.
 */
import { useMemo } from "react";
import { useLihtc } from "./context/LihtcContext.jsx";
import { computeBudgetCalcs, computeLIHTC } from "./lihtcCalcs.js";

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
const fmtInt = v => v == null ? "—" : Math.round(v).toLocaleString();

/* ── defaults (same as Proforma.jsx) ───────────────────────── */
const DEFAULT_OPEX_LINES = [
  { id: "payroll", label: "Payroll", amount: 394000, escalates: true },
  { id: "marketing", label: "Marketing & Advertising", amount: 43860, escalates: true },
  { id: "maintenance", label: "Repair/Maint. & Cleaning", amount: 146274, escalates: true },
  { id: "admin", label: "Administrative", amount: 33080, escalates: true },
  { id: "management", label: "Management Fees", amount: 0, escalates: false, is_pct_egi: true, pct: 0.055 },
  { id: "utilities", label: "Utilities", amount: 337604, escalates: true },
  { id: "re_taxes", label: "Real Estate & Other Taxes", amount: 7680, escalates: true },
  { id: "insurance", label: "Insurance", amount: 74476, escalates: true },
];
const DEFAULT_OTHER_INCOME = [
  { id: "other_inc_1", label: "Other Income", annual: 245700, escalates: true },
  { id: "op_support", label: "Operating Support Income", annual: 0, escalates: false },
];

const LIHTC_DEFAULTS = {
  credit_type: "4pct", applicable_pct: 0.04, basis_boost: true, boost_factor: 1.30,
  applicable_fraction: 1.0, credit_period: 10, investor_price: 0.82,
  non_basis_costs: 6527411, commercial_costs: 0, federal_grants: 0, historic_reduction: 0,
  state_credit_applies: false, state_credit_annual: 0, state_credit_period: 10, state_credit_price: 0,
};

const DEFAULT_SUBDEBT = [
  { id: 400, label: "Deferred Developer Fee", loan_type: "deferred_fee", amount: 0 },
  { id: 401, label: "Seller Note", loan_type: "seller", amount: 1000000 },
  { id: 402, label: "CHIP", loan_type: "soft", amount: 900000 },
  { id: 403, label: "Sponsor Note", loan_type: "sponsor", amount: 346031 },
];

/* ── debt service calc ─────────────────────────────────────── */
function debtConstant(rate, amortYears) {
  if (!rate || rate <= 0 || !amortYears || amortYears <= 0) return 0;
  const r = rate / 12;
  const n = amortYears * 12;
  return ((r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1)) * 12;
}

function loanBalance(principal, annualRate, amortYears, yearsElapsed) {
  if (!principal || !annualRate || !amortYears) return principal || 0;
  const r = annualRate / 12;
  const n = amortYears * 12;
  const t = yearsElapsed * 12;
  return principal * (Math.pow(1 + r, n) - Math.pow(1 + r, t)) / (Math.pow(1 + r, n) - 1);
}

/* ── compute Year 1 proforma inline ────────────────────────── */
function computeYear1(grossRent, totalUnits, pf) {
  const opexLines = pf.opex_lines || DEFAULT_OPEX_LINES;
  const customOpex = pf.custom_opex || [];
  const otherIncomeLines = pf.other_income || DEFAULT_OTHER_INCOME;
  const customOtherIncome = pf.custom_other_income || [];

  const totalRev = grossRent || 0;
  let totalOtherIncome = 0;
  [...otherIncomeLines, ...customOtherIncome].forEach(i => { totalOtherIncome += (i.annual || 0); });
  const adjustedIncome = totalRev + totalOtherIncome;
  const vacancy = adjustedIncome * (pf.vacancy_rate || 0.06);
  const egi = adjustedIncome - vacancy;

  let totalOpex = 0;
  [...opexLines, ...customOpex].forEach(line => {
    totalOpex += line.is_pct_egi ? egi * (line.pct || 0) : (line.amount || 0);
  });
  const repRes = totalUnits * (pf.replacement_reserve_per_unit || 350);
  totalOpex += repRes;
  const noi = egi - totalOpex;
  return { totalRev, totalOtherIncome, adjustedIncome, vacancy, egi, totalOpex, repRes, noi, opexLines, customOpex };
}

/* ── Metric Card ───────────────────────────────────────────── */
function MetricCard({ label, value, sub, accent, wide }) {
  return (
    <div style={{
      background: "white", border: "1px solid #e0e0e0", borderRadius: 6,
      padding: "14px 16px", flex: wide ? "1 1 220px" : "1 1 160px",
      borderTop: `3px solid ${accent || "#1a3a6b"}`,
    }}>
      <div style={{ fontSize: 9, color: "#888", textTransform: "uppercase",
        letterSpacing: "0.08em", marginBottom: 6, fontFamily: "Inter, sans-serif" }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: accent || "#1a3a6b",
        fontFamily: "Inter, sans-serif" }}>{value}</div>
      {sub && <div style={{ fontSize: 9, color: "#aaa", marginTop: 3, fontFamily: "Inter, sans-serif" }}>{sub}</div>}
    </div>
  );
}

/* ── Section with a thin navy bar ──────────────────────────── */
function Section({ title, children }) {
  return (
    <div style={{ background: "white", border: "1px solid #e0e0e0", borderRadius: 6, overflow: "hidden" }}>
      <div style={{
        padding: "10px 14px", borderBottom: "2px solid #1a3a6b", background: "#f8f8f8",
        fontSize: 10, fontWeight: 700, color: "#1a3a6b", textTransform: "uppercase",
        letterSpacing: "0.08em", fontFamily: "Inter, sans-serif",
      }}>{title}</div>
      <div style={{ padding: 0 }}>{children}</div>
    </div>
  );
}

/* ── Row inside a section ──────────────────────────────────── */
function Row({ label, value, bold, accent, border, indent, sub }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: bold ? "8px 14px" : "5px 14px",
      paddingLeft: indent ? 28 : 14,
      borderTop: border ? "2px solid #333" : "1px solid #f0f0f0",
      background: bold ? "#f5f5f0" : "transparent",
    }}>
      <span style={{
        fontSize: bold ? 11 : 10, fontWeight: bold ? 700 : 400,
        color: accent || "#333", fontFamily: "Inter, sans-serif",
      }}>{label}</span>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
        <span style={{
          fontSize: bold ? 12 : 11, fontWeight: bold ? 700 : 500,
          color: accent || "#222", fontFamily: "Inter, sans-serif",
        }}>{value}</span>
        {sub && <span style={{ fontSize: 8, color: "#aaa", marginTop: 1 }}>{sub}</span>}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ══════════════════════════════════════════════════════════════ */

export default function DashboardPanel() {
  const { moduleStates } = useLihtc();

  const data = useMemo(() => {
    // ── Unit Mix ──
    const umRows = moduleStates.unit_mix?.rows ?? [];
    const totalUnits = umRows.reduce((s, r) => s + (r.count || 0), 0) || 175;
    const grossRent = moduleStates.unit_mix?.computed_annual_revenue || 0;
    const avgRent = totalUnits > 0 && grossRent > 0 ? grossRent / totalUnits / 12 : 0;

    // Unit type breakdown
    const byType = {};
    const byAMI = {};
    umRows.forEach(row => {
      const type = (row.type || "").replace(/\s*-\s*\d+%\s*AMI/i, "").trim() || "Unknown";
      byType[type] = (byType[type] || 0) + (row.count || 0);
      const amiMatch = (row.type || "").match(/(\d+)%\s*AMI/i);
      if (amiMatch) {
        const ami = amiMatch[1] + "% AMI";
        byAMI[ami] = (byAMI[ami] || 0) + (row.count || 0);
      } else if ((row.type || "").toLowerCase().includes("mgr")) {
        byAMI["Mgr"] = (byAMI["Mgr"] || 0) + (row.count || 0);
      }
    });
    const totalSF = umRows.reduce((s, r) => s + (r.count || 0) * (r.sqft || 0), 0);
    const avgSF = totalUnits > 0 ? totalSF / totalUnits : 0;

    // ── Budget ──
    const budget = moduleStates.budget;
    const bc = computeBudgetCalcs(budget, totalUnits);

    // ── LIHTC ──
    const lihtcInputs = { ...LIHTC_DEFAULTS, ...moduleStates.lihtc };
    const debtConst = moduleStates.debt?.construction ?? {};
    const teBondAmt = debtConst.te_loan_override != null
      ? debtConst.te_loan_override
      : bc.tdc * (debtConst.bond_test_target_pct || 0.35);
    const lihtc = computeLIHTC(lihtcInputs, bc, totalUnits, teBondAmt);

    // ── Debt ──
    const permanent = moduleStates.debt?.permanent ?? {};
    const permLoan = permanent.loan_amount || 0;
    const permRate = permanent.rate || 0.0585;
    const permAmort = permanent.amort_years || 40;
    const permDC = debtConstant(permRate, permAmort);
    const permADS = permLoan * permDC;
    const permDSCR_target = permanent.dscr_requirement || 1.15;

    const rawSubdebt = moduleStates.debt?.subdebt ?? DEFAULT_SUBDEBT;
    const subdebtTotal = rawSubdebt.reduce((s, l) => s + (l.amount || 0), 0);

    // Construction loan
    const construction = moduleStates.debt?.construction ?? {};
    const ltcPct = construction.ltc_pct || 0.82;
    const combinedCL = bc.tdc * ltcPct;
    const bondTestPct = construction.bond_test_target_pct || 0.35;
    const teLoan = construction.te_loan_override != null ? construction.te_loan_override : bc.tdc * bondTestPct;
    const taxLoan = construction.taxable_loan_override != null ? construction.taxable_loan_override : combinedCL - teLoan;

    // ── Proforma Year 1 ──
    const pf = moduleStates.proforma || {};
    const y1 = computeYear1(grossRent, totalUnits, pf);
    const dscr = permADS > 0 ? y1.noi / permADS : 0;
    const cashFlow = y1.noi - permADS;

    // ── Sources & Uses ──
    const fedEquity = lihtc.equityRaised || 0;
    const stateEquity = lihtc.stateEquity || 0;
    const ddf = bc.deferredDevFee || 0;
    const otherSources = moduleStates.debt?.other_sources ?? [];
    const otherSourcesTotal = otherSources.reduce((s, l) => s + (l.amount || 0), 0);

    const sources = [
      { label: "Senior Debt", amount: permLoan, color: "#1a3a6b" },
      { label: "Tax Credit Equity", amount: fedEquity, color: "#1a6b3c" },
    ];
    if (stateEquity > 0) sources.push({ label: "State Credit Equity", amount: stateEquity, color: "#2a8a50" });
    rawSubdebt.forEach(l => {
      if (l.loan_type === "deferred_fee") return;
      if ((l.amount || 0) > 0) sources.push({ label: l.label, amount: l.amount || 0, color: "#8B2500" });
    });
    sources.push({ label: "Deferred Dev Fee", amount: ddf, color: "#5a3a00" });
    otherSources.forEach(s => {
      if ((s.amount || 0) > 0) sources.push({ label: s.label, amount: s.amount, color: "#555" });
    });
    const totalSources = sources.reduce((s, l) => s + l.amount, 0);
    const gap = totalSources - bc.tdc;

    // ── Disposition ──
    const dispo = moduleStates.disposition || {};
    const exitYear = dispo.exit_year || 15;
    const exitCap = dispo.exit_cap_rate || 0.0625;
    // Rough Year 15 NOI (escalated from Y1)
    const revEsc = pf.revenue_escalation || 0.02;
    const expEsc = pf.expense_escalation || 0.03;
    const y15Rev = grossRent * Math.pow(1 + revEsc, 14);
    const y15OtherInc = (pf.other_income || DEFAULT_OTHER_INCOME).reduce(
      (s, i) => s + (i.annual || 0) * (i.escalates !== false ? Math.pow(1 + revEsc, 14) : 1), 0
    );
    const y15EGI = (y15Rev + y15OtherInc) * (1 - (pf.vacancy_rate || 0.06));
    let y15Opex = 0;
    [...(pf.opex_lines || DEFAULT_OPEX_LINES), ...(pf.custom_opex || [])].forEach(line => {
      y15Opex += line.is_pct_egi ? y15EGI * (line.pct || 0) : (line.amount || 0) * Math.pow(1 + expEsc, 14);
    });
    y15Opex += totalUnits * (pf.replacement_reserve_per_unit || 350) * Math.pow(1 + (pf.reserve_escalation || 0.03), 14);
    const exitNOI = y15EGI - y15Opex;
    const grossValue = exitCap > 0 ? exitNOI / exitCap : 0;
    const costOfSale = grossValue * (dispo.cost_of_sale_pct || 0.035);
    const loanBal = loanBalance(permLoan, permRate, permAmort, exitYear);
    const netProceeds = grossValue - costOfSale - loanBal;
    const gpPromote = netProceeds > 0 ? (netProceeds - (dispo.lp_exit_tax || 1000000)) * (dispo.gp_residual_pct || 0.90) : 0;

    // ── Schedule ──
    const phases = moduleStates.schedule?.phases ?? [];

    // ── Sponsor CF quick metrics ──
    const sponsorCF = moduleStates.sponsor_cf || {};
    const gpEquity = sponsorCF.gp_equity_investment || 3000000;

    return {
      totalUnits, grossRent, avgRent, byType, byAMI, totalSF, avgSF,
      bc, lihtc, fedEquity, stateEquity, ddf,
      permLoan, permRate, permAmort, permADS, permDSCR_target, dscr,
      construction, ltcPct, combinedCL, teLoan, taxLoan, bondTestPct,
      teBondAmt, rawSubdebt, subdebtTotal,
      y1, cashFlow,
      sources, totalSources, gap,
      exitYear, exitCap, exitNOI, grossValue, costOfSale, loanBal, netProceeds, gpPromote,
      phases,
      gpEquity,
      lihtcInputs,
    };
  }, [moduleStates]);

  const d = data;

  return (
    <div style={{ fontFamily: "Inter, sans-serif" }}>

      {/* ── HEADER ── */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, fontWeight: 400, color: "#111", margin: 0 }}>
              Apollo Scriber Lake
            </h2>
            <span style={{ fontSize: 9, color: "#aaa", letterSpacing: "0.08em", textTransform: "uppercase" }}>
              PROJECT SUMMARY
            </span>
          </div>
          <span style={{ fontSize: 10, color: "#888" }}>Rooney Partners · v10c</span>
        </div>
        <div style={{ fontSize: 10, color: "#888", marginTop: 4 }}>
          5707/5723 198th St. SW · Lynnwood, WA 98036 · Snohomish County
        </div>
      </div>

      {/* ── TOP METRICS BAR ── */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
        <MetricCard label="Total Units" value={fmtInt(d.totalUnits)} sub={`Avg ${Math.round(d.avgSF)} SF`} accent="#1a3a6b" />
        <MetricCard label="Total Dev Cost" value={fmt$(d.bc.tdc)} sub={`${fmt$(Math.round(d.bc.tdc / d.totalUnits))}/unit`} accent="#1a3a6b" />
        <MetricCard label="Year 1 NOI" value={fmt$(d.y1.noi)} sub={`DSCR: ${fmtX(d.dscr)}`} accent="#1a6b3c" />
        <MetricCard label="LIHTC Equity" value={fmt$(d.fedEquity)} sub={`${fmtPct(d.lihtcInputs.investor_price || 0.82)} pricing`} accent="#1a6b3c" />
        <MetricCard label="Gap / Surplus" value={fmtNeg$(d.gap)}
          sub={d.gap >= 0 ? "Fully funded" : "Shortfall"} accent={d.gap >= 0 ? "#1a6b3c" : "#8B2500"} />
        <MetricCard label="Exit Value (Yr 15)" value={fmt$(d.grossValue)} sub={`${fmtPct(d.exitCap)} cap rate`} accent="#5a3a00" />
      </div>

      {/* ── MAIN GRID: 2 columns top, full-width third section below ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>

        {/* ─── COL 1: Sources & Uses ─── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Section title="Project Costs (Uses)">
            <Row label="Land & Acquisition" value={fmt$(d.bc.acqTotal)} />
            <Row label="Hard Costs" value={fmt$(d.bc.hcTotal)} />
            <Row label="Soft Costs" value={fmt$(d.bc.scTotal)} />
            <Row label="Financing & Legal" value={fmt$(d.bc.finTotal)} />
            <Row label="Org Costs & Reserves" value={fmt$(d.bc.orgTotal)} />
            <Row label="Developer Fee" value={fmt$(d.bc.devFee)} sub={`${fmtPct(d.bc.devFee / d.bc.subtotal)} of costs`} />
            <Row label="TOTAL DEVELOPMENT COST" value={fmt$(d.bc.tdc)} bold border accent="#1a3a6b" />
          </Section>

          <Section title="Sources of Funds">
            {d.sources.map((s, i) => (
              <Row key={i} label={s.label} value={fmt$(s.amount)}
                sub={d.bc.tdc > 0 ? fmtPct(s.amount / d.bc.tdc) : undefined}
                accent={s.color} />
            ))}
            <Row label="TOTAL SOURCES" value={fmt$(d.totalSources)} bold border accent="#1a3a6b" />
            <Row label={d.gap >= 0 ? "SURPLUS" : "GAP (SHORTFALL)"}
              value={fmtNeg$(d.gap)} bold
              accent={d.gap >= 0 ? "#1a6b3c" : "#8B2500"} />
          </Section>
        </div>

        {/* ─── COL 2: Operating Proforma + Unit Mix ─── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Section title="Year 1 Operating Proforma">
            <Row label="Gross Rental Revenue" value={fmt$(d.y1.totalRev)} />
            <Row label="Other Income" value={fmt$(d.y1.totalOtherIncome)} indent />
            <Row label="Adjusted Income" value={fmt$(d.y1.adjustedIncome)} bold />
            <Row label="Less: Vacancy" value={`(${fmt$(d.y1.vacancy)})`} accent="#8B2500" indent />
            <Row label="Effective Gross Income" value={fmt$(d.y1.egi)} bold />
            {d.y1.opexLines.map((line, i) => (
              <Row key={i} label={line.label || line.id} value={`(${fmt$(line.is_pct_egi ? d.y1.egi * (line.pct || 0) : line.amount)})`} indent accent="#666" />
            ))}
            {(d.y1.customOpex || []).map((line, i) => (
              <Row key={`c${i}`} label={line.label} value={`(${fmt$(line.is_pct_egi ? d.y1.egi * (line.pct || 0) : line.amount)})`} indent accent="#666" />
            ))}
            <Row label="Replacement Reserve" value={`(${fmt$(d.y1.repRes)})`} indent accent="#666" />
            <Row label="Total Expenses" value={`(${fmt$(d.y1.totalOpex)})`} bold accent="#8B2500" />
            <Row label="NET OPERATING INCOME" value={fmt$(d.y1.noi)} bold border accent="#1a6b3c" />
            <Row label="Senior Debt Service" value={`(${fmt$(d.permADS)})`} accent="#8B2500" />
            <Row label="Cash Flow After DS" value={fmtNeg$(d.cashFlow)} bold accent={d.cashFlow >= 0 ? "#1a6b3c" : "#8B2500"} />
          </Section>

          <Section title="Unit Mix by Type">
            {Object.entries(d.byType).map(([type, count]) => (
              <Row key={type} label={type} value={count}
                sub={d.totalUnits > 0 ? fmtPct(count / d.totalUnits) : undefined} />
            ))}
            <div style={{ borderTop: "1px solid #e0e0e0", padding: "6px 14px",
              fontSize: 9, fontWeight: 700, color: "#888", textTransform: "uppercase",
              letterSpacing: "0.06em" }}>
              Affordability
            </div>
            {Object.entries(d.byAMI).map(([ami, count]) => (
              <Row key={ami} label={ami} value={count}
                sub={d.totalUnits > 0 ? fmtPct(count / d.totalUnits) : undefined} />
            ))}
          </Section>
        </div>

      </div>

      {/* ── ROW 2: Debt & Equity + Underwriting + Disposition (3 cols) ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 16 }}>
        <div>
          <Section title="Debt & Equity Assumptions">
            <div style={{ borderBottom: "1px solid #e0e0e0", padding: "6px 14px",
              fontSize: 9, fontWeight: 700, color: "#888", textTransform: "uppercase" }}>
              Construction
            </div>
            <Row label="Combined Const. Loan" value={fmt$(d.combinedCL)} />
            <Row label="TE Bond Amount" value={fmt$(d.teLoan)} indent />
            <Row label="Taxable Construction" value={fmt$(d.taxLoan)} indent />
            <Row label="LTC %" value={fmtPct(d.ltcPct)} />
            <Row label="TE Rate" value={fmtPct(d.construction.te_rate || 0.0585)} />

            <div style={{ borderBottom: "1px solid #e0e0e0", borderTop: "1px solid #e0e0e0", padding: "6px 14px",
              fontSize: 9, fontWeight: 700, color: "#888", textTransform: "uppercase", marginTop: 4 }}>
              Permanent
            </div>
            <Row label="Perm Loan Amount" value={fmt$(d.permLoan)} />
            <Row label="Rate" value={fmtPct(d.permRate)} />
            <Row label="Amortization" value={`${d.permAmort} years`} />
            <Row label="DSCR Target" value={fmtX(d.permDSCR_target)} />
            <Row label="Actual DSCR" value={fmtX(d.dscr)}
              accent={d.dscr >= d.permDSCR_target ? "#1a6b3c" : "#8B2500"} />

            <div style={{ borderBottom: "1px solid #e0e0e0", borderTop: "1px solid #e0e0e0", padding: "6px 14px",
              fontSize: 9, fontWeight: 700, color: "#888", textTransform: "uppercase", marginTop: 4 }}>
              Tax Credits
            </div>
            <Row label="Credit Type" value="4% LIHTC" />
            <Row label="Investor Pricing" value={`$${(d.lihtcInputs.investor_price || 0.82).toFixed(2)}`} />
            <Row label="Annual Credit" value={fmt$(d.lihtc.annualCredit)} />
            <Row label="10-Year Credit" value={fmt$(d.lihtc.totalCredit)} />
            <Row label="Equity Raised" value={fmt$(d.fedEquity)} accent="#1a6b3c" />
            <Row label="Bond Test" value={`${fmtPct(d.lihtc.bondPct)} ${d.lihtc.bondTestPass ? "✓" : "✗"}`}
              accent={d.lihtc.bondTestPass ? "#1a6b3c" : "#8B2500"} />
          </Section>
        </div>

        <div>
          <Section title="Underwriting Notes">
            <Row label="TDC / Unit" value={fmt$(d.bc.tdc / d.totalUnits)} />
            <Row label="HC / Unit" value={fmt$(d.bc.hcTotal / d.totalUnits)} />
            <Row label="Avg Rent / Mo" value={fmt$(d.avgRent)} />
            <Row label="OpEx PUPY" value={fmt$(d.y1.totalOpex / d.totalUnits)} />
            <Row label="Vacancy Rate" value={fmtPct(d.y1.vacancy / d.y1.adjustedIncome)} />
            <Row label="Revenue Escalation" value={fmtPct((moduleStates.proforma || {}).revenue_escalation || 0.02)} />
            <Row label="Expense Escalation" value={fmtPct((moduleStates.proforma || {}).expense_escalation || 0.03)} />
            <Row label="Dev Fee % of Cost" value={fmtPct(d.bc.devFee / d.bc.subtotal)} />
            <Row label="DDF % of Dev Fee" value={fmtPct(d.ddf / d.bc.devFee)} />
          </Section>
        </div>

        <div>
          <Section title="Disposition Summary">
            <Row label="Exit Year" value={d.exitYear} />
            <Row label="Exit NOI (Yr 15)" value={fmt$(d.exitNOI)} />
            <Row label="Gross Property Value" value={fmt$(d.grossValue)} />
            <Row label="Less: Cost of Sale" value={`(${fmt$(d.costOfSale)})`} accent="#8B2500" />
            <Row label="Less: Loan Payoff" value={`(${fmt$(d.loanBal)})`} accent="#8B2500" />
            <Row label="Net Sale Proceeds" value={fmt$(d.netProceeds)} bold accent="#1a6b3c" />
            <Row label="GP Promote (90%)" value={fmt$(d.gpPromote)} accent="#1a6b3c" />
          </Section>
        </div>
      </div>

      {/* ── SCHEDULE (if phases exist) ── */}
      {d.phases.length > 0 && (
        <Section title="Project Schedule">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 0 }}>
            {d.phases.filter(p => p.name && p.startDate).slice(0, 12).map((phase, i) => (
              <div key={i} style={{
                padding: "8px 14px", borderBottom: "1px solid #f0f0f0",
                borderRight: "1px solid #f0f0f0",
              }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: "#333", marginBottom: 2 }}>{phase.name}</div>
                <div style={{ fontSize: 9, color: "#888" }}>
                  {phase.startDate} → {phase.endDate || "TBD"}
                  {phase.duration > 0 && ` · ${phase.duration}mo`}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* ── PROJECT DESCRIPTION ── */}
      <div style={{ marginTop: 16, background: "white", border: "1px solid #e0e0e0", borderRadius: 6, padding: "16px 20px" }}>
        <div style={{
          fontSize: 10, fontWeight: 700, color: "#1a3a6b", textTransform: "uppercase",
          letterSpacing: "0.08em", marginBottom: 8, fontFamily: "Inter, sans-serif",
        }}>Description</div>
        <p style={{ fontSize: 10, color: "#555", lineHeight: 1.6, margin: 0, fontFamily: "Inter, sans-serif" }}>
          Apollo Scriber Lake is a proposed multifamily residential development located in Lynnwood, Washington.
          The project envisions a contemporary apartment community delivering {d.totalUnits} new rental homes
          to meet the growing demand for high-quality housing in the Scriber Lake and City Center district.
          Designed as a transit-oriented development within minutes of the Lynnwood Link light rail extension,
          the project prioritizes efficient unit layouts, modern amenities, and a pedestrian-friendly site plan.
          Parking will be provided at a ratio of 0.36 stalls per unit to support affordability goals and encourage transit use.
        </p>
      </div>
    </div>
  );
}
