import { useState, useCallback } from "react";
import { useLihtc } from "./context/LihtcContext.jsx";

// ─────────────────────────────────────────────────────────────────────────────
// MODULE 2A — DEVELOPMENT BUDGET
// Static budget with estimated construction interest (Module 2B placeholder).
// All inputs versioned via LihtcContext.
// ─────────────────────────────────────────────────────────────────────────────

const fmt$  = v => v == null ? "—" : "$" + Math.round(v).toLocaleString();
const fmtM  = v => v == null ? "—" : "$" + (v / 1000000).toFixed(3) + "M";
const fmtPct = v => v == null ? "—" : (v * 100).toFixed(2) + "%";

let _id = 200;
const mkId = () => ++_id;

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT STATE — Apollo SL calibrated
// ─────────────────────────────────────────────────────────────────────────────
const DEFAULT_ASSUMPTIONS = {
  hc_contingency_pct:   0.05,
  sales_tax_pct:        0.106,
  sc_contingency_pct:   0.10,
  dev_fee_pct:          0.15,
  cash_fee_pct:         0.33,
  const_origination_pct: 0.01,
  perm_origination_pct:  0.01,
  // These will come from Debt module eventually
  const_loan_amount:    32941402,
  perm_loan_amount:     34049115,
  // Construction interest estimates (overwritten by Module 2B)
  const_interest_est:   3164218,
  leaseup_interest_est: 1987588,
};

