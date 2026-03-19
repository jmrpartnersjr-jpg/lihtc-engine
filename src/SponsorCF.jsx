/**
 * SponsorCF.jsx — Module 11: Project & Sponsor Cash Flow
 *
 * Investor waterfall and GP/Sponsor returns analysis.
 * Recomputes the 15-year proforma waterfall inline, then layers on
 * disposition proceeds, LP/GP splits, and sponsor cash flow stream
 * to derive Project IRR, Sponsor NPV, and GP promote.
 */
import { useState, useMemo } from "react";
import { useLihtc } from "./context/LihtcContext.jsx";
import { computeBudgetCalcs } from "./lihtcCalcs.js";

/* ── formatters ──────────────────────────────────────────────── */
const fmt$ = v => v == null ? "\u2014" : "$" + Math.round(Math.abs(v)).toLocaleString();
const fmtNeg$ = v => {
  if (v == null) return "\u2014";
  const abs = Math.round(Math.abs(v));
  if (abs === 0) return "\u2014";
  return v < 0 ? `($${abs.toLocaleString()})` : `$${abs.toLocaleString()}`;
};
const fmtPct = v => v == null ? "\u2014" : (v * 100).toFixed(1) + "%";
const fmtX = v => v == null ? "\u2014" : v.toFixed(2) + "x";

/* ── defaults ────────────────────────────────────────────────── */
const DEFAULT_SPONSOR_CF = {
  gp_equity_investment: 3000000,
  cash_fee_yr1_pct: 0.25,
  cash_fee_yr3_pct: 0.75,
  leaseup_noi_pct: 0.25,
  discount_rate: 0.15,
  gp_promote_pct: 0.90,
  show_gp_splits: false,
  gp_members: [
    { name: "BFC", pct: 0.80 },
    { name: "Johnny", pct: 0.20 },
  ],
  exit_year: 15,
  exit_cap_rate: 0.0625,
  cost_of_sale_pct: 0.035,
  lp_exit_tax: 1000000,
};

/* ── Proforma defaults (mirrored from Proforma.jsx) ──────────── */
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

const DEFAULT_PROFORMA = {
  revenue_escalation:         0.02,
  expense_escalation:         0.03,
  vacancy_rate:               0.06,
  replacement_reserve_per_unit: 350,
  reserve_escalation:         0.03,
  ddf_payoff_pct:             1.0,
  opex_lines:                 DEFAULT_OPEX_LINES,
  other_income:               DEFAULT_OTHER_INCOME,
  custom_opex:                [],
  custom_other_income:        [],
  lp_partnership_fee:         17500,
  gp_management_fee:          17500,
  adjustment_escalation:      0.03,
  sub_loan_rules:             [],
};

/* ── annual debt service ─────────────────────────────────────── */
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

/* ── loan balance at year T ──────────────────────────────────── */
function loanBalance(principal, annualRate, amortYears, yearsElapsed) {
  if (!principal || !annualRate || !amortYears) return principal || 0;
  const r = annualRate / 12;
  const n = amortYears * 12;
  const t = yearsElapsed * 12;
  return principal * (Math.pow(1 + r, n) - Math.pow(1 + r, t)) / (Math.pow(1 + r, n) - 1);
}

/* ── IRR via Newton's method ─────────────────────────────────── */
function computeIRR(cashflows, guess = 0.15, maxIter = 100, tol = 1e-6) {
  let rate = guess;
  for (let i = 0; i < maxIter; i++) {
    let npv = 0, dnpv = 0;
    for (let t = 0; t < cashflows.length; t++) {
      const disc = Math.pow(1 + rate, t);
      npv += cashflows[t] / disc;
      dnpv -= t * cashflows[t] / (disc * (1 + rate));
    }
    if (Math.abs(npv) < tol) return rate;
    if (Math.abs(dnpv) < 1e-12) return null;
    rate -= npv / dnpv;
    if (rate < -0.99 || rate > 10) return null;
  }
  return null;
}

/* ── NPV ─────────────────────────────────────────────────────── */
function computeNPV(cashflows, rate) {
  return cashflows.reduce((sum, cf, t) => sum + cf / Math.pow(1 + rate, t), 0);
}

