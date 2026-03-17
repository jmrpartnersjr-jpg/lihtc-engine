import { useState } from "react";
import { useLihtc } from "./context/LihtcContext.jsx";

// ─────────────────────────────────────────────────────────────────────────────
// MODULE 3 — LIHTC CALCULATION ENGINE
// Shows the full credit calculation as a visual waterfall.
// Every step shows the formula, the inputs, and the result.
// Policy context is displayed at each step.
// ─────────────────────────────────────────────────────────────────────────────

const fmt$   = v => v == null ? "—" : "$" + Math.round(v).toLocaleString();
const fmtM   = v => v == null ? "—" : "$" + (v / 1000000).toFixed(3) + "M";
const fmtPct = v => v == null ? "—" : (v * 100).toFixed(2) + "%";
const fmtPct1 = v => v == null ? "—" : (v * 100).toFixed(3) + "%";

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT INPUTS — Apollo SL calibrated
// ─────────────────────────────────────────────────────────────────────────────
const DEFAULT_LIHTC = {
  credit_type:            "4pct",       // "4pct" | "9pct"
  placed_in_service_year: 2028,         // determines 25% vs 50% test
  applicable_pct:         0.04,         // current floating rate or 9%
  rate_locked:            false,        // true = rate locked at closing
  lock_date:              "",
  basis_boost:            true,         // QCT/DDA designation
  boost_factor:           1.30,         // 130% standard; can be 1.0 if no boost
  applicable_fraction:    1.00,         // restricted units / total units
  credit_period:          10,
  investor_price:         0.82,
  te_bond_amount:         32941402,     // temp — will come from Debt module
  // Non-basis deductions (temp — will read from budget basis flags)
  non_basis_costs:        6527411,      // parking, perm fees, etc.
  commercial_costs:       0,
  federal_grants:         0,
  historic_reduction:     0,
  // State credits
  state_credit_applies:   false,
  state_credit_annual:    0,
  state_credit_period:    10,
  state_credit_price:     0,
};