const DEFAULT_SECTIONS = {
  acquisition: [
    { id: 1,  label: "Land Purchase Price",     amount: 4400000,  in_basis: false, type: "input",   pct_value: null, notes: "",                    is_locked: true  },
    { id: 2,  label: "Closing Costs",           amount: 88000,    in_basis: false, type: "input",   pct_value: null, notes: "2% of land",          is_locked: false },
    { id: 3,  label: "Extension Fees",          amount: 0,        in_basis: false, type: "input",   pct_value: null, notes: "",                    is_locked: false },
  ],
  hard_costs: [
    { id: 10, label: "Residential Construction", amount: 31200000, in_basis: true,  type: "input",   pct_value: null, notes: "Per GC pricing",      is_locked: true  },
    { id: 11, label: "Parking / Structured",     amount: 1500000,  in_basis: false, type: "input",   pct_value: null, notes: "Not in basis per WSHFC", is_locked: false },
    { id: 12, label: "FF&E / GC Exclusions",     amount: 300000,   in_basis: true,  type: "input",   pct_value: null, notes: "",                    is_locked: false },
    { id: 13, label: "Demolition",               amount: 50000,    in_basis: true,  type: "input",   pct_value: null, notes: "Estimate, GC feedback needed", is_locked: false },
    { id: 14, label: "Site Work / Infrastructure", amount: 0,      in_basis: true,  type: "input",   pct_value: null, notes: "",                    is_locked: false },
    { id: 15, label: "P&P Bond Premium",         amount: 300000,   in_basis: true,  type: "input",   pct_value: null, notes: "",                    is_locked: false },
    { id: 16, label: "Contingency",              amount: null,     in_basis: true,  type: "pct_hc",  pct_value: null, notes: "% of HC subtotal",    is_locked: true  },
    { id: 17, label: "Sales Tax",                amount: null,     in_basis: true,  type: "pct_hc",  pct_value: null, notes: "% of HC subtotal",    is_locked: true  },
  ],
  soft_costs: [
    { id: 30, label: "Architecture & Design",    amount: 1175000,  in_basis: true,  type: "input",   pct_value: null, notes: "",                    is_locked: false },
    { id: 31, label: "Engineering",              amount: 600000,   in_basis: true,  type: "input",   pct_value: null, notes: "Civil, MEP, Structural, Landscape", is_locked: false },
    { id: 32, label: "Permits, Fees & Hook-Ups", amount: 1011715,  in_basis: true,  type: "input",   pct_value: null, notes: "",                    is_locked: false },
    { id: 33, label: "Impact & Mitigation Fees", amount: 1300000,  in_basis: true,  type: "input",   pct_value: null, notes: "",                    is_locked: false },
    { id: 34, label: "Environmental / Geotech",  amount: 35000,    in_basis: true,  type: "input",   pct_value: null, notes: "",                    is_locked: false },
    { id: 35, label: "Survey, Topo & Boundary",  amount: 12000,    in_basis: true,  type: "input",   pct_value: null, notes: "",                    is_locked: false },
    { id: 36, label: "Legal — Real Estate",      amount: 50000,    in_basis: true,  type: "input",   pct_value: null, notes: "",                    is_locked: false },
    { id: 37, label: "Market Study",             amount: 4500,     in_basis: true,  type: "input",   pct_value: null, notes: "",                    is_locked: false },
    { id: 38, label: "Appraisal",                amount: 5000,     in_basis: true,  type: "input",   pct_value: null, notes: "",                    is_locked: false },
    { id: 39, label: "Other Consultants",        amount: 277500,   in_basis: true,  type: "input",   pct_value: null, notes: "Energy modeler, Green, ADA, Architect of Record", is_locked: false },
    { id: 40, label: "Project Management",       amount: 300000,   in_basis: true,  type: "input",   pct_value: null, notes: "R/P",                  is_locked: false },
    { id: 41, label: "Construction Management",  amount: 169365,   in_basis: true,  type: "input",   pct_value: null, notes: "",                    is_locked: false },
    { id: 42, label: "Title & Recording",        amount: 100000,   in_basis: true,  type: "input",   pct_value: null, notes: "",                    is_locked: false },
    { id: 43, label: "Other Inspections & Testing", amount: 100000, in_basis: true, type: "input",   pct_value: null, notes: "",                    is_locked: false },
    { id: 44, label: "Soft Cost Contingency",    amount: null,     in_basis: true,  type: "pct_sc",  pct_value: null, notes: "% of SC subtotal",    is_locked: true  },
  ],
  financing: [
    { id: 60, label: "Construction Origination & Fees", amount: null, in_basis: true,  type: "pct_loan_const", pct_value: null, notes: "% of construction loan", is_locked: true  },
    { id: 61, label: "Perm Loan Origination",           amount: null, in_basis: false, type: "pct_loan_perm",  pct_value: null, notes: "% of perm loan",         is_locked: true  },
    { id: 62, label: "Construction Interest",           amount: null, in_basis: true,  type: "est_2b",         pct_value: null, notes: "Estimated — Module 2B will calculate", is_locked: true  },
    { id: 63, label: "Lease-Up Interest",               amount: null, in_basis: false, type: "est_2b",         pct_value: null, notes: "Estimated — Module 2B will calculate", is_locked: true  },
    { id: 64, label: "WSHFC Bond Related Costs",        amount: 432191, in_basis: true,  type: "input",        pct_value: null, notes: "",                    is_locked: false },
    { id: 65, label: "Bond Legal (Pacifica)",           amount: 85000,  in_basis: true,  type: "input",        pct_value: null, notes: "",                    is_locked: false },
    { id: 66, label: "Construction Loan Legal",         amount: 140000, in_basis: true,  type: "input",        pct_value: null, notes: "Dev + Lender",         is_locked: false },
    { id: 67, label: "Equity DD Fees",                  amount: 50000,  in_basis: true,  type: "input",        pct_value: null, notes: "",                    is_locked: false },
    { id: 68, label: "LIHTC Issuance Fee",              amount: 145825, in_basis: false, type: "input",        pct_value: null, notes: "",                    is_locked: false },
    { id: 69, label: "LIHTC Legal & Syndication",       amount: 50000,  in_basis: false, type: "input",        pct_value: null, notes: "",                    is_locked: false },
    { id: 70, label: "Cost Certification",              amount: 30000,  in_basis: true,  type: "input",        pct_value: null, notes: "",                    is_locked: false },
    { id: 71, label: "Perm Closing Legal",              amount: 50000,  in_basis: false, type: "input",        pct_value: null, notes: "Dev + Lender",         is_locked: false },
    { id: 72, label: "Loan Guarantor Fee",              amount: 300000, in_basis: false, type: "input",        pct_value: null, notes: "",                    is_locked: false },
    { id: 73, label: "Finance Consultant / Credits",    amount: 20000,  in_basis: false, type: "input",        pct_value: null, notes: "",                    is_locked: false },
    { id: 74, label: "CBO Fees / Legal",                amount: 20000,  in_basis: false, type: "input",        pct_value: null, notes: "",                    is_locked: false },
    { id: 75, label: "Trustee / Fiscal (Bonds)",        amount: 37500,  in_basis: true,  type: "input",        pct_value: null, notes: "",                    is_locked: false },
  ],
  org_reserves: [
    { id: 90, label: "Operating Reserves",       amount: null,    in_basis: false, type: "calc_opres",  pct_value: null, notes: "6 months NOI",        is_locked: false },
    { id: 91, label: "Replacement Reserves",     amount: null,    in_basis: false, type: "calc_repres", pct_value: null, notes: "$350/unit",            is_locked: false },
    { id: 92, label: "ADS Reserve",              amount: null,    in_basis: false, type: "calc_adsres", pct_value: null, notes: "6 months debt service", is_locked: false },
    { id: 93, label: "Construction Insurance",   amount: 400000,  in_basis: true,  type: "input",       pct_value: null, notes: "Confirm with broker",  is_locked: false },
    { id: 94, label: "Real Estate Taxes",        amount: 50000,   in_basis: true,  type: "input",       pct_value: null, notes: "During construction",  is_locked: false },
    { id: 95, label: "Pre-Tenant Engagement",    amount: 68000,   in_basis: true,  type: "input",       pct_value: null, notes: "4.5.3.1 requirement",  is_locked: false },
    { id: 96, label: "Working Capital / Lease-Up", amount: 159598, in_basis: false, type: "input",      pct_value: null, notes: "3 months key costs",   is_locked: false },
    { id: 97, label: "Construction Accounting",  amount: 50000,   in_basis: false, type: "input",       pct_value: null, notes: "",                    is_locked: false },
    { id: 98, label: "Project Audit",            amount: 30000,   in_basis: false, type: "input",       pct_value: null, notes: "",                    is_locked: false },
    { id: 99, label: "Entity Legal",             amount: 5000,    in_basis: true,  type: "input",       pct_value: null, notes: "",                    is_locked: false },
    { id: 100,label: "Sponsor Donation",         amount: 65000,   in_basis: false, type: "input",       pct_value: null, notes: "Non-profit",           is_locked: false },
    { id: 101,label: "Dev Period Utilities",     amount: 25000,   in_basis: true,  type: "input",       pct_value: null, notes: "",                    is_locked: false },
    { id: 102,label: "Org Other",                amount: 133000,  in_basis: true,  type: "input",       pct_value: null, notes: "Confirm",              is_locked: false },
  ],
};