/* ── compute 15-year proforma (same as Proforma.jsx) ─────────── */
function computeProforma(inputs, grossRent, totalUnits, permLoan, permRate, permAmort, subdebt, deferredDevFee, subLoanRules) {
  const p = inputs;
  const years = [];
  let ddfBalance = deferredDevFee || 0;
  let ddfPaidYear = null;

  const subLoanBalances = {};
  (subLoanRules || []).forEach(rule => {
    const loan = (subdebt || []).find(l => l.id === rule.loan_id);
    subLoanBalances[rule.loan_id] = loan?.amount || 0;
  });

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

    const residentialRev = (grossRent || 0) * escalR;
    const totalRev = residentialRev;

    let totalOtherIncome = 0;
    [...otherIncomeLines, ...customOtherIncome].forEach(item => {
      totalOtherIncome += (item.annual || 0) * (item.escalates !== false ? escalR : 1);
    });

    const adjustedIncome = totalRev + totalOtherIncome;
    const vacancy = adjustedIncome * (p.vacancy_rate || 0.05);
    const egi = adjustedIncome - vacancy;

    let totalOpex = 0;
    [...opexLines, ...customOpex].forEach(line => {
      if (line.is_pct_egi) {
        totalOpex += egi * (line.pct || 0);
      } else {
        totalOpex += (line.amount || 0) * (line.escalates !== false ? escalE : 1);
      }
    });
    const repReserve = totalUnits * (p.replacement_reserve_per_unit || 350) * escalRes;
    totalOpex += repReserve;

    const noi = egi - totalOpex;
    const totalADS = seniorADS;
    const seniorDSCR = seniorADS > 0 ? noi / seniorADS : 0;
    const cashFlow = noi - totalADS;

    // DDF payoff
    const ddfPayment = cashFlow > 0
      ? Math.min(cashFlow * (p.ddf_payoff_pct ?? 1.0), ddfBalance)
      : 0;
    ddfBalance = Math.max(0, ddfBalance - ddfPayment);
    if (ddfBalance <= 0 && ddfPaidYear === null && deferredDevFee > 0) {
      ddfPaidYear = yr;
    }

    let residualAfterDDF = cashFlow - ddfPayment;

    // Sub loan waterfall
    const subLoanPayments = {};
    if (ddfBalance <= 0 && residualAfterDDF > 0 && subLoanRules?.length > 0) {
      subLoanRules.forEach(rule => {
        const balance = subLoanBalances[rule.loan_id] || 0;
        if (balance <= 0) { subLoanPayments[rule.loan_id] = 0; return; }
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
      year: yr, noi, egi, seniorADS, totalADS, seniorDSCR,
      cashFlow, ddfPayment, ddfBalance,
      subLoanPayments,
      lpFee, gpFee, totalAdjustments, adjustedCF,
      residualCF: residualAfterDDF,
    });
  }

  return { years, ddfPaidYear, seniorADS, subLoanBalances };
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

/* ── table row component ─────────────────────────────────────── */
function WaterfallRow({ label, cols, getter, bold, heavy, border, deduct, accent, signed, cellColor, indent }) {
  const labelStyle = {
    padding: bold ? "5px 10px" : "4px 10px 4px 16px",
    textAlign: "left", fontSize: 10, whiteSpace: "nowrap",
    fontWeight: bold ? 700 : 400,
    color: accent || (deduct && !bold ? "#888" : bold ? "#111" : "#333"),
    ...(border ? { borderTop: "1px solid #ddd" } : {}),
    ...(heavy ? { borderTop: "2px solid #333" } : {}),
    position: "sticky", left: 0, background: "white", zIndex: 1,
    paddingLeft: indent ? 24 : (bold ? 10 : 16),
  };

  return (
    <tr>
      <td style={labelStyle}>{label}</td>
      {cols.map((c, i) => {
        const v = getter(c);
        const color = cellColor ? cellColor(c) : (accent || (deduct && !bold ? "#888" : bold ? "#111" : "#333"));
        return (
          <td key={i} style={{
            padding: bold ? "5px 10px" : "4px 10px",
            textAlign: "right", fontSize: 10, fontFamily: "Inter, sans-serif",
            fontWeight: bold ? 700 : 400, color, whiteSpace: "nowrap",
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

/* ══════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ══════════════════════════════════════════════════════════════ */
export default function SponsorCFPanel() {
  const { moduleStates, updateModule } = useLihtc();

  // ── Pull sponsor CF inputs ──
  const saved = moduleStates.sponsor_cf || {};
  const sc = { ...DEFAULT_SPONSOR_CF, ...saved };
  const update = patch => updateModule("sponsor_cf", { ...sc, ...patch });

  // ── Pull proforma inputs ──
  const pfSaved = moduleStates.proforma || {};
  const pf = { ...DEFAULT_PROFORMA, ...pfSaved };
  const subLoanRules = pf.sub_loan_rules || [];

  // ── Unit Mix → Gross Rent ──
  const unitMix = moduleStates.unit_mix;
  const rows = unitMix?.rows ?? [];
  const totalUnits = rows.reduce((s, r) => s + (r.count || 0), 0) || 175;
  const grossRent = unitMix?.computed_annual_revenue || 0;

  // ── Debt module ──
  const debt = moduleStates.debt || {};
  const permanent = debt.permanent || debt.permanent_loan || {};
  const permLoan = permanent.loan_amount || 0;
  const permRate = permanent.rate || 0.0585;
  const permAmort = permanent.amort_years || permanent.amortization_years || 40;
  const rawSubdebt = debt.subdebt || debt.soft_debt || [];

  // Find seller note and sponsor note from subdebt
  const sellerNote = rawSubdebt.find(l =>
    l.label?.toLowerCase().includes("seller") || l.name?.toLowerCase().includes("seller")
  );
  const sponsorNote = rawSubdebt.find(l =>
    l.label?.toLowerCase().includes("sponsor") || l.name?.toLowerCase().includes("sponsor")
  );
  const sellerNoteAmt = sellerNote?.amount || 0;
  const sponsorNoteAmt = sponsorNote?.amount || 0;

  // ── Budget → DDF, Dev Fee ──
  const budget = moduleStates.budget;
  const bc = computeBudgetCalcs(budget, totalUnits);
  const deferredDevFee = bc.deferredDevFee || 0;
  const devFee = bc.devFee || 0;
  const cashDevFee = bc.cashDevFee || devFee * (sc.cash_fee_yr1_pct + sc.cash_fee_yr3_pct);

  // ── Disposition inputs ──
  const dispo = moduleStates.disposition || {};
  const exitYear = sc.exit_year || dispo.exit_year || 15;
  const exitCapRate = sc.exit_cap_rate || dispo.exit_cap_rate || 0.0625;
  const costOfSalePct = sc.cost_of_sale_pct || dispo.cost_of_sale_pct || 0.035;
  const lpExitTax = sc.lp_exit_tax ?? dispo.lp_exit_tax ?? 1000000;
  const gpPromotePct = sc.gp_promote_pct;
  const lpPromotePct = 1 - gpPromotePct;

  // ── Compute 15-year proforma ──
  const result = useMemo(
    () => computeProforma(pf, grossRent, totalUnits, permLoan, permRate, permAmort, rawSubdebt, deferredDevFee, subLoanRules),
    [pf, grossRent, totalUnits, permLoan, permRate, permAmort, rawSubdebt, deferredDevFee, subLoanRules]
  );

  // ── Compute disposition ──
  const dispoCalc = useMemo(() => {
    const exitYrData = result.years[exitYear - 1] || result.years[result.years.length - 1];
    const exitNOI = exitYrData?.noi || 0;
    const grossValue = exitCapRate > 0 ? exitNOI / exitCapRate : 0;
    const costOfSale = grossValue * costOfSalePct;
    const debtPayoff = loanBalance(permLoan, permRate, permAmort, exitYear);
    const netProceeds = grossValue - costOfSale - debtPayoff;

    // Remaining sub loan balances at exit
    const sellerNoteBalance = result.subLoanBalances?.[sellerNote?.id] ?? sellerNoteAmt;
    const sponsorNoteBalance = result.subLoanBalances?.[sponsorNote?.id] ?? sponsorNoteAmt;

    const afterPayoffs = netProceeds - sellerNoteBalance - sponsorNoteBalance - lpExitTax;
    const lpIncentive = Math.max(0, afterPayoffs) * lpPromotePct;
    const gpPromote = Math.max(0, afterPayoffs) * gpPromotePct;

    return {
      exitNOI, grossValue, costOfSale, debtPayoff, netProceeds,
      sellerNoteBalance, sponsorNoteBalance,
      afterPayoffs, lpIncentive, gpPromote,
    };
  }, [result, exitYear, exitCapRate, costOfSalePct, permLoan, permRate, permAmort,
      sellerNoteAmt, sponsorNoteAmt, lpExitTax, gpPromotePct, lpPromotePct,
      sellerNote?.id, sponsorNote?.id]);

  // ── Build sponsor CF stream (Year 0 through exit year) ──
  const sponsorStream = useMemo(() => {
    const stream = new Array(exitYear + 1).fill(0);

    // Year 0: GP equity investment (outflow)
    stream[0] = -(sc.gp_equity_investment || 0);

    // Cash dev fee tranches
    const totalCashFee = devFee * (sc.cash_fee_yr1_pct + sc.cash_fee_yr3_pct);
    const yr1CashFee = devFee * sc.cash_fee_yr1_pct;
    const yr3CashFee = devFee * sc.cash_fee_yr3_pct;
    if (exitYear >= 1) stream[1] += yr1CashFee;
    if (exitYear >= 3) stream[3] += yr3CashFee;

    // DDF payment receipts
    for (let yr = 1; yr <= Math.min(exitYear, 15); yr++) {
      const yrData = result.years[yr - 1];
      if (yrData) stream[yr] += yrData.ddfPayment;
    }

    // GP incentive management fees (from proforma adjustments, years 14-15)
    for (let yr = Math.max(1, exitYear - 1); yr <= Math.min(exitYear, 15); yr++) {
      const yrData = result.years[yr - 1];
      if (yrData) stream[yr] += yrData.gpFee;
    }

    // GP promote from disposition at exit year
    stream[exitYear] += dispoCalc.gpPromote;

    return stream;
  }, [sc, devFee, result, exitYear, dispoCalc]);

  // ── IRR & NPV ──
  const projectIRR = useMemo(() => computeIRR(sponsorStream), [sponsorStream]);
  const sponsorNPV = useMemo(() => computeNPV(sponsorStream, sc.discount_rate), [sponsorStream, sc.discount_rate]);

  // ── Cumulative sponsor CF ──
  const cumulativeSponsorCF = useMemo(() => {
    const cum = [];
    let running = 0;
    for (let i = 0; i <= exitYear; i++) {
      running += sponsorStream[i];
      cum.push(running);
    }
    return cum;
  }, [sponsorStream, exitYear]);

  // ── Per-year detail for DDF, sub loans, cash dev fee ──
  const yearDetails = useMemo(() => {
    const details = [];
    const yr1CashFee = devFee * sc.cash_fee_yr1_pct;
    const yr3CashFee = devFee * sc.cash_fee_yr3_pct;

    for (let yr = 1; yr <= Math.min(exitYear, 15); yr++) {
      const yrData = result.years[yr - 1];
      details.push({
        year: yr,
        noi: yrData?.noi || 0,
        ads: yrData?.totalADS || 0,
        cashFlow: yrData?.cashFlow || 0,
        lpFee: yrData?.lpFee || 0,
        gpFee: yrData?.gpFee || 0,
        leaseupAdj: yr === 1 ? (yrData?.noi || 0) * sc.leaseup_noi_pct : 0,
        adjustedCF: yrData?.adjustedCF || 0,
        ddfPayment: yrData?.ddfPayment || 0,
        ddfBalance: yrData?.ddfBalance || 0,
        sellerNotePayment: yrData?.subLoanPayments?.[sellerNote?.id] || 0,
        sponsorNotePayment: yrData?.subLoanPayments?.[sponsorNote?.id] || 0,
        residualCF: yrData?.residualCF || 0,
        cashDevFee: yr === 1 ? yr1CashFee : (yr === 3 ? yr3CashFee : 0),
        sponsorCF: sponsorStream[yr] || 0,
        cumulativeCF: cumulativeSponsorCF[yr] || 0,
      });
    }
    return details;
  }, [result, exitYear, devFee, sc, sponsorStream, cumulativeSponsorCF, sellerNote?.id, sponsorNote?.id]);

  // ── Total dev fee income (cash + DDF received) ──
  const totalDDFReceived = yearDetails.reduce((s, d) => s + d.ddfPayment, 0);
  const totalDevFeeIncome = devFee * sc.cash_fee_yr1_pct + devFee * sc.cash_fee_yr3_pct + totalDDFReceived;

  // ── Table display state ──
  const [showAllYears, setShowAllYears] = useState(false);
  const [showInputs, setShowInputs] = useState(true);
  const displayDetails = showAllYears
    ? yearDetails
    : yearDetails.filter(y => y.year <= 5 || y.year === 10 || y.year === 15);

  // ── GP member splits ──
  const gpMembers = sc.gp_members || [];

  // ── Styles ──
  const hdrCell = { padding: "6px 10px", textAlign: "right", fontSize: 9, fontWeight: 700, color: "#888", letterSpacing: "0.04em", whiteSpace: "nowrap", borderBottom: "2px solid #333" };
  const labelCellSection = {
    padding: "4px 10px 4px 10px", textAlign: "left", fontSize: 9, fontWeight: 700,
    color: "#888", textTransform: "uppercase", letterSpacing: "0.06em", paddingTop: 10, whiteSpace: "nowrap",
  };
  const separatorRow = { height: 6 };
  const cardStyle = { background: "white", border: "1px solid #e0e0e0", borderRadius: 6, overflow: "hidden" };

  return (
    <div style={{ fontFamily: "Inter, sans-serif" }}>

      {/* ── HEADER ── */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 20, fontWeight: 400, color: "#111", margin: 0 }}>
            Project & Sponsor Cash Flow
          </h2>
          <span style={{ fontSize: 9, color: "#aaa", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            MODULE 11 &middot; INVESTOR WATERFALL & RETURNS
          </span>
        </div>
      </div>

      {/* ── METRICS BAR ── */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        {[
          {
            label: "Project IRR",
            value: projectIRR != null ? fmtPct(projectIRR) : "N/A",
            sub: "Sponsor cash flow stream",
            accent: projectIRR != null && projectIRR >= 0.10 ? "#1a6b3c" : "#8B2500",
            bg: projectIRR != null && projectIRR >= 0.10 ? "#f0f9f4" : "#fce8e3",
            border: projectIRR != null && projectIRR >= 0.10 ? "#b8dfc8" : "#f5c2b0",
          },
          {
            label: `Sponsor NPV @ ${fmtPct(sc.discount_rate)}`,
            value: fmtNeg$(sponsorNPV),
            sub: "Net present value",
            accent: sponsorNPV >= 0 ? "#1a6b3c" : "#8B2500",
            bg: sponsorNPV >= 0 ? "#f0f9f4" : "#fce8e3",
            border: sponsorNPV >= 0 ? "#b8dfc8" : "#f5c2b0",
          },
          {
            label: "GP Promote",
            value: fmt$(dispoCalc.gpPromote),
            sub: `${fmtPct(gpPromotePct)} of disposition CF`,
            accent: "#1a3a6b", bg: "#f0f3f9", border: "#b8c8e0",
          },
          {
            label: "Total Dev Fee Income",
            value: fmt$(totalDevFeeIncome),
            sub: `Cash + DDF receipts`,
            accent: "#5a3a00", bg: "#fdf8ef", border: "#e8d5a8",
          },
        ].map(m => (
          <div key={m.label} style={{ background: m.bg, border: `1px solid ${m.border}`, borderRadius: 6, padding: "8px 12px", flex: "1 1 160px", minWidth: 160 }}>
            <div style={{ fontSize: 8, color: m.accent, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>{m.label}</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: m.accent }}>{m.value}</div>
            {m.sub && <div style={{ fontSize: 8, color: "#888", marginTop: 2 }}>{m.sub}</div>}
          </div>
        ))}
      </div>

      {/* ── TOGGLE BUTTONS ── */}
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

      {/* ── INPUTS PANEL ── */}
      {showInputs && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 16 }}>

          {/* Sponsor / GP Inputs */}
          <div style={{ ...cardStyle, padding: "12px 14px" }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: "#1a3a6b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
              Sponsor / GP Inputs
            </div>
            {[
              { label: "GP Equity Investment", val: sc.gp_equity_investment, key: "gp_equity_investment", prefix: "$", step: 100000 },
              { label: "Cash Dev Fee Yr 1 %", val: sc.cash_fee_yr1_pct, key: "cash_fee_yr1_pct", pct: true },
              { label: "Cash Dev Fee Yr 3 %", val: sc.cash_fee_yr3_pct, key: "cash_fee_yr3_pct", pct: true },
              { label: "Discount Rate (NPV)", val: sc.discount_rate, key: "discount_rate", pct: true },
            ].map(f => (
              <div key={f.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                <div style={{ fontSize: 10, color: "#444" }}>{f.label}</div>
                <TinyInput value={f.val} onChange={v => update({ [f.key]: v })} pct={f.pct} prefix={f.prefix} suffix={f.pct ? "%" : undefined} width={f.pct ? 60 : 100} step={f.step} />
              </div>
            ))}
          </div>

          {/* Disposition Inputs */}
          <div style={{ ...cardStyle, padding: "12px 14px" }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: "#8B2500", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
              Disposition / Exit
            </div>
            {[
              { label: "Exit Year", val: sc.exit_year, key: "exit_year", step: 1, width: 50 },
              { label: "Exit Cap Rate", val: sc.exit_cap_rate, key: "exit_cap_rate", pct: true },
              { label: "Cost of Sale", val: sc.cost_of_sale_pct, key: "cost_of_sale_pct", pct: true },
              { label: "GP Promote %", val: sc.gp_promote_pct, key: "gp_promote_pct", pct: true },
              { label: "LP Exit Tax", val: sc.lp_exit_tax, key: "lp_exit_tax", prefix: "$", step: 100000 },
            ].map(f => (
              <div key={f.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                <div style={{ fontSize: 10, color: "#444" }}>{f.label}</div>
                <TinyInput value={f.val} onChange={v => update({ [f.key]: v })} pct={f.pct} prefix={f.prefix} suffix={f.pct ? "%" : undefined} width={f.width || (f.pct ? 60 : 100)} step={f.step} />
              </div>
            ))}
            <div style={{ borderTop: "1px solid #eee", marginTop: 8, paddingTop: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10 }}>
                <span style={{ color: "#888" }}>LP Incentive %</span>
                <span style={{ fontWeight: 600 }}>{fmtPct(lpPromotePct)}</span>
              </div>
            </div>
          </div>

          {/* GP Member Splits */}
          <div style={{ ...cardStyle, padding: "12px 14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: "#5a3a00", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                GP Member Splits
              </span>
              <button
                onClick={() => update({ show_gp_splits: !sc.show_gp_splits })}
                style={{
                  background: sc.show_gp_splits ? "#1a3a6b" : "none",
                  color: sc.show_gp_splits ? "white" : "#888",
                  border: "1px solid #ddd", borderRadius: 3,
                  padding: "2px 8px", fontSize: 8, cursor: "pointer",
                }}
              >
                {sc.show_gp_splits ? "ON" : "OFF"}
              </button>
            </div>
            {gpMembers.map((member, idx) => (
              <div key={idx} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <input
                  value={member.name}
                  onChange={e => {
                    const updated = [...gpMembers];
                    updated[idx] = { ...member, name: e.target.value };
                    update({ gp_members: updated });
                  }}
                  style={{ fontSize: 10, border: "1px solid #eee", borderRadius: 3, padding: "2px 6px", width: 80, outline: "none" }}
                />
                <TinyInput
                  value={member.pct}
                  onChange={v => {
                    const updated = [...gpMembers];
                    updated[idx] = { ...member, pct: v };
                    update({ gp_members: updated });
                  }}
                  pct suffix="%" width={50}
                />
              </div>
            ))}
            <button
              onClick={() => update({ gp_members: [...gpMembers, { name: "New", pct: 0 }] })}
              style={{
                background: "none", border: "1px solid #ddd", borderRadius: 3,
                padding: "2px 6px", fontSize: 8, color: "#888", cursor: "pointer", marginTop: 4,
              }}
            >
              + Add Member
            </button>
            <div style={{ borderTop: "1px solid #eee", marginTop: 8, paddingTop: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10 }}>
                <span style={{ color: "#888" }}>Total Allocation</span>
                <span style={{ fontWeight: 600, color: Math.abs(gpMembers.reduce((s, m) => s + m.pct, 0) - 1) < 0.001 ? "#1a6b3c" : "#8B2500" }}>
                  {fmtPct(gpMembers.reduce((s, m) => s + m.pct, 0))}
                </span>
              </div>
            </div>

            {/* Read-only computed info */}
            <div style={{ borderTop: "1px solid #eee", marginTop: 6, paddingTop: 6, fontSize: 9, color: "#999" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                <span>Dev Fee (Total)</span><span>{fmt$(devFee)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                <span>Cash Dev Fee ({fmtPct(sc.cash_fee_yr1_pct + sc.cash_fee_yr3_pct)})</span><span>{fmt$(devFee * (sc.cash_fee_yr1_pct + sc.cash_fee_yr3_pct))}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>Deferred Dev Fee</span><span>{fmt$(deferredDevFee)}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════
         TRANSPOSED WATERFALL TABLE
         ══════════════════════════════════════════════════════════════ */}
      <div style={{ ...cardStyle, padding: 0, marginBottom: 16 }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", fontSize: 10, width: "100%", minWidth: 800 }}>
            <thead>
              <tr>
                <th style={{ ...hdrCell, textAlign: "left", minWidth: 200, position: "sticky", left: 0, background: "white", zIndex: 1 }}>
                  PROJECT CASH FLOW
                </th>
                {displayDetails.map(d => (
                  <th key={d.year} style={hdrCell}>EOY {d.year}</th>
                ))}
              </tr>
            </thead>
            <tbody>

              {/* ── OPERATING CF ── */}
              <tr>
                <td style={labelCellSection} colSpan={displayDetails.length + 1}>Operating Cash Flow</td>
              </tr>
              <WaterfallRow label="Net Operating Income" cols={displayDetails} getter={d => d.noi} bold accent="#1a6b3c" />
              <WaterfallRow label="ADS (Senior)" cols={displayDetails} getter={d => -d.ads} deduct />
              <WaterfallRow label="Cash Flow" cols={displayDetails} getter={d => d.cashFlow} bold heavy signed />

              {/* ── SEPARATOR ── */}
              <tr><td style={separatorRow} colSpan={displayDetails.length + 1} /></tr>

              {/* ── ADJUSTMENTS ── */}
              <tr>
                <td style={labelCellSection} colSpan={displayDetails.length + 1}>Adjustments</td>
              </tr>
              <WaterfallRow label="LP Partnership Mgt Fee" cols={displayDetails} getter={d => -d.lpFee} deduct />
              <WaterfallRow label="GP Management Fee" cols={displayDetails} getter={d => -d.gpFee} deduct />
              {sc.leaseup_noi_pct > 0 && (
                <WaterfallRow label={`Lease-up NOI Adj (${fmtPct(sc.leaseup_noi_pct)})`} cols={displayDetails}
                  getter={d => d.year === 1 ? -d.leaseupAdj : 0} deduct />
              )}
              <WaterfallRow label="Adjusted Cash Flow" cols={displayDetails} getter={d => {
                const adj = d.adjustedCF - (d.year === 1 ? d.leaseupAdj : 0);
                return adj;
              }} bold heavy signed accent="#5a3a00" />

              {/* ── SEPARATOR ── */}
              <tr><td style={separatorRow} colSpan={displayDetails.length + 1} /></tr>

              {/* ── CF WATERFALL ── */}
              <tr>
                <td style={labelCellSection} colSpan={displayDetails.length + 1}>Cash Flow Waterfall</td>
              </tr>
              <WaterfallRow label="DDF Payment" cols={displayDetails} getter={d => -d.ddfPayment} deduct />
              <WaterfallRow label="DDF Balance" cols={displayDetails} getter={d => d.ddfBalance} bold
                cellColor={d => d.ddfBalance <= 0 ? "#1a6b3c" : "#5a3a00"} />
              {sellerNoteAmt > 0 && (
                <WaterfallRow label="Seller Note Payment" cols={displayDetails} getter={d => -d.sellerNotePayment} deduct />
              )}
              {sponsorNoteAmt > 0 && (
                <WaterfallRow label="Sponsor Note Payment" cols={displayDetails} getter={d => -d.sponsorNotePayment} deduct />
              )}
              <WaterfallRow label="Remainder" cols={displayDetails} getter={d => d.residualCF} bold border signed />

              {/* ── SEPARATOR ── */}
              <tr><td style={separatorRow} colSpan={displayDetails.length + 1} /></tr>

              {/* ── DISPOSITION ── */}
              <tr>
                <td style={labelCellSection} colSpan={displayDetails.length + 1}>
                  Disposition (Year {exitYear})
                </td>
              </tr>
              <WaterfallRow label="Exit NOI" cols={displayDetails}
                getter={d => d.year === exitYear ? dispoCalc.exitNOI : 0} />
              <WaterfallRow label={`Gross Value (${fmtPct(exitCapRate)} cap)`} cols={displayDetails}
                getter={d => d.year === exitYear ? dispoCalc.grossValue : 0} />
              <WaterfallRow label={`Cost of Sale (${fmtPct(costOfSalePct)})`} cols={displayDetails}
                getter={d => d.year === exitYear ? -dispoCalc.costOfSale : 0} deduct />
              <WaterfallRow label="Debt Payoff" cols={displayDetails}
                getter={d => d.year === exitYear ? -dispoCalc.debtPayoff : 0} deduct />
              <WaterfallRow label="Net Proceeds" cols={displayDetails}
                getter={d => d.year === exitYear ? dispoCalc.netProceeds : 0} bold border signed />
              {sellerNoteAmt > 0 && (
                <WaterfallRow label="Less: Seller Note Balance" cols={displayDetails}
                  getter={d => d.year === exitYear ? -dispoCalc.sellerNoteBalance : 0} deduct indent />
              )}
              {sponsorNoteAmt > 0 && (
                <WaterfallRow label="Less: Sponsor Note Balance" cols={displayDetails}
                  getter={d => d.year === exitYear ? -dispoCalc.sponsorNoteBalance : 0} deduct indent />
              )}
              <WaterfallRow label="Less: LP Exit Tax" cols={displayDetails}
                getter={d => d.year === exitYear ? -lpExitTax : 0} deduct indent />
              <WaterfallRow label="Disposition CF Available" cols={displayDetails}
                getter={d => d.year === exitYear ? dispoCalc.afterPayoffs : 0} bold heavy signed accent="#1a3a6b" />

              <tr><td style={separatorRow} colSpan={displayDetails.length + 1} /></tr>

              <WaterfallRow label={`LP Incentive (${fmtPct(lpPromotePct)})`} cols={displayDetails}
                getter={d => d.year === exitYear ? dispoCalc.lpIncentive : 0} indent />
              <WaterfallRow label={`GP Promote (${fmtPct(gpPromotePct)})`} cols={displayDetails}
                getter={d => d.year === exitYear ? dispoCalc.gpPromote : 0} bold accent="#1a3a6b" />

              {/* ── SEPARATOR ── */}
              <tr><td style={separatorRow} colSpan={displayDetails.length + 1} /></tr>
              <tr><td style={separatorRow} colSpan={displayDetails.length + 1} /></tr>

              {/* ── SPONSOR CF ── */}
              <tr>
                <td style={labelCellSection} colSpan={displayDetails.length + 1}>Sponsor Cash Flow</td>
              </tr>
              <WaterfallRow label="Cash Dev Fee" cols={displayDetails}
                getter={d => d.cashDevFee} />
              <WaterfallRow label="DDF Receipts" cols={displayDetails}
                getter={d => d.ddfPayment} />
              <WaterfallRow label="GP Incentive Mgt Fees" cols={displayDetails}
                getter={d => (d.year >= exitYear - 1 && d.year <= exitYear) ? d.gpFee : 0} />
              <WaterfallRow label="GP Promote (Disposition)" cols={displayDetails}
                getter={d => d.year === exitYear ? dispoCalc.gpPromote : 0} />
              <WaterfallRow label="Total Sponsor CF" cols={displayDetails}
                getter={d => d.sponsorCF} bold heavy signed accent="#1a3a6b" />
              <WaterfallRow label="Cumulative Sponsor CF" cols={displayDetails}
                getter={d => d.cumulativeCF} bold signed
                cellColor={d => d.cumulativeCF >= 0 ? "#1a6b3c" : "#8B2500"} />

              {/* ── GP MEMBER SPLITS ── */}
              {sc.show_gp_splits && gpMembers.length > 0 && (
                <>
                  <tr><td style={separatorRow} colSpan={displayDetails.length + 1} /></tr>
                  <tr>
                    <td style={labelCellSection} colSpan={displayDetails.length + 1}>GP Member Splits</td>
                  </tr>
                  {gpMembers.map((member, idx) => (
                    <WaterfallRow key={idx} label={`${member.name} (${fmtPct(member.pct)})`} cols={displayDetails}
                      getter={d => d.sponsorCF * member.pct} signed indent />
                  ))}
                </>
              )}

            </tbody>
          </table>
        </div>
      </div>

      {/* ── IRR / NPV SUMMARY CARD ── */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div style={{ ...cardStyle, padding: "14px 18px", flex: "1 1 280px", minWidth: 280 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: "#1a3a6b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>
            Returns Summary
          </div>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 10 }}>
            <tbody>
              {[
                { label: "GP Equity Investment", value: fmt$(sc.gp_equity_investment), color: "#333" },
                { label: "Cash Dev Fee (Total)", value: fmt$(devFee * (sc.cash_fee_yr1_pct + sc.cash_fee_yr3_pct)), color: "#333" },
                { label: "DDF Received", value: fmt$(totalDDFReceived), color: "#333" },
                { label: "GP Promote", value: fmt$(dispoCalc.gpPromote), color: "#1a3a6b" },
                { sep: true },
                { label: "Project Gross IRR", value: projectIRR != null ? fmtPct(projectIRR) : "N/A", color: projectIRR != null && projectIRR >= 0.10 ? "#1a6b3c" : "#8B2500", bold: true },
                { label: `NPV @ ${fmtPct(sc.discount_rate)}`, value: fmtNeg$(sponsorNPV), color: sponsorNPV >= 0 ? "#1a6b3c" : "#8B2500", bold: true },
                { label: "Cash Dev Fee Contribution", value: fmtPct(sc.cash_fee_yr1_pct + sc.cash_fee_yr3_pct), color: "#5a3a00" },
                { label: "DDF Paid Off By", value: result.ddfPaidYear ? `Year ${result.ddfPaidYear}` : "Not Paid", color: result.ddfPaidYear ? "#1a6b3c" : "#8B2500" },
              ].map((row, i) => {
                if (row.sep) {
                  return <tr key={i}><td colSpan={2} style={{ borderTop: "2px solid #333", padding: "4px 0" }} /></tr>;
                }
                return (
                  <tr key={i}>
                    <td style={{ padding: "3px 0", color: "#555", fontWeight: row.bold ? 700 : 400 }}>{row.label}</td>
                    <td style={{ padding: "3px 0", textAlign: "right", fontWeight: row.bold ? 700 : 400, color: row.color }}>{row.value}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Sponsor CF Stream (Year 0 through exit) */}
        <div style={{ ...cardStyle, padding: "14px 18px", flex: "1 1 400px", minWidth: 400 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: "#5a3a00", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>
            Sponsor CF Stream (IRR Inputs)
          </div>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 10 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "4px 8px", fontSize: 9, color: "#888", borderBottom: "1px solid #ddd" }}>Year</th>
                <th style={{ textAlign: "right", padding: "4px 8px", fontSize: 9, color: "#888", borderBottom: "1px solid #ddd" }}>Cash Flow</th>
                <th style={{ textAlign: "right", padding: "4px 8px", fontSize: 9, color: "#888", borderBottom: "1px solid #ddd" }}>Cumulative</th>
                {sc.show_gp_splits && gpMembers.map((m, i) => (
                  <th key={i} style={{ textAlign: "right", padding: "4px 8px", fontSize: 9, color: "#888", borderBottom: "1px solid #ddd" }}>{m.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Year 0 */}
              <tr style={{ background: "#fafafa" }}>
                <td style={{ padding: "3px 8px", fontWeight: 600 }}>Y0</td>
                <td style={{ padding: "3px 8px", textAlign: "right", color: "#8B2500", fontWeight: 600 }}>
                  {fmtNeg$(sponsorStream[0])}
                </td>
                <td style={{ padding: "3px 8px", textAlign: "right", color: cumulativeSponsorCF[0] >= 0 ? "#1a6b3c" : "#8B2500" }}>
                  {fmtNeg$(cumulativeSponsorCF[0])}
                </td>
                {sc.show_gp_splits && gpMembers.map((m, i) => (
                  <td key={i} style={{ padding: "3px 8px", textAlign: "right", color: "#888" }}>
                    {fmtNeg$(sponsorStream[0] * m.pct)}
                  </td>
                ))}
              </tr>
              {/* Years 1 through exit */}
              {(() => {
                const displayYrs = showAllYears
                  ? Array.from({ length: exitYear }, (_, i) => i + 1)
                  : [1, 2, 3, 4, 5, 10, 15].filter(y => y <= exitYear);
                return displayYrs.map(yr => (
                  <tr key={yr} style={{ background: yr % 2 === 0 ? "#fafafa" : "white" }}>
                    <td style={{ padding: "3px 8px", fontWeight: yr === exitYear ? 700 : 400 }}>Y{yr}</td>
                    <td style={{ padding: "3px 8px", textAlign: "right", fontWeight: yr === exitYear ? 700 : 400, color: sponsorStream[yr] >= 0 ? "#1a6b3c" : "#8B2500" }}>
                      {fmtNeg$(sponsorStream[yr])}
                    </td>
                    <td style={{ padding: "3px 8px", textAlign: "right", color: cumulativeSponsorCF[yr] >= 0 ? "#1a6b3c" : "#8B2500" }}>
                      {fmtNeg$(cumulativeSponsorCF[yr])}
                    </td>
                    {sc.show_gp_splits && gpMembers.map((m, i) => (
                      <td key={i} style={{ padding: "3px 8px", textAlign: "right", color: "#888" }}>
                        {fmtNeg$(sponsorStream[yr] * m.pct)}
                      </td>
                    ))}
                  </tr>
                ));
              })()}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── DDF PAYOFF NOTE ── */}
      {deferredDevFee > 0 && (
        <div style={{
          marginTop: 12, padding: "8px 14px", borderRadius: 4, fontSize: 10,
          background: result.ddfPaidYear ? "#f0f9f4" : "#fce8e3",
          border: `1px solid ${result.ddfPaidYear ? "#b8dfc8" : "#f5c2b0"}`,
          color: result.ddfPaidYear ? "#1a6b3c" : "#8B2500",
        }}>
          <strong>DDF Payoff:</strong>{" "}
          {result.ddfPaidYear
            ? `Deferred Developer Fee (${fmt$(deferredDevFee)}) fully repaid by Year ${result.ddfPaidYear}.`
            : `Deferred Developer Fee (${fmt$(deferredDevFee)}) NOT fully repaid within 15 years. Remaining balance: ${fmt$(result.years[14]?.ddfBalance || 0)}.`
          }
        </div>
      )}
    </div>
  );
}