// ─────────────────────────────────────────────────────────────────────────────
// CALCULATION ENGINE
// ─────────────────────────────────────────────────────────────────────────────
function computeLIHTC(inputs, budgetCalcs, totalUnits) {
  const i = inputs;

  // Pull TDC and land from budget module
  const tdc          = budgetCalcs?.tdc            ?? 67824621;
  const landCost     = budgetCalcs?.acqTotal        ?? 4488000;
  const budgetBasis  = budgetCalcs?.eligibleBasis   ?? 56809210; // pre-boost

  // STEP 1 — Eligible Basis
  // TDC minus land minus non-basis costs
  const adjustedEligibleBasis = tdc
    - landCost
    - (i.non_basis_costs   || 0)
    - (i.commercial_costs  || 0)
    - (i.federal_grants    || 0)
    - (i.historic_reduction || 0);

  // STEP 2 — Basis Boost
  const boostAmount   = i.basis_boost
    ? adjustedEligibleBasis * (i.boost_factor - 1)
    : 0;
  const boostedBasis  = adjustedEligibleBasis + boostAmount;

  // STEP 3 — Qualified Basis
  const qualifiedBasis = boostedBasis * (i.applicable_fraction || 1);

  // STEP 4 — Annual Credit
  // For 4% deals: minimum floor is 4.00% (post-2021)
  // For 9% deals: fixed at 9.00%
  const effectiveRate = i.credit_type === "9pct"
    ? 0.09
    : Math.max(0.04, i.applicable_pct || 0.04); // 4% floor per CAA 2021

  const annualCredit = qualifiedBasis * effectiveRate;

  // STEP 5 — 10-Year Credit
  const totalCredit = annualCredit * (i.credit_period || 10);

  // STEP 6 — Equity Raised
  const equityRaised = totalCredit * (i.investor_price || 0);

  // Bond test
  // Aggregate basis = TDC - land (NOT eligible basis — different calculation)
  const aggregateBasis = tdc - landCost;
  const bondPct        = aggregateBasis > 0 ? i.te_bond_amount / aggregateBasis : 0;
  const testThreshold  = (i.placed_in_service_year || 2028) > 2025 ? 0.25 : 0.50;
  const bondTestPass   = bondPct >= testThreshold;

  // Per unit
  const creditPerUnit = totalUnits > 0 ? annualCredit / totalUnits : 0;
  const equityPerUnit = totalUnits > 0 ? equityRaised / totalUnits : 0;

  // State credits
  const stateCreditTotal = i.state_credit_applies
    ? (i.state_credit_annual || 0) * (i.state_credit_period || 10)
    : 0;
  const stateEquity = stateCreditTotal * (i.state_credit_price || 0);

  return {
    tdc, landCost,
    adjustedEligibleBasis, boostAmount, boostedBasis,
    qualifiedBasis,
    effectiveRate, annualCredit,
    totalCredit, equityRaised,
    aggregateBasis, bondPct, testThreshold, bondTestPass,
    creditPerUnit, equityPerUnit,
    stateCreditTotal, stateEquity,
    totalEquity: equityRaised + stateEquity,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

// Step card — shows the formula line, then the math, then the result
function StepCard({ step, title, policy, rows, result, resultLabel, accent, children }) {
  const colors = {
    navy:   { bg:"#f0f3f9", border:"#b8c8e0", header:"#1a3a6b", result:"#1a3a6b" },
    green:  { bg:"#f0f9f4", border:"#b8dfc8", header:"#1a6b3c", result:"#1a6b3c" },
    brown:  { bg:"#fdf8f0", border:"#e8d9b8", header:"#5a3a00", result:"#5a3a00" },
    red:    { bg:"#fce8e3", border:"#f5c2b0", header:"#8B2500", result:"#8B2500" },
    purple: { bg:"#f5f0fa", border:"#d8c8e8", header:"#4a1a6b", result:"#4a1a6b" },
    dark:   { bg:"#f8f8f8", border:"#e0e0e0", header:"#111",    result:"#111"    },
  };
  const c = colors[accent] || colors.dark;

  return (
    <div style={{ marginBottom:12 }}>
      {/* Step header */}
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:6 }}>
        <div style={{ width:24, height:24, borderRadius:"50%", background:c.header,
          color:"white", fontSize:11, fontWeight:700, display:"flex", alignItems:"center",
          justifyContent:"center", flexShrink:0 }}>
          {step}
        </div>
        <div>
          <div style={{ fontSize:12, fontWeight:700, color:c.header, fontFamily:"Inter, sans-serif" }}>{title}</div>
          {policy && <div style={{ fontSize:9, color:"#aaa", fontFamily:"Inter, sans-serif", marginTop:1 }}>{policy}</div>}
        </div>
      </div>

      {/* Card body */}
      <div style={{ background:c.bg, border:`1px solid ${c.border}`, borderRadius:6,
        padding:"12px 16px", marginLeft:34 }}>
        {/* Math rows */}
        {rows && rows.map((row, idx) => (
          <div key={idx} style={{ display:"flex", justifyContent:"space-between",
            alignItems:"center", marginBottom: idx < rows.length - 1 ? 6 : 0,
            paddingBottom: idx < rows.length - 1 ? 6 : 0,
            borderBottom: idx < rows.length - 1 ? `1px solid ${c.border}` : "none" }}>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              {row.operator && (
                <span style={{ fontSize:13, color:c.header, fontWeight:700, width:14, textAlign:"center" }}>
                  {row.operator}
                </span>
              )}
              <span style={{ fontSize:10, color:"#666", fontFamily:"Inter, sans-serif" }}>{row.label}</span>
            </div>
            <span style={{ fontSize:11, fontWeight:600, color: row.deduction ? "#8B2500" : "#111",
              fontFamily:"Inter, sans-serif" }}>
              {row.value}
            </span>
          </div>
        ))}
        {children}
        {/* Result line */}
        {result != null && (
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
            marginTop:10, paddingTop:10, borderTop:`2px solid ${c.border}` }}>
            <span style={{ fontSize:10, fontWeight:700, color:c.header, textTransform:"uppercase",
              letterSpacing:"0.06em", fontFamily:"Inter, sans-serif" }}>
              {resultLabel || "Result"}
            </span>
            <span style={{ fontSize:16, fontWeight:700, color:c.result, fontFamily:"Inter, sans-serif" }}>
              {result}
            </span>
          </div>
        )}
      </div>

      {/* Connector arrow */}
      <div style={{ display:"flex", justifyContent:"center", marginLeft:34, height:16,
        alignItems:"center" }}>
        <div style={{ width:2, height:16, background:"#d0d0d0" }} />
      </div>
    </div>
  );
}