const SECTION_CONFIG = {
  acquisition:  { label: "Acquisition",           color: "#1a3a6b" },
  hard_costs:   { label: "Hard Costs",             color: "#8B2500" },
  soft_costs:   { label: "Soft Costs",             color: "#1a6b3c" },
  financing:    { label: "Financing & Legal",      color: "#5a3a00" },
  org_reserves: { label: "Org Costs & Reserves",   color: "#4a1a6b" },
};

const TYPE_LABELS = {
  input:          "",
  pct_hc:         "% HC",
  pct_sc:         "% SC",
  pct_loan_const: "% CL",
  pct_loan_perm:  "% PL",
  est_2b:         "est.",
  calc_opres:     "calc",
  calc_repres:    "calc",
  calc_adsres:    "calc",
};

// ─────────────────────────────────────────────────────────────────────────────
// CALCULATION ENGINE
// ─────────────────────────────────────────────────────────────────────────────
function computeBudget(sections, assumptions, totalUnits, noi, ads) {
  const a = assumptions;

  // Hard cost subtotal (input lines only, before calculated lines)
  const hcInputs = sections.hard_costs
    .filter(l => l.type === "input")
    .reduce((s, l) => s + (l.amount || 0), 0);
  const contingency = hcInputs * a.hc_contingency_pct;
  const salesTax    = hcInputs * a.sales_tax_pct;
  const hcTotal     = hcInputs + contingency + salesTax;

  // Soft cost subtotal (input lines only, before contingency)
  const scInputs    = sections.soft_costs
    .filter(l => l.type === "input")
    .reduce((s, l) => s + (l.amount || 0), 0);
  const scContingency = scInputs * a.sc_contingency_pct;
  const scTotal     = scInputs + scContingency;

  // Financing calculated lines
  const constOrigination = a.const_loan_amount * a.const_origination_pct;
  const permOrigination  = a.perm_loan_amount  * a.perm_origination_pct;
  const constInterest    = a.const_interest_est;
  const leaseupInterest  = a.leaseup_interest_est;

  const finInputs = sections.financing
    .filter(l => l.type === "input")
    .reduce((s, l) => s + (l.amount || 0), 0);
  const finTotal  = finInputs + constOrigination + permOrigination + constInterest + leaseupInterest;

  // Org / reserves calculated lines
  const opRes  = noi   ? noi / 2   : 637500;   // 6 months NOI
  const repRes = totalUnits ? totalUnits * 350  : 61250;    // $350/unit
  const adsRes = ads   ? ads / 2   : 1110159;  // 6 months ADS

  const orgInputs = sections.org_reserves
    .filter(l => l.type === "input")
    .reduce((s, l) => s + (l.amount || 0), 0);
  const orgTotal  = orgInputs + opRes + repRes + adsRes;

  // Acquisition
  const acqTotal = sections.acquisition
    .reduce((s, l) => s + (l.amount || 0), 0);

  // Subtotal before dev fee
  const subtotal = acqTotal + hcTotal + scTotal + finTotal + orgTotal;

  // Developer fee
  const devFeeTotal    = subtotal * a.dev_fee_pct / (1 - a.dev_fee_pct); // fee on top of costs
  const devFeeCash     = devFeeTotal * a.cash_fee_pct;
  const devFeeDeferred = devFeeTotal * (1 - a.cash_fee_pct);
  const tdc            = subtotal + devFeeTotal;

  // Eligible basis — everything in_basis, excluding land, perm loan items, dev fee treatment
  const basisFromSections = Object.entries(sections).reduce((total, [, items]) => {
    return total + items.reduce((s, l) => {
      if (!l.in_basis) return s;
      const amt = resolveAmount(l, { hcInputs, scInputs, constOrigination, permOrigination, constInterest, leaseupInterest, opRes, repRes, adsRes });
      return s + amt;
    }, 0);
  }, 0);
  const eligibleBasis = basisFromSections + devFeeTotal; // dev fee is in basis

  return {
    acqTotal,
    hcInputs, contingency, salesTax, hcTotal,
    scInputs, scContingency, scTotal,
    constOrigination, permOrigination, constInterest, leaseupInterest, finTotal,
    opRes, repRes, adsRes, orgInputs, orgTotal,
    subtotal,
    devFeeTotal, devFeeCash, devFeeDeferred,
    tdc, eligibleBasis,
  };
}

// Resolve the actual dollar amount of a line item given calculated values
function resolveAmount(line, calcs) {
  switch (line.type) {
    case "input":          return line.amount || 0;
    case "pct_hc":         return line.label.toLowerCase().includes("tax") ? calcs.salesTax : calcs.contingency;
    case "pct_sc":         return calcs.scContingency;
    case "pct_loan_const": return calcs.constOrigination;
    case "pct_loan_perm":  return calcs.permOrigination;
    case "est_2b":         return line.label.toLowerCase().includes("lease") ? calcs.leaseupInterest : calcs.constInterest;
    case "calc_opres":     return calcs.opRes;
    case "calc_repres":    return calcs.repRes;
    case "calc_adsres":    return calcs.adsRes;
    default:               return line.amount || 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────
function AssumptionsBar({ assumptions, onUpdate }) {
  const a = assumptions;
  const fieldStyle = { display:"flex", flexDirection:"column", gap:2 };
  const labelStyle = { fontSize:8, color:"#aaa", textTransform:"uppercase", letterSpacing:"0.06em" };
  const inputStyle = {
    background:"#f8f8f8", border:"1px solid #e0e0e0", borderRadius:3,
    padding:"4px 7px", fontSize:10, fontFamily:"Inter, sans-serif",
    color:"#111", outline:"none", width:72, textAlign:"center",
  };

  const fields = [
    { key:"hc_contingency_pct",   label:"HC Cont. %",    pct:true  },
    { key:"sales_tax_pct",        label:"Sales Tax %",   pct:true  },
    { key:"sc_contingency_pct",   label:"SC Cont. %",    pct:true  },
    { key:"dev_fee_pct",          label:"Dev Fee %",     pct:true  },
    { key:"cash_fee_pct",         label:"Cash Fee %",    pct:true  },
    { key:"const_origination_pct",label:"CL Orig. %",    pct:true  },
    { key:"perm_origination_pct", label:"Perm Orig. %",  pct:true  },
    { key:"const_loan_amount",    label:"Const. Loan $", pct:false },
    { key:"perm_loan_amount",     label:"Perm Loan $",   pct:false },
  ];

  return (
    <div style={{ background:"#f8f9fc", border:"1px solid #e0e8f4", borderRadius:6, padding:"10px 16px", marginBottom:16 }}>
      <div style={{ fontSize:8, fontWeight:700, color:"#1a3a6b", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:8 }}>
        Budget Assumptions
      </div>
      <div style={{ display:"flex", gap:12, flexWrap:"wrap" }}>
        {fields.map(f => (
          <div key={f.key} style={fieldStyle}>
            <span style={labelStyle}>{f.label}</span>
            <input
              type="number"
              value={f.pct ? +(a[f.key] * 100).toFixed(3) : a[f.key]}
              step={f.pct ? 0.1 : 10000}
              onChange={e => onUpdate({ [f.key]: f.pct ? Number(e.target.value) / 100 : Number(e.target.value) })}
              style={inputStyle}
            />
          </div>
        ))}
        <div style={{ ...fieldStyle, justifyContent:"flex-end" }}>
          <span style={labelStyle}>Int. Estimate (con)</span>
          <input type="number" value={a.const_interest_est} step={10000}
            onChange={e => onUpdate({ const_interest_est: Number(e.target.value) })}
            style={{ ...inputStyle, color:"#5a3a00" }} />
        </div>
        <div style={fieldStyle}>
          <span style={labelStyle}>Int. Estimate (L/U)</span>
          <input type="number" value={a.leaseup_interest_est} step={10000}
            onChange={e => onUpdate({ leaseup_interest_est: Number(e.target.value) })}
            style={{ ...inputStyle, color:"#5a3a00" }} />
        </div>
      </div>
      <div style={{ fontSize:8, color:"#aaa", marginTop:6 }}>
        Construction and lease-up interest are estimates — Module 2B (Construction Cash Flow) will calculate actuals.
      </div>
    </div>
  );
}

function LineRow({ line, resolvedAmount, totalUnits, onUpdate, onRemove, color }) {
  const perUnit = totalUnits > 0 ? resolvedAmount / totalUnits : null;
  const isCalc  = line.type !== "input";
  const is2B    = line.type === "est_2b";
  const typeTag = TYPE_LABELS[line.type];

  return (
    <tr style={{ borderBottom:"1px solid #f5f5f5" }}>
      {/* Label */}
      <td style={{ padding:"5px 10px", paddingLeft:24 }}>
        <input
          value={line.label}
          onChange={e => onUpdate({ label: e.target.value })}
          style={{ background:"transparent", border:"none", outline:"none", fontSize:11, fontFamily:"Inter, sans-serif", color:"#111", width:"100%" }}
        />
      </td>
      {/* Amount */}
      <td style={{ padding:"5px 10px", textAlign:"right", minWidth:110 }}>
        {isCalc ? (
          <span style={{ fontSize:11, color: is2B ? "#5a3a00" : "#666" }}>
            {fmt$(resolvedAmount)}
            {typeTag && (
              <span style={{ fontSize:8, color: is2B ? "#c47a3a" : "#aaa", marginLeft:5, fontWeight:600,
                background: is2B ? "#fdf8f0" : "#f5f5f5", border: `1px solid ${is2B ? "#e8d9b8" : "#e0e0e0"}`,
                borderRadius:3, padding:"1px 4px" }}>
                {typeTag}
              </span>
            )}
          </span>
        ) : (
          <input
            type="number"
            value={line.amount ?? ""}
            onChange={e => onUpdate({ amount: e.target.value === "" ? 0 : Number(e.target.value) })}
            style={{ background:"transparent", border:"none", borderBottom:"1px solid transparent", outline:"none",
              fontSize:11, fontFamily:"Inter, sans-serif", color:"#111", textAlign:"right", width:110,
              padding:"2px 4px" }}
            onFocus={e => e.target.style.borderBottomColor = color}
            onBlur={e => e.target.style.borderBottomColor = "transparent"}
          />
        )}
      </td>
      {/* $/unit */}
      <td style={{ padding:"5px 8px", textAlign:"right", minWidth:70 }}>
        <span style={{ fontSize:9, color:"#bbb" }}>
          {perUnit != null && perUnit > 0 ? fmt$(Math.round(perUnit)) : ""}
        </span>
      </td>
      {/* In Basis */}
      <td style={{ padding:"5px 10px", textAlign:"center", minWidth:60 }}>
        <input
          type="checkbox"
          checked={line.in_basis}
          onChange={e => onUpdate({ in_basis: e.target.checked })}
          style={{ cursor:"pointer", accentColor: color }}
        />
      </td>
      {/* Notes */}
      <td style={{ padding:"5px 8px" }}>
        <input
          value={line.notes || ""}
          onChange={e => onUpdate({ notes: e.target.value })}
          placeholder="notes"
          style={{ background:"transparent", border:"none", outline:"none", fontSize:10, fontFamily:"Inter, sans-serif",
            color:"#aaa", width:"100%" }}
        />
      </td>
      {/* Actions */}
      <td style={{ padding:"5px 6px", textAlign:"right", whiteSpace:"nowrap" }}>
        {!line.is_locked && (
          <button onClick={onRemove}
            style={{ background:"none", border:"none", cursor:"pointer", color:"#ddd", fontSize:11, padding:"2px 3px" }}
            onMouseEnter={e => e.target.style.color="#8B2500"}
            onMouseLeave={e => e.target.style.color="#ddd"}>✕</button>
        )}
      </td>
    </tr>
  );
}

function BudgetSection({ sectionKey, lines, sectionTotal, basisTotal, totalUnits, calcs, onUpdateLine, onRemoveLine, onAddLine, color, label }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div style={{ marginBottom:4 }}>
      {/* Section header */}
      <div
        onClick={() => setCollapsed(v => !v)}
        style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
          padding:"8px 12px", background:color, color:"white", cursor:"pointer",
          borderRadius: collapsed ? 6 : "6px 6px 0 0" }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ fontSize:9, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase" }}>
            {collapsed ? "▸" : "▾"} {label}
          </span>
        </div>
        <div style={{ display:"flex", gap:20, alignItems:"center" }}>
          <span style={{ fontSize:10 }}>
            <span style={{ opacity:0.65, fontSize:8, marginRight:4 }}>TOTAL</span>
            {fmtM(sectionTotal)}
          </span>
          <span style={{ fontSize:10 }}>
            <span style={{ opacity:0.65, fontSize:8, marginRight:4 }}>IN BASIS</span>
            {fmtM(basisTotal)}
          </span>
        </div>
      </div>

      {!collapsed && (
        <div style={{ background:"white", border:"1px solid #e0e0e0", borderTop:"none", borderRadius:"0 0 6px 6px", overflowX:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11, fontFamily:"Inter, sans-serif" }}>
            <colgroup>
              <col style={{ minWidth:200 }} />
              <col style={{ width:130 }} />
              <col style={{ width:80 }} />
              <col style={{ width:70 }} />
              <col />
              <col style={{ width:40 }} />
            </colgroup>
            <tbody>
              {lines.map(line => {
                const resolvedAmount = resolveAmount(line, calcs);
                const basisAmt = line.in_basis ? resolvedAmount : 0;
                return (
                  <LineRow
                    key={line.id}
                    line={line}
                    resolvedAmount={resolvedAmount}
                    totalUnits={totalUnits}
                    color={color}
                    onUpdate={patch => onUpdateLine(sectionKey, line.id, patch)}
                    onRemove={() => onRemoveLine(sectionKey, line.id)}
                  />
                );
              })}
            </tbody>
          </table>
          <div style={{ padding:"6px 12px" }}>
            <button
              onClick={() => onAddLine(sectionKey)}
              style={{ background:"none", border:"1px dashed #ccc", borderRadius:3, padding:"3px 10px",
                fontSize:9, color:"#aaa", cursor:"pointer", fontFamily:"Inter, sans-serif",
                letterSpacing:"0.06em", textTransform:"uppercase" }}
              onMouseEnter={e => { e.target.style.borderColor=color; e.target.style.color=color; }}
              onMouseLeave={e => { e.target.style.borderColor="#ccc"; e.target.style.color="#aaa"; }}>
              + Add Line
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PANEL
// ─────────────────────────────────────────────────────────────────────────────
export default function DevBudgetPanel({ onBudgetUpdate }) {
  const { moduleStates, updateModule } = useLihtc();

  const assumptions = moduleStates.budget?.assumptions ?? DEFAULT_ASSUMPTIONS;
  const sections    = moduleStates.budget?.sections    ?? DEFAULT_SECTIONS;

  // Total units from Unit Mix module
  const unitMixRows = moduleStates.unit_mix?.rows ?? [];
  const totalUnits  = unitMixRows.reduce((s, r) => s + (r.count || 0), 0) || 175;

  // NOI and ADS from other modules (placeholders until wired)
  const noi = moduleStates.unit_mix ? null : null; // will wire when proforma exists
  const ads = null;

  // Compute everything
  const calcs = computeBudget(sections, assumptions, totalUnits, noi, ads);

  // Writers
  const updateAssumptions = useCallback((patch) => {
    updateModule("budget", { assumptions: { ...assumptions, ...patch } });
  }, [assumptions, updateModule]);

  const updateLine = useCallback((sectionKey, lineId, patch) => {
    const updated = sections[sectionKey].map(l => l.id === lineId ? { ...l, ...patch } : l);
    updateModule("budget", { sections: { ...sections, [sectionKey]: updated } });
  }, [sections, updateModule]);

  const removeLine = useCallback((sectionKey, lineId) => {
    const updated = sections[sectionKey].filter(l => l.id !== lineId);
    updateModule("budget", { sections: { ...sections, [sectionKey]: updated } });
  }, [sections, updateModule]);

  const addLine = useCallback((sectionKey) => {
    const newLine = { id: mkId(), label: "New Line Item", amount: 0, in_basis: true, type: "input", pct_value: null, notes: "", is_locked: false };
    updateModule("budget", { sections: { ...sections, [sectionKey]: [...sections[sectionKey], newLine] } });
  }, [sections, updateModule]);

  // Section totals
  const getSectionTotals = (sectionKey) => {
    const items = sections[sectionKey];
    let total = 0, basis = 0;
    items.forEach(l => {
      const amt = resolveAmount(l, calcs);
      total += amt;
      if (l.in_basis) basis += amt;
    });
    return { total, basis };
  };

  const TH = ({ children, align = "right" }) => (
    <th style={{ padding:"5px 10px", textAlign:align, fontSize:8, color:"#888", textTransform:"uppercase", letterSpacing:"0.07em", fontWeight:700, whiteSpace:"nowrap", borderBottom:"1px solid #e0e0e0" }}>
      {children}
    </th>
  );

  return (
    <div>
      {/* Header */}
      <div style={{ display:"flex", alignItems:"baseline", justifyContent:"space-between", marginBottom:16 }}>
        <div style={{ display:"flex", alignItems:"baseline", gap:10 }}>
          <h2 style={{ fontFamily:"'Playfair Display', serif", fontSize:20, fontWeight:400, color:"#111" }}>Development Budget</h2>
          <span style={{ fontSize:9, color:"#aaa", letterSpacing:"0.08em", textTransform:"uppercase" }}>MODULE 2A · STATIC BUDGET</span>
        </div>
        <div style={{ fontSize:9, color:"#5a3a00", background:"#fdf8f0", border:"1px solid #e8d9b8", borderRadius:3, padding:"3px 8px" }}>
          Construction interest = estimate · Module 2B calculates actuals
        </div>
      </div>

      {/* Assumptions */}
      <AssumptionsBar assumptions={assumptions} onUpdate={updateAssumptions} />

      {/* Column headers */}
      <div style={{ background:"#fafafa", border:"1px solid #e0e0e0", borderRadius:"6px 6px 0 0", marginBottom:0 }}>
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11 }}>
          <thead>
            <tr>
              <TH align="left">Line Item</TH>
              <TH>Amount</TH>
              <TH>$/Unit</TH>
              <TH>In Basis</TH>
              <TH align="left">Notes</TH>
              <TH></TH>
            </tr>
          </thead>
        </table>
      </div>

      {/* Budget sections */}
      <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:6 }}>
        {Object.entries(SECTION_CONFIG).map(([key, cfg]) => {
          const { total, basis } = getSectionTotals(key);
          return (
            <BudgetSection
              key={key}
              sectionKey={key}
              lines={sections[key]}
              sectionTotal={total}
              basisTotal={basis}
              totalUnits={totalUnits}
              calcs={calcs}
              color={cfg.color}
              label={cfg.label}
              onUpdateLine={updateLine}
              onRemoveLine={removeLine}
              onAddLine={addLine}
            />
          );
        })}
      </div>

      {/* Developer Fee section — calculated, not editable items */}
      <div style={{ marginBottom:6 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
          padding:"8px 12px", background:"#2a2a2a", color:"white", borderRadius:6 }}>
          <span style={{ fontSize:9, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase" }}>
            Developer Fee
          </span>
          <div style={{ display:"flex", gap:20, alignItems:"center" }}>
            <span style={{ fontSize:10 }}>
              <span style={{ opacity:0.5, fontSize:8, marginRight:4 }}>TOTAL</span>
              {fmtM(calcs.devFeeTotal)}
            </span>
            <span style={{ fontSize:10 }}>
              <span style={{ opacity:0.5, fontSize:8, marginRight:4 }}>{(assumptions.dev_fee_pct * 100).toFixed(1)}% OF COSTS</span>
              {fmtM(calcs.devFeeTotal)}
            </span>
          </div>
        </div>
        <div style={{ background:"white", border:"1px solid #e0e0e0", borderTop:"none", borderRadius:"0 0 6px 6px" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11, fontFamily:"Inter, sans-serif" }}>
            <tbody>
              {[
                { label: `Cash Portion (${(assumptions.cash_fee_pct * 100).toFixed(0)}%)`,     amount: calcs.devFeeCash,     basis: true  },
                { label: `Deferred Portion (${((1 - assumptions.cash_fee_pct) * 100).toFixed(0)}%)`, amount: calcs.devFeeDeferred, basis: true  },
              ].map(row => (
                <tr key={row.label} style={{ borderBottom:"1px solid #f5f5f5" }}>
                  <td style={{ padding:"5px 10px", paddingLeft:24, fontSize:11, color:"#666" }}>{row.label}</td>
                  <td style={{ padding:"5px 10px", textAlign:"right", fontSize:11, fontWeight:500 }}>{fmt$(row.amount)}</td>
                  <td style={{ padding:"5px 8px", textAlign:"right", fontSize:9, color:"#bbb" }}>
                    {totalUnits > 0 ? fmt$(Math.round(row.amount / totalUnits)) : ""}
                  </td>
                  <td style={{ padding:"5px 10px", textAlign:"center", fontSize:9, color:"#1a6b3c" }}>
                    {row.basis ? "✓" : ""}
                  </td>
                  <td colSpan={2} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* TDC Summary Footer */}
      <div style={{ background:"#111", color:"white", borderRadius:6, padding:"16px 20px", marginTop:8 }}>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(5, 1fr)", gap:16 }}>
          {[
            { label:"Total Dev Cost",    value: fmtM(calcs.tdc),           sub: fmt$(Math.round(calcs.tdc / totalUnits)) + "/unit", highlight: true },
            { label:"Eligible Basis",    value: fmtM(calcs.eligibleBasis), sub: fmtPct(calcs.eligibleBasis / calcs.tdc) + " of TDC" },
            { label:"Dev Fee",           value: fmtM(calcs.devFeeTotal),   sub: fmtPct(assumptions.dev_fee_pct) + " of costs" },
            { label:"Hard Costs",        value: fmtM(calcs.hcTotal),       sub: fmt$(Math.round(calcs.hcTotal / totalUnits)) + "/unit" },
            { label:"TDC ex Dev Fee",    value: fmtM(calcs.subtotal),      sub: fmt$(Math.round(calcs.subtotal / totalUnits)) + "/unit" },
          ].map(m => (
            <div key={m.label}>
              <div style={{ fontSize:8, color:"#888", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:4 }}>{m.label}</div>
              <div style={{ fontSize: m.highlight ? 20 : 16, fontWeight:700, fontFamily:"'Playfair Display', serif", color: m.highlight ? "white" : "#ccc" }}>
                {m.value}
              </div>
              <div style={{ fontSize:9, color:"#555", marginTop:2 }}>{m.sub}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