function InputField({ label, children, note }) {
  return (
    <div style={{ marginBottom:10 }}>
      <div style={{ fontSize:8, color:"#aaa", textTransform:"uppercase", letterSpacing:"0.06em",
        marginBottom:3, fontFamily:"Inter, sans-serif" }}>{label}</div>
      {children}
      {note && <div style={{ fontSize:8, color:"#bbb", marginTop:2, fontFamily:"Inter, sans-serif" }}>{note}</div>}
    </div>
  );
}

function ToggleButton({ value, onChange, options }) {
  return (
    <div style={{ display:"flex", gap:4 }}>
      {options.map(opt => (
        <button key={opt.value} onClick={() => onChange(opt.value)}
          style={{ padding:"4px 10px", borderRadius:4, border:"1px solid",
            borderColor: value === opt.value ? opt.color || "#1a3a6b" : "#e0e0e0",
            background: value === opt.value ? opt.color || "#1a3a6b" : "white",
            color: value === opt.value ? "white" : "#666",
            fontSize:10, fontFamily:"Inter, sans-serif", cursor:"pointer", fontWeight: value === opt.value ? 700 : 400 }}>
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function NumberInput({ value, onChange, step, min, max, prefix, suffix, pct }) {
  const display = pct ? +(value * 100).toFixed(4) : value;
  return (
    <div style={{ display:"flex", alignItems:"center", gap:4 }}>
      {prefix && <span style={{ fontSize:10, color:"#888" }}>{prefix}</span>}
      <input
        type="number"
        value={display}
        step={step || (pct ? 0.01 : 1000)}
        min={min}
        max={max}
        onChange={e => onChange(pct ? Number(e.target.value) / 100 : Number(e.target.value))}
        style={{ background:"#f8f8f8", border:"1px solid #e0e0e0", borderRadius:4,
          padding:"4px 8px", fontSize:11, fontFamily:"Inter, sans-serif", color:"#111",
          outline:"none", width:90, textAlign:"right" }}
      />
      {suffix && <span style={{ fontSize:10, color:"#888" }}>{suffix}</span>}
    </div>
  );
}

function SummaryMetric({ label, value, sub, highlight, warn }) {
  return (
    <div style={{ padding:"10px 14px", background: highlight ? "#111" : warn ? "#fce8e3" : "#f8f8f8",
      border:`1px solid ${highlight ? "#333" : warn ? "#f5c2b0" : "#e0e0e0"}`, borderRadius:6 }}>
      <div style={{ fontSize:8, color: highlight ? "#888" : warn ? "#8B2500" : "#aaa",
        textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:4, fontFamily:"Inter, sans-serif" }}>
        {label}
      </div>
      <div style={{ fontSize:18, fontWeight:700, color: highlight ? "white" : warn ? "#8B2500" : "#111",
        fontFamily:"Inter, sans-serif" }}>
        {value}
      </div>
      {sub && <div style={{ fontSize:9, color: highlight ? "#666" : "#aaa", marginTop:2,
        fontFamily:"Inter, sans-serif" }}>{sub}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PANEL
// ─────────────────────────────────────────────────────────────────────────────
export default function TaxCreditPanel() {
  const { moduleStates, updateModule } = useLihtc();

  const inputs  = { ...DEFAULT_LIHTC, ...moduleStates.lihtc };
  const budget  = moduleStates.budget;
  const unitMix = moduleStates.unit_mix;

  const totalUnits = (unitMix?.rows ?? []).reduce((s, r) => s + (r.count || 0), 0) || 175;

  // Build budget calcs summary for this module to read
  // We need tdc, acqTotal from budget module
  const budgetCalcs = budget ? {
    tdc:           null, // computed below
    acqTotal:      null,
    eligibleBasis: null,
  } : null;

  // Compute budget numbers from moduleStates.budget
  // Uses same logic as DevBudget computeBudget to ensure consistent TDC
  let tdc = 67824621, acqTotal = 4488000;
  if (budget?.sections && budget?.assumptions) {
    const a = budget.assumptions;
    const s = budget.sections;

    // Acquisition
    acqTotal = s.acquisition?.reduce((sum, l) => sum + (l.amount || 0), 0) || 4488000;

    // Hard costs — P&P Bond excluded from cont/tax base; sales tax applies AFTER contingency
    const hcAllInputs = s.hard_costs?.filter(l => l.type === "input").reduce((sum, l) => sum + (l.amount || 0), 0) || 0;
    const ppBond    = s.hard_costs?.find(l => l.label?.toLowerCase().includes("p&p") || l.label?.toLowerCase().includes("bond premium"));
    const ppBondAmt = ppBond?.type === "input" ? (ppBond?.amount || 0) : 0;
    const hcContBase = hcAllInputs - ppBondAmt;
    const hcCont   = hcContBase * (a.hc_contingency_pct || 0);
    const hcTax    = (hcContBase + hcCont) * (a.sales_tax_pct || 0);
    const hcTotal  = hcAllInputs + hcCont + hcTax;

    // Soft costs — contingency applies to input subtotal
    const scInputs = s.soft_costs?.filter(l => l.type === "input").reduce((sum, l) => sum + (l.amount || 0), 0) || 0;
    const scTotal  = scInputs + (scInputs * (a.sc_contingency_pct || 0));

    // Financing — inputs plus calculated lines
    const finInputs  = s.financing?.filter(l => l.type === "input").reduce((sum, l) => sum + (l.amount || 0), 0) || 0;
    const combinedCL = (a.const_loan_amount || 0) + (a.taxable_loan_amount || 0);
    const constOrig  = combinedCL * (a.const_origination_pct || 0);
    const permOrig   = (a.perm_loan_amount  || 0) * (a.perm_origination_pct  || 0);
    const constInt   = a.const_interest_est  || 0;
    const leaseupInt = a.leaseup_interest_est || 0;
    const finTotal   = finInputs + constOrig + permOrig + constInt + leaseupInt;

    // Org / reserves
    const orgInputs = s.org_reserves?.filter(l => l.type === "input").reduce((sum, l) => sum + (l.amount || 0), 0) || 0;
    const repRes    = totalUnits * (a.rep_reserve_per_unit ?? 350);
    const opRes     = a.op_reserve_fallback  ?? 637500;
    const adsRes    = a.ads_reserve_fallback ?? 1110159;
    const orgTotal  = orgInputs + repRes + opRes + adsRes;

    // Dev fee is % of costs (not TDC) — matches DevBudget
    const subtotal = acqTotal + hcTotal + scTotal + finTotal + orgTotal;
    const devFee   = subtotal * (a.dev_fee_pct || 0.15);
    tdc = subtotal + devFee;
  }

  const calcs = computeLIHTC(inputs, { tdc, acqTotal }, totalUnits);
  const update = (patch) => updateModule("lihtc", patch);

  const inpStyle = { background:"#f8f8f8", border:"1px solid #e0e0e0", borderRadius:4,
    padding:"4px 8px", fontSize:11, fontFamily:"Inter, sans-serif", color:"#111", outline:"none", width:"100%" };

  return (
    <div style={{ fontFamily:"Inter, sans-serif" }}>
      {/* Header */}
      <div style={{ display:"flex", alignItems:"baseline", justifyContent:"space-between", marginBottom:20 }}>
        <div style={{ display:"flex", alignItems:"baseline", gap:10 }}>
          <h2 style={{ fontFamily:"'Playfair Display', serif", fontSize:20, fontWeight:400, color:"#111" }}>
            Tax Credit Calc
          </h2>
          <span style={{ fontSize:9, color:"#aaa", letterSpacing:"0.08em", textTransform:"uppercase" }}>
            MODULE 3 · LIHTC ENGINE
          </span>
        </div>
        {/* Bond test badge — always visible */}
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          <div style={{ padding:"4px 10px", borderRadius:4, fontSize:9, fontWeight:700,
            fontFamily:"Inter, sans-serif", letterSpacing:"0.05em",
            background: calcs.bondTestPass ? "#f0f9f4" : "#fce8e3",
            color: calcs.bondTestPass ? "#1a6b3c" : "#8B2500",
            border: `1px solid ${calcs.bondTestPass ? "#b8dfc8" : "#f5c2b0"}` }}>
            {calcs.bondTestPass ? "✓" : "✗"} {(calcs.testThreshold * 100).toFixed(0)}% BOND TEST
            &nbsp;·&nbsp; {fmtPct(calcs.bondPct)} financed
          </div>
        </div>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"260px 1fr", gap:20, alignItems:"start" }}>

        {/* LEFT — Inputs + Summary */}
        <div>
          {/* Inputs */}
          <div style={{ background:"white", border:"1px solid #e0e0e0", borderRadius:6,
            padding:"14px 16px", marginBottom:14 }}>
            <div style={{ fontSize:9, fontWeight:700, color:"#1a3a6b", textTransform:"uppercase",
              letterSpacing:"0.08em", marginBottom:12 }}>Inputs</div>

            <InputField label="Credit Type">
              <ToggleButton value={inputs.credit_type} onChange={v => update({ credit_type: v })}
                options={[
                  { value:"4pct", label:"4% Bond",  color:"#1a3a6b" },
                  { value:"9pct", label:"9% Credit", color:"#1a6b3c" },
                ]} />
            </InputField>

            <InputField label="Placed in Service Year"
              note={`Using ${(inputs.placed_in_service_year || 2028) > 2025 ? "25%" : "50%"} bond test (OBBBA 2025 if PIS > 2025)`}>
              <NumberInput value={inputs.placed_in_service_year || 2028} step={1} min={2020} max={2040}
                onChange={v => update({ placed_in_service_year: v })} />
            </InputField>

            <InputField
              label={inputs.credit_type === "9pct" ? "Applicable % (fixed 9%)" : "Applicable % (floating)"}
              note={inputs.credit_type === "4pct"
                ? `Floor: 4.00% per CAA 2021 · Effective rate: ${fmtPct1(calcs.effectiveRate)}`
                : "Fixed at 9.00% per HERA 2008"}>
              {inputs.credit_type === "9pct" ? (
                <div style={{ fontSize:13, fontWeight:700, color:"#1a6b3c", padding:"4px 0" }}>9.000%</div>
              ) : (
                <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                  <NumberInput value={inputs.applicable_pct} pct step={0.01} min={0} max={0.10}
                    onChange={v => update({ applicable_pct: v })} suffix="%" />
                  <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                    <input type="checkbox" checked={inputs.rate_locked}
                      onChange={e => update({ rate_locked: e.target.checked })}
                      style={{ cursor:"pointer", accentColor:"#1a3a6b" }} />
                    <span style={{ fontSize:9, color:"#888" }}>Lock rate at closing</span>
                  </div>
                </div>
              )}
            </InputField>

            <InputField label="Basis Boost" note="QCT or DDA designation · Standard = 130%">
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <input type="checkbox" checked={inputs.basis_boost}
                  onChange={e => update({ basis_boost: e.target.checked })}
                  style={{ cursor:"pointer", accentColor:"#5a3a00" }} />
                <span style={{ fontSize:10, color:"#888" }}>
                  {inputs.basis_boost ? "Yes — " : "No basis boost"}
                </span>
                {inputs.basis_boost && (
                  <NumberInput value={inputs.boost_factor} step={0.01} min={1.0} max={1.30}
                    onChange={v => update({ boost_factor: v })} />
                )}
              </div>
            </InputField>

            <InputField label="Applicable Fraction"
              note="Restricted units / total units · Usually 100% for 100% affordable">
              <NumberInput value={inputs.applicable_fraction} pct step={0.5} min={0} max={100}
                onChange={v => update({ applicable_fraction: v })} suffix="%" />
            </InputField>

            <InputField label="Investor Price (per $1.00 credit)">
              <NumberInput value={inputs.investor_price} step={0.005} min={0} max={1.0}
                onChange={v => update({ investor_price: v })} prefix="¢" />
            </InputField>

            <InputField label="TE Bond Amount (temp — from Debt module)"
              note="Used for bond test only">
              <NumberInput value={inputs.te_bond_amount} step={100000}
                onChange={v => update({ te_bond_amount: v })} prefix="$" />
            </InputField>

            <div style={{ borderTop:"1px solid #f0f0f0", paddingTop:10, marginTop:4 }}>
              <div style={{ fontSize:8, fontWeight:700, color:"#888", textTransform:"uppercase",
                letterSpacing:"0.08em", marginBottom:8 }}>Non-Basis Deductions</div>
              <div style={{ fontSize:8, color:"#aaa", marginBottom:8 }}>
                These reduce TDC to Eligible Basis. Will auto-populate from Dev Budget basis flags in a future update.
              </div>
              {[
                { key:"non_basis_costs",   label:"Non-Basis Costs (parking, perm fees)" },
                { key:"commercial_costs",  label:"Commercial Costs" },
                { key:"federal_grants",    label:"Federal Grants" },
                { key:"historic_reduction",label:"Historic Credit Reduction" },
              ].map(f => (
                <div key={f.key} style={{ display:"flex", justifyContent:"space-between",
                  alignItems:"center", marginBottom:6 }}>
                  <span style={{ fontSize:9, color:"#666", flex:1, paddingRight:8 }}>{f.label}</span>
                  <input type="number" value={inputs[f.key] || 0} step={10000}
                    onChange={e => update({ [f.key]: Number(e.target.value) })}
                    style={{ ...inpStyle, width:100, textAlign:"right" }} />
                </div>
              ))}
            </div>
          </div>

          {/* Summary */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
            <SummaryMetric label="Annual Credit"   value={fmt$(calcs.annualCredit)}  sub={fmt$(calcs.creditPerUnit) + "/unit"} highlight />
            <SummaryMetric label="10-Year Credit"  value={fmt$(calcs.totalCredit)}   sub={`${inputs.credit_period || 10} years`} highlight />
            <SummaryMetric label="Equity Raised"   value={fmt$(calcs.equityRaised)}  sub={fmt$(calcs.equityPerUnit) + "/unit"} highlight />
            <SummaryMetric label="Credit / Unit"   value={fmt$(calcs.creditPerUnit)} sub="annual credit" />
          </div>

          {/* State credits */}
          <div style={{ background:"white", border:"1px solid #e0e0e0", borderRadius:6,
            padding:"12px 16px", marginTop:14 }}>
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom: inputs.state_credit_applies ? 10 : 0 }}>
              <input type="checkbox" checked={inputs.state_credit_applies}
                onChange={e => update({ state_credit_applies: e.target.checked })}
                style={{ cursor:"pointer", accentColor:"#4a1a6b" }} />
              <span style={{ fontSize:10, fontWeight:700, color:"#4a1a6b" }}>State Tax Credits</span>
            </div>
            {inputs.state_credit_applies && (
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                {[
                  { key:"state_credit_annual", label:"Annual State Credit $" },
                  { key:"state_credit_period", label:"Credit Period (years)" },
                  { key:"state_credit_price",  label:"State Credit Price" },
                ].map(f => (
                  <div key={f.key} style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                    <span style={{ fontSize:9, color:"#666" }}>{f.label}</span>
                    <input type="number" value={inputs[f.key] || 0} step={f.key === "state_credit_price" ? 0.01 : 10000}
                      onChange={e => update({ [f.key]: Number(e.target.value) })}
                      style={{ ...inpStyle, width:100, textAlign:"right" }} />
                  </div>
                ))}
                <div style={{ display:"flex", justifyContent:"space-between", paddingTop:6,
                  borderTop:"1px solid #f0f0f0" }}>
                  <span style={{ fontSize:10, fontWeight:700, color:"#4a1a6b" }}>State Equity</span>
                  <span style={{ fontSize:12, fontWeight:700, color:"#4a1a6b" }}>{fmt$(calcs.stateEquity)}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT — Visual Waterfall */}
        <div>

          {/* STEP 1 — Eligible Basis */}
          <StepCard step={1} title="Eligible Basis" accent="navy"
            policy="Total Development Cost minus land, non-basis costs, commercial space, federal grants, and historic credit reductions."
            rows={[
              { label:"Total Development Cost",        value: fmt$(calcs.tdc) },
              { operator:"−", label:"Land & Acquisition",             value: fmt$(calcs.landCost),            deduction: true },
              { operator:"−", label:"Non-Basis Costs",                value: fmt$(inputs.non_basis_costs || 0), deduction: true },
              { operator:"−", label:"Commercial Costs",               value: fmt$(inputs.commercial_costs || 0), deduction: inputs.commercial_costs > 0 },
              { operator:"−", label:"Federal Grants",                  value: fmt$(inputs.federal_grants || 0),  deduction: inputs.federal_grants > 0 },
              { operator:"−", label:"Historic Credit Reduction",       value: fmt$(inputs.historic_reduction || 0), deduction: inputs.historic_reduction > 0 },
            ]}
            result={fmt$(calcs.adjustedEligibleBasis)}
            resultLabel="Adjusted Eligible Basis"
          />

          {/* STEP 2 — Basis Boost */}
          <StepCard step={2} title="Basis Boost" accent="brown"
            policy={inputs.basis_boost
              ? `QCT / DDA designation allows a ${((inputs.boost_factor - 1) * 100).toFixed(0)}% basis boost — effectively increases credit-generating basis.`
              : "No basis boost applied. Project is not in a QCT or DDA, or boost not elected."}
            rows={inputs.basis_boost ? [
              { label:"Adjusted Eligible Basis",  value: fmt$(calcs.adjustedEligibleBasis) },
              { operator:"×", label:`Boost Factor (${((inputs.boost_factor) * 100).toFixed(0)}%)`, value: `${((inputs.boost_factor) * 100).toFixed(0)}%` },
              { operator:"+", label:"Boost Amount",  value: fmt$(calcs.boostAmount) },
            ] : [
              { label:"Adjusted Eligible Basis",  value: fmt$(calcs.adjustedEligibleBasis) },
              { label:"No boost applied",         value: "× 100%" },
            ]}
            result={fmt$(calcs.boostedBasis)}
            resultLabel="Boosted Eligible Basis"
          />

          {/* STEP 3 — Qualified Basis */}
          <StepCard step={3} title="Qualified Basis" accent="green"
            policy="Boosted Eligible Basis multiplied by the Applicable Fraction — the percentage of units (and floor space) that are income-restricted."
            rows={[
              { label:"Boosted Eligible Basis",   value: fmt$(calcs.boostedBasis) },
              { operator:"×", label:`Applicable Fraction (${fmtPct(inputs.applicable_fraction)})`, value: fmtPct(inputs.applicable_fraction) },
            ]}
            result={fmt$(calcs.qualifiedBasis)}
            resultLabel="Qualified Basis"
          />

          {/* STEP 4 — Annual Credit */}
          <StepCard step={4} title="Annual Federal Credit" accent="purple"
            policy={inputs.credit_type === "4pct"
              ? `4% floating rate · Floor: 4.00% (Consolidated Appropriations Act 2021, IRC §42(b)(3)) · Current effective rate: ${fmtPct1(calcs.effectiveRate)}${inputs.rate_locked ? " · Rate locked at closing" : " · Rate floats until placed in service"}`
              : "9% fixed rate per Housing and Economic Recovery Act (HERA) 2008, IRC §42(b)(2)"}
            rows={[
              { label:"Qualified Basis",           value: fmt$(calcs.qualifiedBasis) },
              { operator:"×", label:`Applicable Percentage${inputs.credit_type === "4pct" && calcs.effectiveRate === 0.04 ? " (at 4% floor)" : ""}`, value: fmtPct1(calcs.effectiveRate) },
            ]}>
            {/* Rate note */}
            {inputs.credit_type === "4pct" && (
              <div style={{ marginTop:8, padding:"6px 10px", background:"#f0f3f9",
                borderRadius:4, fontSize:8, color:"#1a3a6b", fontFamily:"Inter, sans-serif" }}>
                <strong>4% Floor:</strong> Per CAA 2021, the applicable percentage for tax-exempt bond deals
                may never fall below 4.00% regardless of the published monthly rate. Apollo SL is at the floor.
              </div>
            )}
          </StepCard>

          {/* Result after children */}
          <div style={{ marginLeft:34, marginTop:-8, marginBottom:4 }}>
            <div style={{ background:"#f5f0fa", border:"1px solid #d8c8e8", borderRadius:6,
              padding:"8px 16px", display:"flex", justifyContent:"space-between" }}>
              <span style={{ fontSize:10, fontWeight:700, color:"#4a1a6b", textTransform:"uppercase",
                letterSpacing:"0.06em" }}>Annual Federal Credit</span>
              <span style={{ fontSize:16, fontWeight:700, color:"#4a1a6b" }}>{fmt$(calcs.annualCredit)}</span>
            </div>
            <div style={{ display:"flex", justifyContent:"center", height:16, alignItems:"center" }}>
              <div style={{ width:2, height:16, background:"#d0d0d0" }} />
            </div>
          </div>

          {/* STEP 5 — 10-Year Credit */}
          <StepCard step={5} title="10-Year Credit Period" accent="green"
            policy="Credits are delivered annually over 10 years beginning with placed-in-service date. Total credit pool is what the investor purchases."
            rows={[
              { label:"Annual Federal Credit",    value: fmt$(calcs.annualCredit) },
              { operator:"×", label:`Credit Period (${inputs.credit_period || 10} years)`, value: `${inputs.credit_period || 10}` },
            ]}
            result={fmt$(calcs.totalCredit)}
            resultLabel="Total 10-Year Credit"
          />

          {/* STEP 6 — Equity Raise */}
          <StepCard step={6} title="Equity Raised" accent="dark"
            policy="The investor purchases the 10-year credit stream at a negotiated price per dollar of credit. This is the equity that closes the gap in the capital stack."
            rows={[
              { label:"Total 10-Year Credit",     value: fmt$(calcs.totalCredit) },
              { operator:"×", label:`Investor Price (¢${(inputs.investor_price * 100).toFixed(1)} per $1.00 credit)`, value: `$${(inputs.investor_price).toFixed(3)}` },
            ]}
            result={fmt$(calcs.equityRaised)}
            resultLabel="Net Equity Raised"
          />

          {/* No connector after last step */}
          <div style={{ marginLeft:34 }}>
            <div style={{ background:"#111", borderRadius:6, padding:"14px 18px",
              display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:16 }}>
              {[
                { label:"Annual Credit",  value: fmt$(calcs.annualCredit),  sub: fmt$(calcs.creditPerUnit) + "/unit" },
                { label:"Total Credits",  value: fmt$(calcs.totalCredit),   sub: `${inputs.credit_period || 10}-year pool` },
                { label:"Equity Raised",  value: fmt$(calcs.equityRaised),  sub: fmt$(calcs.equityPerUnit) + "/unit" },
              ].map(m => (
                <div key={m.label}>
                  <div style={{ fontSize:8, color:"#666", textTransform:"uppercase",
                    letterSpacing:"0.08em", marginBottom:4 }}>{m.label}</div>
                  <div style={{ fontSize:15, fontWeight:700, color:"white" }}>{m.value}</div>
                  <div style={{ fontSize:9, color:"#555", marginTop:2 }}>{m.sub}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Bond Test Detail */}
          <div style={{ marginLeft:34, marginTop:14 }}>
            <div style={{ background: calcs.bondTestPass ? "#f0f9f4" : "#fce8e3",
              border: `1px solid ${calcs.bondTestPass ? "#b8dfc8" : "#f5c2b0"}`,
              borderRadius:6, padding:"12px 16px" }}>
              <div style={{ fontSize:9, fontWeight:700,
                color: calcs.bondTestPass ? "#1a6b3c" : "#8B2500",
                textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:10 }}>
                {(calcs.testThreshold * 100).toFixed(0)}% Bond Test
                {(inputs.placed_in_service_year || 2028) > 2025
                  ? " — OBBBA 2025 (PIS after Dec 31, 2025)"
                  : " — Pre-2026 Rule"}
              </div>
              {[
                { label:"TE Bond Amount",       value: fmt$(inputs.te_bond_amount) },
                { label:"Aggregate Basis (TDC − Land)", value: fmt$(calcs.aggregateBasis) },
                { label:"Bond % of Aggregate Basis",    value: fmtPct(calcs.bondPct) },
                { label:`Required Threshold`,           value: fmtPct(calcs.testThreshold) },
              ].map((r, i) => (
                <div key={i} style={{ display:"flex", justifyContent:"space-between",
                  marginBottom:4, fontSize:10 }}>
                  <span style={{ color:"#666" }}>{r.label}</span>
                  <span style={{ fontWeight:600 }}>{r.value}</span>
                </div>
              ))}
              <div style={{ marginTop:8, paddingTop:8,
                borderTop: `1px solid ${calcs.bondTestPass ? "#b8dfc8" : "#f5c2b0"}`,
                display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <span style={{ fontSize:10, fontWeight:700,
                  color: calcs.bondTestPass ? "#1a6b3c" : "#8B2500" }}>
                  {calcs.bondTestPass ? "✓ BOND TEST PASSES" : "✗ BOND TEST FAILS — project does not qualify for 4% credits"}
                </span>
                <span style={{ fontSize:14, fontWeight:700,
                  color: calcs.bondTestPass ? "#1a6b3c" : "#8B2500" }}>
                  {fmtPct(calcs.bondPct)}
                </span>
              </div>
              <div style={{ fontSize:8, color:"#aaa", marginTop:6 }}>
                Note: Aggregate basis includes land. Eligible basis does not. These are different calculations.
                Recycled bonds do not count toward the test threshold.
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
