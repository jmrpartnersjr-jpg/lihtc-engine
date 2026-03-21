import { useState, useCallback, useEffect, useRef } from "react";
import { fetchProjects, fetchFinancialAssumptions, fetchScenarios, createScenario, loadScenario } from "./db.js";
import UnitMixPanel from "./UnitMix.jsx";
import DebtPanel from "./Debt.jsx";
import TaxCreditPanel from "./TaxCredit.jsx";
import DevBudgetPanel from "./DevBudget.jsx";
import CapitalStackPanel from "./CapitalStack.jsx";
import ConstructionCFPanel from "./ConstructionCF.jsx";
import SourcesUsesPanel from "./SourcesUses.jsx";
import ProformaPanel from "./Proforma.jsx";
import SchedulePanel from "./Schedule.jsx";
import LeaseUpPanel from "./LeaseUp.jsx";
import GapSolverPanel from "./GapSolver.jsx";
import DispositionPanel from "./Disposition.jsx";
import SponsorCFPanel from "./SponsorCF.jsx";
import DashboardPanel from "./Dashboard.jsx";

// ─── CHANGE 1 of 4: Import context hooks and new components ──────────────────
import { useLihtc } from "./context/LihtcContext.jsx";
import { SaveStatus } from "./components/SaveStatus.jsx";
import { VersionPanel } from "./components/VersionPanel.jsx";
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// BUNDLED PROJECT DATA
// ─────────────────────────────────────────────────────────────────────────────
const PROJECTS_DATA = [
  {
    id: "800b91fa-f8a6-4cf7-9bd9-12dfed3af2e4",
    name: "Apollo Scriber Lake",
    client_name: "Blackfish Capital",
    project_type: "lihtc_4pct_bond",
    status: "active",
    city: "Lynnwood", state: "WA",
    total_units: 175,
    total_dev_cost: 67087503,
    next_deadline: "2026-03-23",
    next_deadline_label: "WSHFC Application Due",
    financial_assumptions: {
      // Operating
      base_residential_rev: 3826884,
      total_other_income: 245700,
      vacancy_rate: 0.06,
      rent_growth: 0.02,
      other_income_growth: 0.02,
      opex_y1: 1274999,
      opex_inflation: 0.03,
      lp_mgmt_fee_y1: 17500,
      gp_mgmt_fee_y1: 17500,
      mgmt_fee_growth: 0.03,
      // Debt
      loan_amount: 34049114.78,
      interest_rate: 0.0585,
      amort_years: 40,
      annual_debt_service: 2220317.67,
      // Tax credit equity
      annual_credit: 2952064.30,
      credit_years: 10,
      credit_price: 0.82,
      // DDF
      deferred_fee: 5927282.06,
      ddf_interest_rate: 0.00,
      // Capital stack
      total_dev_cost: 67087503,
      other_sources: 2952064.30,
      developer_fee_cash: 2920221,
      // Disposition
      exit_cap_rate: 0.0625,
      cost_of_sale_pct: 0.035,
      lp_share: 0.10,
      gp_share: 0.90,
    },
  },
  {
    id: "870b49c9-9054-4b33-9983-41b6d2a5d98a",
    name: "The Approach at Kenmore",
    client_name: "Imagine Housing",
    project_type: "lihtc_4pct_bond",
    status: "active",
    city: "Kenmore", state: "WA",
    total_units: 103, total_dev_cost: 63426207,
    next_deadline: null, next_deadline_label: null,
    financial_assumptions: null,
  },
  {
    id: "632315a0-9275-49e8-ae79-6288014e5747",
    name: "Apollo Edmonds",
    client_name: "Blackfish Capital",
    project_type: "lihtc_4pct_bond",
    status: "active",
    city: "Edmonds", state: "WA",
    total_units: 256, total_dev_cost: 107090874,
    next_deadline: "2026-03-11", next_deadline_label: "Equity LOI",
    financial_assumptions: null,
  },
  {
    id: "8d8b4264-9aa6-42e5-9083-b6f4a81c1a6f",
    name: "The Sarah Queen",
    client_name: "Gardner Global",
    project_type: "other",
    status: "active",
    city: "Seattle", state: "WA",
    total_units: 117, total_dev_cost: 50000000,
    next_deadline: "2026-03-31", next_deadline_label: "LOIs from Capital Partners",
    financial_assumptions: null,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// CALCULATION ENGINE
// ─────────────────────────────────────────────────────────────────────────────
function calcMonthlyPayment(principal, annualRate, amortYears) {
  const n = amortYears * 12, r = annualRate / 12;
  if (r === 0) return principal / n;
  return principal * r * Math.pow(1+r,n) / (Math.pow(1+r,n)-1);
}

function getBalanceAtYear(year, ads, loanAmount, interestRate) {
  const r = interestRate/12, pmt = ads/12;
  let bal = loanAmount;
  for (let i = 0; i < year*12; i++) bal -= (pmt - bal*r);
  return Math.max(bal, 0);
}

function calcEquity(fa, overrides = {}) {
  const a = { ...fa, ...overrides };
  const annualCredit = Number(a.annual_credit);
  const creditYears  = Number(a.credit_years) || 10;
  const creditPrice  = Number(a.credit_price);
  const grossEquity  = annualCredit * creditYears * creditPrice;
  return { annualCredit, creditYears, creditPrice, grossEquity };
}

function calcCapitalStack(fa, overrides = {}) {
  const a = { ...fa, ...overrides };
  const eq = calcEquity(fa, overrides);
  const permDebt    = Number(a.loan_amount);
  const otherSrc    = Number(a.other_sources) || 0;
  const deferredFee = Number(a.deferred_fee) || 0;
  const tdc         = Number(a.total_dev_cost);
  const totalSources  = permDebt + eq.grossEquity + otherSrc + deferredFee;
  const gap           = tdc - totalSources;
  const gapPctTdc     = gap / tdc;
  return {
    tdc, permDebt, grossEquity: eq.grossEquity,
    otherSrc, deferredFee,
    totalSources, gap, gapPctTdc,
    ...eq,
  };
}

function buildProforma(fa, overrides = {}, years = 15) {
  if (!fa) return null;
  const a = { ...fa, ...overrides };

  const ads = (overrides.loan_amount != null || overrides.interest_rate != null || overrides.amort_years != null)
    ? calcMonthlyPayment(Number(a.loan_amount), Number(a.interest_rate), Number(a.amort_years)) * 12
    : Number(a.annual_debt_service);

  const rows = [], adjCFs = [];

  for (let yr = 1; yr <= years; yr++) {
    const rf = Math.pow(1+Number(a.rent_growth), yr-1);
    const of = Math.pow(1+Number(a.other_income_growth), yr-1);
    const ef = Math.pow(1+Number(a.opex_inflation), yr-1);
    const ff = Math.pow(1+Number(a.mgmt_fee_growth), yr-1);
    const resRev   = Number(a.base_residential_rev) * rf;
    const otherRev = Number(a.total_other_income) * of;
    const adjInc   = resRev + otherRev;
    const vacLoss  = -adjInc * Number(a.vacancy_rate);
    const egi      = adjInc + vacLoss;
    const opex     = -(Number(a.opex_y1) * ef);
    const noi      = egi + opex;
    const ds       = -Math.abs(ads);
    const cf       = noi + ds;
    const dscr     = noi / Math.abs(ds);
    const lpFee    = -(Number(a.lp_mgmt_fee_y1) * ff);
    const gpFee    = -(Number(a.gp_mgmt_fee_y1) * ff);
    const adjCf    = cf + lpFee + gpFee;
    adjCFs.push(adjCf);
    rows.push({ yr, resRev, otherRev, vacLoss, egi, opex, noi, ds, dscr, cf, lpFee, gpFee, adjCf, ads });
  }

  let ddfBal = Number(a.deferred_fee);
  for (let i = 0; i < rows.length; i++) {
    const interest = ddfBal * Number(a.ddf_interest_rate);
    const payment  = Math.min(Math.max(adjCFs[i], 0), ddfBal + interest);
    ddfBal = Math.max(ddfBal + interest - payment, 0);
    rows[i].ddfPayment = -payment;
    rows[i].ddfBalance = ddfBal;
  }

  const yr15noi  = rows[years-1].noi;
  const debtBal  = getBalanceAtYear(years, ads, Number(a.loan_amount), Number(a.interest_rate));
  const grossVal = yr15noi / Number(a.exit_cap_rate);
  const costSale = grossVal * Number(a.cost_of_sale_pct);
  const netProc  = grossVal - costSale - debtBal;

  return {
    rows, ads,
    dispo: { grossVal, costSale, debtBal, netProc, capRate: Number(a.exit_cap_rate) },
    summary: {
      y1_egi: rows[0].egi, y1_noi: rows[0].noi, y1_dscr: rows[0].dscr,
      y1_cf: rows[0].cf,   y1_adjCf: rows[0].adjCf,
      y15_noi: yr15noi,    y15_dscr: rows[years-1].dscr,
      ddf_remaining: ddfBal, net_proceeds: netProc, ads,
    },
    stack: calcCapitalStack(fa, overrides),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// FORMATTERS
// ─────────────────────────────────────────────────────────────────────────────
const fmt$   = v => v==null?"—":"$"+Math.round(v).toLocaleString();
const fmtX   = v => v==null?"—":v.toFixed(3)+"x";
const fmtPct = v => v==null?"—":(v*100).toFixed(2)+"%";
const fmtM   = v => v==null?"—":"$"+(v/1000000).toFixed(2)+"M";
const fmtMc  = v => v==null?"—":"$"+(v/1000000).toFixed(3)+"M";

const PROJECT_TYPE_LABELS = {
  lihtc_9pct:"9% LIHTC", lihtc_4pct_bond:"4% LIHTC / Bond",
  lihtc_acq_rehab:"Acq-Rehab", market_rate_acquisition:"Market Rate",
  affordable_acquisition:"Affordable Acq", preservation:"Preservation",
  nmtc:"NMTC", other:"Other",
};

const CLIENT_PALETTE = ["#1a3a6b","#1a6b3c","#8B2500","#5a3a00","#4a1a6b","#006b6b"];
const SCENARIO_COLORS = ["#111","#1a6b3c","#1a3a6b","#8B2500","#5a3a00","#4a1a6b"];
const CLIENT_COLORS = {};
[...new Set(PROJECTS_DATA.map(p=>p.client_name))].forEach((c,i)=>{ CLIENT_COLORS[c]=CLIENT_PALETTE[i%CLIENT_PALETTE.length]; });

const PARAM_GROUPS = [
  {
    label:"Revenue", color:"#1a6b3c",
    params:[
      {key:"vacancy_rate",       label:"Vacancy Rate",      type:"pct",    step:0.005,  min:0,      max:0.20},
      {key:"rent_growth",        label:"Annual Rent Growth", type:"pct",    step:0.005,  min:0,      max:0.06},
      {key:"total_other_income", label:"Other Income (Y1)",  type:"dollar", step:5000,   min:0,      max:500000},
    ],
  },
  {
    label:"Expenses", color:"#8B2500",
    params:[
      {key:"opex_y1",        label:"OpEx Y1",        type:"dollar", step:10000, min:500000, max:2500000},
      {key:"opex_inflation", label:"OpEx Inflation",  type:"pct",    step:0.005, min:0,      max:0.08},
    ],
  },
  {
    label:"Debt", color:"#1a3a6b",
    params:[
      {key:"loan_amount",   label:"Loan Amount",        type:"dollar", step:500000, min:5000000, max:80000000},
      {key:"interest_rate", label:"Interest Rate",      type:"pct",    step:0.0025, min:0.03,    max:0.10},
      {key:"amort_years",   label:"Amortization (Yrs)", type:"int",    step:5,      min:25,      max:40},
    ],
  },
  {
    label:"Tax Credit Equity", color:"#5a3a00",
    params:[
      {key:"credit_price", label:"Credit Price (¢/$)", type:"pct", step:0.005, min:0.65, max:0.95},
    ],
  },
  {
    label:"Disposition", color:"#4a1a6b",
    params:[
      {key:"exit_cap_rate", label:"Exit Cap Rate", type:"pct", step:0.0025, min:0.04, max:0.12},
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// SMALL COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────
function Badge({ ok, label, neutral }) {
  const bg    = neutral?"#f0f0f0" : ok?"#e6f4ed":"#fce8e3";
  const color = neutral?"#666"    : ok?"#1a6b3c":"#8B2500";
  const bdr   = neutral?"#ddd"    : ok?"#b8dfc8":"#f5c2b0";
  return (
    <span style={{fontSize:9,padding:"2px 7px",borderRadius:2,background:bg,color,fontWeight:700,letterSpacing:"0.05em",textTransform:"uppercase",border:`1px solid ${bdr}`,whiteSpace:"nowrap"}}>{label}</span>
  );
}

function MetricRow({ label, value, delta, dimLabel }) {
  const pos = delta > 0;
  const d   = delta!=null && Math.abs(delta)>=1;
  const col = d ? (pos?"#1a6b3c":"#8B2500") : "transparent";
  return (
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
      <span style={{fontSize:10,color:dimLabel?"#bbb":"#888",letterSpacing:"0.04em",textTransform:"uppercase"}}>{label}</span>
      <div style={{display:"flex",gap:8,alignItems:"center"}}>
        {d && <span style={{fontSize:9,color:col,fontWeight:700}}>{pos?"+":""}{Math.abs(delta)>999999?"$"+(Math.abs(delta)/1000000).toFixed(2)+"M":fmt$(Math.abs(delta))}</span>}
        <span style={{fontSize:12,fontWeight:600,color:"#111"}}>{value}</span>
      </div>
    </div>
  );
}

function ParamInput({ param, value, onChange }) {
  const display = param.type==="pct"    ? (value*100).toFixed(param.key==="credit_price"?1:2)+"%"
                : param.type==="dollar" ? "$"+Math.round(value).toLocaleString()
                : String(value);
  const pct = Math.max(0, Math.min(1, (value-param.min)/(param.max-param.min)));
  const step = v => onChange(Math.max(param.min, Math.min(param.max, parseFloat(v.toFixed(6)))));
  const accent = param.key==="credit_price" ? "#5a3a00" : "#111";
  return (
    <div style={{marginBottom:13}}>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
        <span style={{fontSize:10,color:"#666",letterSpacing:"0.04em",textTransform:"uppercase"}}>{param.label}</span>
        <span style={{fontSize:12,fontWeight:700,color: param.key==="credit_price"?"#5a3a00":"#111"}}>{display}</span>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:7}}>
        <button onClick={()=>step(value-param.step)} style={btnSty}>−</button>
        <div style={{flex:1,position:"relative",height:4,background:"#e5e5e5",borderRadius:2,cursor:"pointer"}}
          onClick={e=>{
            const r=e.currentTarget.getBoundingClientRect();
            step(Math.round((param.min+(e.clientX-r.left)/r.width*(param.max-param.min))/param.step)*param.step);
          }}>
          <div style={{position:"absolute",left:0,top:0,width:`${pct*100}%`,height:"100%",background:accent,borderRadius:2}}/>
          <div style={{position:"absolute",top:"50%",left:`${pct*100}%`,transform:"translate(-50%,-50%)",width:10,height:10,borderRadius:"50%",background:accent,border:"2px solid white",boxShadow:"0 1px 3px rgba(0,0,0,0.25)"}}/>
        </div>
        <button onClick={()=>step(value+param.step)} style={btnSty}>+</button>
      </div>
    </div>
  );
}

const btnSty = {width:22,height:22,borderRadius:3,border:"1px solid #d0d0d0",background:"white",cursor:"pointer",fontSize:13,color:"#333",padding:0,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontFamily:"inherit"};
const iconBtn = {width:18,height:18,border:"none",background:"none",cursor:"pointer",padding:0,display:"flex",alignItems:"center",justifyContent:"center",color:"#777",fontSize:11,borderRadius:2};

function ScenarioCard({ scenario, index, isBase, baseFA, onUpdate, onRemove, onDuplicate }) {
  const pf  = buildProforma(baseFA, scenario.overrides);
  const bpf = buildProforma(baseFA, {});
  if (!pf||!bpf) return null;
  const s=pf.summary, bs=bpf.summary;
  const st=pf.stack, bst=bpf.stack;
  const delta = (v,bv) => { const d=v-bv; return Math.abs(d)<1?null:d; };
  const cp = scenario.overrides.credit_price ?? Number(baseFA.credit_price);

  return (
    <div style={{background:"white",border:isBase?"2px solid #111":"1px solid #e0e0e0",borderRadius:6,overflow:"hidden",display:"flex",flexDirection:"column",boxShadow:isBase?"0 2px 12px rgba(0,0,0,0.07)":"0 1px 4px rgba(0,0,0,0.04)"}}>
      <div style={{padding:"11px 14px 9px",borderBottom:"1px solid #f0f0f0",display:"flex",alignItems:"center",gap:7}}>
        <div style={{width:16,height:16,borderRadius:2,background:SCENARIO_COLORS[index%SCENARIO_COLORS.length],flexShrink:0}}/>
        <input value={scenario.name} onChange={e=>onUpdate({...scenario,name:e.target.value})}
          style={{flex:1,border:"none",outline:"none",fontSize:11,fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase",background:"transparent",color:"#111",fontFamily:"inherit"}}/>
        <div style={{display:"flex",gap:3}}>
          <button onClick={onDuplicate} title="Duplicate" style={iconBtn}>⎘</button>
          {!isBase && <button onClick={onRemove} title="Remove" style={{...iconBtn,color:"#ccc"}}>✕</button>}
        </div>
      </div>
      <div style={{padding:"7px 14px",display:"flex",gap:5,flexWrap:"wrap",borderBottom:"1px solid #f8f8f8"}}>
        <Badge ok={s.y1_dscr>=1.15} label={`DSCR ${fmtX(s.y1_dscr)}`}/>
        <Badge ok={s.ddf_remaining===0} label={s.ddf_remaining===0?"DDF Clear":`DDF $${(s.ddf_remaining/1000).toFixed(0)}k`}/>
        <Badge ok={st.gap<=0} label={st.gap>0?`Gap ${fmtM(st.gap)}`:"Stack Closes"}/>
      </div>
      <div style={{padding:"9px 14px",borderBottom:"1px solid #f0f0f0"}}>
        <div style={{fontSize:8,letterSpacing:"0.1em",textTransform:"uppercase",color:"#ccc",fontWeight:700,marginBottom:6}}>Operating</div>
        <MetricRow label="Y1 NOI"    value={fmt$(s.y1_noi)}     delta={delta(s.y1_noi,bs.y1_noi)}/>
        <MetricRow label="Cash Flow" value={fmt$(s.y1_cf)}       delta={delta(s.y1_cf,bs.y1_cf)}/>
        <MetricRow label="Net Dispo" value={fmt$(s.net_proceeds)} delta={delta(s.net_proceeds,bs.net_proceeds)}/>
      </div>
      <div style={{padding:"9px 14px",borderBottom:"1px solid #f0f0f0",background:"#fdfbf8"}}>
        <div style={{fontSize:8,letterSpacing:"0.1em",textTransform:"uppercase",color:"#5a3a00",fontWeight:700,marginBottom:6}}>Capital Stack</div>
        <MetricRow label="Credit Price" value={`¢${(cp*100).toFixed(1)}`} delta={null}/>
        <MetricRow label="Gross Equity" value={fmtM(st.grossEquity)} delta={delta(st.grossEquity,bst.grossEquity)}/>
        <MetricRow label={st.gap>0?"Stack Gap":"Stack Surplus"} value={fmt$(Math.abs(st.gap))} delta={delta(-st.gap,-bst.gap)}/>
      </div>
      <div style={{padding:"10px 14px",flex:1,overflowY:"auto",maxHeight:500}}>
        {PARAM_GROUPS.map(group => (
          <div key={group.label} style={{marginBottom:14}}>
            <div style={{fontSize:8,letterSpacing:"0.12em",textTransform:"uppercase",color:group.color,fontWeight:700,marginBottom:7,paddingBottom:3,borderBottom:`1.5px solid ${group.color}22`}}>{group.label}</div>
            {group.params.map(param => (
              <ParamInput key={param.key} param={param}
                value={scenario.overrides[param.key] ?? Number(baseFA[param.key])}
                onChange={v=>onUpdate({...scenario,overrides:{...scenario.overrides,[param.key]:v}})}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPARISON TABLE
// ─────────────────────────────────────────────────────────────────────────────
function ComparisonTable({ scenarios, baseFA }) {
  const proformas = scenarios.map(sc=>buildProforma(baseFA,sc.overrides)).filter(Boolean);
  if (!proformas.length) return null;

  const ROWS = [
    {label:"CAPITAL STACK", section:true},
    {label:"Credit Price",   key:"stack.creditPrice",   fmt:v=>`¢${(v*100).toFixed(1)}`},
    {label:"Gross Equity",   key:"stack.grossEquity",   fmt:fmtM},
    {label:"Stack Gap",      key:"stack.gap",           fmt:v=>fmt$(Math.abs(v)), threshold:{max:0}},
    {label:"YEAR 1 OPERATING", section:true},
    {label:"EGI",            key:"summary.y1_egi",      fmt:fmt$},
    {label:"NOI",            key:"summary.y1_noi",      fmt:fmt$},
    {label:"ADS",            key:"summary.ads",         fmt:fmt$},
    {label:"DSCR",           key:"summary.y1_dscr",     fmt:fmtX, threshold:{min:1.15}},
    {label:"Cash Flow",      key:"summary.y1_cf",       fmt:fmt$},
    {label:"YEAR 15",        section:true},
    {label:"NOI",            key:"summary.y15_noi",     fmt:fmt$},
    {label:"DDF Remaining",  key:"summary.ddf_remaining",fmt:fmt$, threshold:{max:0}},
    {label:"Net Dispo",      key:"summary.net_proceeds", fmt:fmt$},
  ];

  const getVal = (pf, keyPath) => {
    const parts = keyPath.split(".");
    let obj = pf;
    for (const p of parts) { obj = obj?.[p]; }
    return obj;
  };

  const cW = Math.max(90, Math.floor(480/scenarios.length));
  return (
    <div style={{fontSize:11}}>
      <div style={{display:"flex",borderBottom:"2px solid #111",paddingBottom:7,marginBottom:2}}>
        <div style={{width:140,flexShrink:0,fontSize:9,color:"#888",textTransform:"uppercase",letterSpacing:"0.06em"}}>Metric</div>
        {scenarios.map((sc,i)=>(
          <div key={sc.id} style={{width:cW,textAlign:"right"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"flex-end",gap:4}}>
              <div style={{width:7,height:7,borderRadius:1,background:SCENARIO_COLORS[i%SCENARIO_COLORS.length],flexShrink:0}}/>
              <span style={{fontSize:9,fontWeight:700,letterSpacing:"0.04em",textTransform:"uppercase",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{sc.name}</span>
            </div>
          </div>
        ))}
      </div>
      {ROWS.map((row,ri)=>{
        if (row.section) return (
          <div key={ri} style={{display:"flex",marginTop:12,marginBottom:3,paddingBottom:3,borderBottom:"1px solid #e0e0e0"}}>
            <div style={{width:140,fontSize:9,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:"#aaa"}}>{row.label}</div>
          </div>
        );
        const vals  = proformas.map(pf=>getVal(pf,row.key));
        const best  = row.threshold?.min ? Math.max(...vals) : Math.min(...vals);
        const worst = row.threshold?.min ? Math.min(...vals) : Math.max(...vals);
        return (
          <div key={ri} style={{display:"flex",padding:"4px 0",borderBottom:"1px solid #f5f5f5",alignItems:"center"}}>
            <div style={{width:140,flexShrink:0,fontSize:10,color:"#666"}}>{row.label}</div>
            {vals.map((val,vi)=>{
              const isBest  = val===best  && vals.filter(v=>v===best).length<vals.length;
              const isWorst = val===worst && vals.filter(v=>v===worst).length<vals.length && scenarios.length>1;
              const tOk = row.threshold?.min?val>=row.threshold.min:row.threshold?.max?val<=row.threshold.max:null;
              return (
                <div key={vi} style={{width:cW,textAlign:"right"}}>
                  <span style={{fontSize:11,fontWeight:vi===0?700:500,
                    color:tOk===false?"#8B2500":tOk===true?"#1a6b3c":isBest?"#1a6b3c":isWorst?"#8B2500":"#111"
                  }}>{row.fmt(val)}</span>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SPARKLINES
// ─────────────────────────────────────────────────────────────────────────────
function Sparkline({ scenarios, baseFA, metricKey, label, fmt }) {
  const allPF = scenarios.map(sc=>buildProforma(baseFA,sc.overrides)).filter(Boolean);
  const allSeries = allPF.map(pf=>pf.rows.map(r=>{
    if(metricKey==="dscr")   return r.dscr;
    if(metricKey==="noi")    return r.noi;
    if(metricKey==="adjCf")  return r.adjCf;
    if(metricKey==="ddfBal") return r.ddfBalance;
    return 0;
  }));
  const allVals=allSeries.flat(), W=460, H=65;
  const minV=Math.min(...allVals), maxV=Math.max(...allVals), range=maxV-minV||1;
  const toY=v=>H-((v-minV)/range)*(H-4)-2;
  const toX=i=>i*(W/14);
  return (
    <div>
      <div style={{fontSize:8,textTransform:"uppercase",letterSpacing:"0.1em",color:"#888",marginBottom:4,fontWeight:700}}>{label}</div>
      <svg width="100%" viewBox={`0 0 ${W} ${H+18}`} style={{overflow:"visible"}}>
        {metricKey==="dscr"&&(
          <>
            <line x1={0} y1={toY(1.15)} x2={W} y2={toY(1.15)} stroke="#e0e0e0" strokeWidth={1} strokeDasharray="4 2"/>
            <text x={W+3} y={toY(1.15)+3} fontSize={7} fill="#bbb" fontFamily="Inter, sans-serif">1.15x</text>
          </>
        )}
        {allSeries.map((series,si)=>(
          <g key={si}>
            <polyline points={series.map((v,i)=>`${toX(i)},${toY(v)}`).join(" ")} fill="none" stroke={SCENARIO_COLORS[si%SCENARIO_COLORS.length]} strokeWidth={si===0?2:1.5} strokeOpacity={si===0?1:0.65}/>
            <circle cx={toX(14)} cy={toY(series[14])} r={3} fill={SCENARIO_COLORS[si%SCENARIO_COLORS.length]}/>
          </g>
        ))}
        {[1,5,10,15].map(yr=>(
          <text key={yr} x={toX(yr-1)} y={H+14} textAnchor="middle" fontSize={7} fill="#bbb" fontFamily="Inter, sans-serif">Yr{yr}</text>
        ))}
      </svg>
      <div style={{display:"flex",gap:10,marginTop:2,flexWrap:"wrap"}}>
        {scenarios.map((sc,si)=>(
          <div key={sc.id} style={{display:"flex",alignItems:"center",gap:4,fontSize:9}}>
            <div style={{width:12,height:2,background:SCENARIO_COLORS[si%SCENARIO_COLORS.length]}}/>
            <span style={{color:"#888"}}>{sc.name}: </span>
            <span style={{fontWeight:700}}>{allSeries[si]?.[14]!=null?fmt(allSeries[si][14]):"—"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PROJECT SIDEBAR
// ─────────────────────────────────────────────────────────────────────────────
function ProjectSwitcher({ projects, activeId, onSelect }) {
  return (
    <div>
      {projects.map(p=>{
        const active=p.id===activeId, hasFA=!!p.financial_assumptions, color=CLIENT_COLORS[p.client_name]||"#444";
        return (
          <div key={p.id} onClick={()=>onSelect(p.id)}
            style={{padding:"11px 16px",cursor:"pointer",borderLeft:active?"3px solid #111":"3px solid transparent",borderBottom:"1px solid #f0f0f0",background:active?"#fafafa":"white"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:11,fontWeight:700,color:"#111",marginBottom:3,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{p.name}</div>
                <div style={{display:"flex",alignItems:"center",gap:5,marginBottom:5}}>
                  <div style={{width:6,height:6,borderRadius:1,background:color,flexShrink:0}}/>
                  <span style={{fontSize:9,color,fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase"}}>{p.client_name}</span>
                </div>
                <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                  <span style={{fontSize:9,padding:"1px 5px",borderRadius:2,background:"#f0f0f0",color:"#666"}}>{PROJECT_TYPE_LABELS[p.project_type]||p.project_type}</span>
                  {p.total_units&&<span style={{fontSize:9,padding:"1px 5px",borderRadius:2,background:"#f0f0f0",color:"#666"}}>{p.total_units}u</span>}
                  <span style={{fontSize:9,padding:"1px 5px",borderRadius:2,background:"#f0f0f0",color:"#666"}}>{fmtM(p.total_dev_cost)}</span>
                </div>
              </div>
              <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:4,flexShrink:0}}>
                <Badge ok={hasFA} label={hasFA?"Model ✓":"No Model"}/>
                {p.next_deadline&&(
                  <div style={{fontSize:8,color:"#999",textAlign:"right",lineHeight:1.4}}>
                    {new Date(p.next_deadline+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})}<br/>
                    <span style={{color:"#ccc"}}>{p.next_deadline_label}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────────────────────────────────────
let _id=0;
const mkId=()=>++_id;

const defaultScenarios = fa => [
  {id:mkId(), name:"Base Case",   overrides:{}},
  {id:mkId(), name:"¢0.79 Price", overrides:{credit_price:0.79}},
  {id:mkId(), name:"¢0.82 Price", overrides:{credit_price:0.82}},
];

export default function App() {
  const [activeId,    setActiveId]    = useState(PROJECTS_DATA[0].id);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [tab,         setTab]         = useState("dashboard");
  const [scenarios,   setScenarios]   = useState(()=>defaultScenarios(PROJECTS_DATA[0].financial_assumptions));
  const [unitMixRev,  setUnitMixRev]  = useState(null);
  const [debtOverride, setDebtOverride] = useState(null);
  const [creditOverride, setCreditOverride] = useState(null);
  const [budgetBasis, setBudgetBasis] = useState(null);

  // ── CHANGE 2 of 4: Pull notifyTabChange from context + version panel state ─
  const { notifyTabChange } = useLihtc();
  const [versionPanelOpen, setVersionPanelOpen] = useState(false);
  // ──────────────────────────────────────────────────────────────────────────

  // ── Supabase-backed state ──────────────────────────────────────────────────
  const [dbProjects,    setDbProjects]    = useState(null);
  const [dbFA,          setDbFA]          = useState({});
  const [dbScenario,    setDbScenario]    = useState(null);
  const [dbBudgetItems, setDbBudgetItems] = useState(null);
  const [dbBudgetAssump,setDbBudgetAssump]= useState(null);
  const [dbUnitMix,     setDbUnitMix]     = useState(null);
  const [dbSources,     setDbSources]     = useState(null);
  const [dbTranches,    setDbTranches]    = useState(null);
  const [dbFeeRows,     setDbFeeRows]     = useState(null);
  const [dbLoadError,   setDbLoadError]   = useState(null);
  const loadingRef = useRef(false);

  useEffect(() => {
    fetchProjects()
      .then(rows => setDbProjects(rows))
      .catch(err => { console.warn("Supabase projects load failed — using fallback", err); setDbProjects([]); });
  }, []);

  useEffect(() => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setDbScenario(null);
    setDbBudgetItems(null);
    setDbBudgetAssump(null);
    setDbUnitMix(null);
    setDbSources(null);
    setDbTranches(null);
    setDbFeeRows(null);
    setDbLoadError(null);

    async function load() {
      try {
        const fa = await fetchFinancialAssumptions(activeId);
        if (fa) setDbFA(prev => ({ ...prev, [activeId]: fa }));
        const scenRows = await fetchScenarios(activeId);
        if (scenRows.length === 0) { loadingRef.current = false; return; }
        const baseScen = scenRows.find(s => s.is_base) || scenRows[0];
        setDbScenario(baseScen);
        const payload = await loadScenario(baseScen.id);
        setDbBudgetItems(payload.budgetItems);
        setDbBudgetAssump(payload.budgetAssump);
        setDbUnitMix(payload.unitMix);
        setDbSources(payload.sources);
        setDbTranches(payload.tranches);
        setDbFeeRows(payload.devFeeRows);
        setScenarios(scenRows.map(r => ({ id: r.id, name: r.name, overrides: {}, _db: true })));
      } catch (err) {
        console.warn("Supabase scenario load failed — using hardcoded data", err);
        setDbLoadError(err.message);
      } finally {
        loadingRef.current = false;
      }
    }
    load();
  }, [activeId]);

  const activeProject = (dbProjects?.find(p=>p.id===activeId)) || PROJECTS_DATA.find(p=>p.id===activeId);
  const rawFA = dbFA[activeId] || activeProject?.financial_assumptions || null;

  const baseFA = (() => {
    if (!rawFA) return null;
    let fa = { ...rawFA };
    if (unitMixRev != null) fa = { ...fa, base_residential_rev: unitMixRev };
    if (debtOverride) fa = { ...fa,
      loan_amount: debtOverride.loanAmount,
      interest_rate: debtOverride.rate,
      amort_years: debtOverride.amort,
      annual_debt_service: debtOverride.ads,
    };
    if (creditOverride) fa = { ...fa,
      annual_credit: creditOverride.annualCredit,
      credit_years: creditOverride.creditYears,
      credit_price: creditOverride.creditPrice,
    };
    return fa;
  })();

  const allProjects = dbProjects != null
    ? PROJECTS_DATA.map(p => ({ ...p, ...(dbProjects.find(d=>d.id===p.id)||{}) }))
    : PROJECTS_DATA;

  // ── CHANGE 3 of 4: selectProject calls notifyTabChange before switching ────
  const selectProject = useCallback(id => {
    notifyTabChange("unitmix");   // save current state before switching projects
    setActiveId(id);
    setTab("unitmix");
    setUnitMixRev(null);
    setDebtOverride(null);
    setCreditOverride(null);
    const p = PROJECTS_DATA.find(p => p.id === id);
    setScenarios(defaultScenarios(p?.financial_assumptions));
  }, [notifyTabChange]);
  // ──────────────────────────────────────────────────────────────────────────

  const addScenario = ()=>setScenarios(s=>[...s,{id:mkId(),name:`Scenario ${s.length+1}`,overrides:{...(s[s.length-1]?.overrides||{})}}]);
  const updateSc    = (id,sc)=>setScenarios(s=>s.map(x=>x.id===id?sc:x));
  const removeSc    = id=>setScenarios(s=>s.filter(x=>x.id!==id));
  const dupSc       = id=>{ const src=scenarios.find(s=>s.id===id); setScenarios(s=>[...s,{...src,id:mkId(),name:src.name+" (copy)"}]); };

  const TABS = [
    {key:"dashboard", label:"Summary"},
    {key:"unitmix",   label:"Unit Mix"},
    {key:"debt",      label:"Debt"},
    {key:"devbudget", label:"Dev Budget"},
    {key:"constcf",   label:"Const. CF"},
    {key:"taxcredit", label:"Tax Credit"},
    {key:"stack",     label:"Capital Stack"},
    {key:"sources",   label:"Sources & Uses"},
    {key:"proforma",  label:"Proforma"},
    {key:"schedule",  label:"Schedule"},
    {key:"leaseup",   label:"Lease-Up"},
    {key:"gapsolver", label:"Gap Solver"},
    {key:"disposition", label:"Disposition"},
    {key:"sponsorcf", label:"Sponsor CF"},
    {key:"scenarios", label:`Edit (${scenarios.length})`},
    {key:"table",     label:"Table"},
    {key:"charts",    label:"Charts"},
  ];

  return (
    <div style={{display:"flex",height:"100vh",fontFamily:"Inter, sans-serif",background:"#f5f5f3",overflow:"hidden"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Playfair+Display:wght@400;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        button:hover{opacity:0.75;}
        ::-webkit-scrollbar{width:4px;height:4px;}
        ::-webkit-scrollbar-thumb{background:#ccc;border-radius:2px;}
        ::-webkit-scrollbar-track{background:transparent;}
      `}</style>

      {/* SIDEBAR */}
      <div style={{width:sidebarOpen?248:0,minWidth:sidebarOpen?248:0,background:"white",borderRight:"1px solid #e8e8e8",display:"flex",flexDirection:"column",overflow:"hidden",transition:"width 0.18s ease, min-width 0.18s ease",flexShrink:0}}>
        <div style={{padding:"14px 16px 10px",borderBottom:"1px solid #f0f0f0",flexShrink:0}}>
          <div style={{fontFamily:"'Playfair Display',serif",fontSize:13,color:"#111",marginBottom:2}}>Rooney Partners</div>
          <div style={{fontSize:8,color:"#aaa",letterSpacing:"0.12em",textTransform:"uppercase"}}>LIHTC Scenario Engine · {allProjects.length} Projects</div>
        </div>
        <div style={{flex:1,overflowY:"auto"}}>
          <ProjectSwitcher projects={allProjects} activeId={activeId} onSelect={selectProject}/>
        </div>
      </div>

      {/* MAIN */}
      <div style={{flex:1,display:"flex",flexDirection:"column",minWidth:0,overflow:"hidden"}}>
        {/* Topbar */}
        <div style={{background:"#111",color:"white",padding:"0 18px",display:"flex",alignItems:"center",height:50,gap:14,flexShrink:0}}>
          <button onClick={()=>setSidebarOpen(v=>!v)} style={{background:"none",border:"none",color:"#888",cursor:"pointer",fontSize:14,padding:"2px 4px",fontFamily:"inherit"}}>{sidebarOpen?"◂":"▸"}</button>
          <div style={{flex:1,minWidth:0}}>
            {activeProject&&(
              <div style={{display:"flex",alignItems:"baseline",gap:10}}>
                <span style={{fontFamily:"'Playfair Display',serif",fontSize:14,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{activeProject.name}</span>
                <span style={{color:"#555",fontSize:9,letterSpacing:"0.08em",textTransform:"uppercase",whiteSpace:"nowrap"}}>{activeProject.city}, {activeProject.state} · {activeProject.total_units}u · {fmtM(activeProject.total_dev_cost)} TDC</span>
              </div>
            )}
          </div>

          {/* ── CHANGE 4 of 4: Tab buttons call notifyTabChange before switching ── */}
          {TABS.map(t=>(
            <button key={t.key} onClick={()=>{ notifyTabChange(t.key); setTab(t.key); }}
              style={{background:tab===t.key?"white":"transparent",color:tab===t.key?"#111":"#888",border:"none",padding:"4px 11px",borderRadius:3,cursor:"pointer",fontSize:9,letterSpacing:"0.1em",textTransform:"uppercase",fontFamily:"Inter, sans-serif",fontWeight:tab===t.key?700:400,whiteSpace:"nowrap"}}>
              {t.label}
            </button>
          ))}
          {/* ────────────────────────────────────────────────────────────────── */}

          <div style={{width:1,height:18,background:"#333"}}/>

          {/* Save status indicator */}
          <SaveStatus />

          {/* Version history button */}
          <button
            onClick={() => setVersionPanelOpen(true)}
            style={{background:"none",border:"1px solid #333",color:"#888",padding:"3px 10px",borderRadius:3,cursor:"pointer",fontSize:9,letterSpacing:"0.1em",textTransform:"uppercase",fontFamily:"Inter, sans-serif",whiteSpace:"nowrap"}}
          >
            Versions
          </button>

          {unitMixRev!=null && (
            <div style={{display:"flex",alignItems:"center",gap:5,padding:"2px 8px",background:"#1a3a6b22",borderRadius:3,cursor:"pointer"}} onClick={()=>setUnitMixRev(null)} title="Click to clear unit mix override">
              <div style={{width:5,height:5,borderRadius:"50%",background:"#5a8adf"}}/>
              <span style={{fontSize:8,color:"#5a8adf",fontWeight:700,letterSpacing:"0.06em"}}>REV OVERRIDE</span>
            </div>
          )}
          {debtOverride!=null && (
            <div style={{display:"flex",alignItems:"center",gap:5,padding:"2px 8px",background:"#1a3a6b22",borderRadius:3,cursor:"pointer"}} onClick={()=>setDebtOverride(null)} title="Click to clear debt override">
              <div style={{width:5,height:5,borderRadius:"50%",background:"#5a8adf"}}/>
              <span style={{fontSize:8,color:"#5a8adf",fontWeight:700,letterSpacing:"0.06em"}}>DEBT OVERRIDE</span>
            </div>
          )}
          {creditOverride!=null && (
            <div style={{display:"flex",alignItems:"center",gap:5,padding:"2px 8px",background:"#5a3a0022",borderRadius:3,cursor:"pointer"}} onClick={()=>setCreditOverride(null)} title="Click to clear credit override">
              <div style={{width:5,height:5,borderRadius:"50%",background:"#c47a3a"}}/>
              <span style={{fontSize:8,color:"#c47a3a",fontWeight:700,letterSpacing:"0.06em"}}>CREDIT OVERRIDE</span>
            </div>
          )}
          <button onClick={addScenario} style={{background:"#1a6b3c",color:"white",border:"none",padding:"4px 12px",borderRadius:3,cursor:"pointer",fontSize:9,letterSpacing:"0.1em",textTransform:"uppercase",fontFamily:"Inter, sans-serif",fontWeight:700}}>+ Add</button>
        </div>

        {/* Content */}
        <div style={{flex:1,overflowY:"auto",padding:22}}>
          {!baseFA&&(
            <div style={{textAlign:"center",padding:"60px 20px",color:"#ccc"}}>
              <div style={{fontSize:28,marginBottom:12}}>⊘</div>
              <div style={{fontSize:12,letterSpacing:"0.08em",marginBottom:6,color:"#bbb"}}>NO FINANCIAL MODEL</div>
              <div style={{fontSize:10}}>No assumptions loaded for <strong style={{color:"#aaa"}}>{activeProject?.name}</strong>.</div>
            </div>
          )}

          {tab==="dashboard" && (
            <DashboardPanel />
          )}
          {tab==="unitmix" && (
            <UnitMixPanel onRevenueChange={rev => { setUnitMixRev(rev); setTab("unitmix"); }} />
          )}
          {tab==="debt" && (
            <DebtPanel />
          )}
          {tab==="devbudget" && (
            <DevBudgetPanel
              onBudgetUpdate={(eligibleBasis, tdc, budget) => { setBudgetBasis({ eligibleBasis, tdc, budget }); setTab("taxcredit"); }}
            />
          )}
          {tab==="constcf" && (
            <ConstructionCFPanel />
          )}
          {tab==="taxcredit" && (
            <TaxCreditPanel />
          )}
          {tab==="stack" && (
            <CapitalStackPanel scenario={dbScenario} baseFA={baseFA} budgetWithCalc={budgetBasis?.budget || null} />
          )}
          {tab==="sources" && (
            <SourcesUsesPanel />
          )}
          {tab==="proforma" && (
            <ProformaPanel />
          )}
          {tab==="schedule" && (
            <SchedulePanel />
          )}
          {tab==="leaseup" && (
            <LeaseUpPanel />
          )}
          {tab==="gapsolver" && (
            <GapSolverPanel />
          )}
          {tab==="disposition" && (
            <DispositionPanel />
          )}
          {tab==="sponsorcf" && (
            <SponsorCFPanel />
          )}

          {baseFA && tab==="scenarios" && (
            <>
              <div style={{display:"flex",alignItems:"baseline",gap:10,marginBottom:18}}>
                <h2 style={{fontFamily:"'Playfair Display',serif",fontSize:20,fontWeight:400,color:"#111"}}>Scenario Editor</h2>
                <span style={{fontSize:9,color:"#aaa",letterSpacing:"0.08em"}}>{scenarios.length} SCENARIOS · 15-YR PROFORMA</span>
              </div>
              <div style={{display:"grid",gridTemplateColumns:`repeat(${Math.min(scenarios.length,4)},minmax(255px,1fr))`,gap:13,alignItems:"start"}}>
                {scenarios.map((sc,i)=>(
                  <ScenarioCard key={sc.id} scenario={sc} index={i} isBase={i===0} baseFA={baseFA}
                    onUpdate={sc=>updateSc(sc.id,sc)} onRemove={()=>removeSc(sc.id)} onDuplicate={()=>dupSc(sc.id)}
                  />
                ))}
              </div>
            </>
          )}

          {baseFA && tab==="table" && (
            <>
              <div style={{display:"flex",alignItems:"baseline",gap:10,marginBottom:18}}>
                <h2 style={{fontFamily:"'Playfair Display',serif",fontSize:20,fontWeight:400,color:"#111"}}>Comparison Table</h2>
              </div>
              <div style={{background:"white",border:"1px solid #e0e0e0",borderRadius:6,padding:"18px 22px",maxWidth:820,marginBottom:28}}>
                <ComparisonTable scenarios={scenarios} baseFA={baseFA}/>
              </div>
              <div style={{marginBottom:8,fontSize:9,letterSpacing:"0.1em",textTransform:"uppercase",color:"#888",fontWeight:700}}>15-Year Detail — {scenarios[0].name}</div>
              <div style={{background:"white",border:"1px solid #e0e0e0",borderRadius:6,overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:10}}>
                  <thead>
                    <tr style={{borderBottom:"2px solid #111"}}>
                      {["Year","EGI","OpEx","NOI","Debt Svc","DSCR","Cash Flow","Adj CF","DDF Bal"].map(h=>(
                        <th key={h} style={{padding:"7px 12px",textAlign:"right",fontWeight:700,fontSize:8,textTransform:"uppercase",color:"#888",whiteSpace:"nowrap"}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {buildProforma(baseFA,scenarios[0].overrides)?.rows.map(r=>(
                      <tr key={r.yr} style={{borderBottom:"1px solid #f5f5f5"}}>
                        <td style={{padding:"5px 12px",textAlign:"right",fontWeight:700,color:"#aaa"}}>Yr {r.yr}</td>
                        <td style={{padding:"5px 12px",textAlign:"right"}}>{fmt$(r.egi)}</td>
                        <td style={{padding:"5px 12px",textAlign:"right",color:"#8B2500"}}>{fmt$(r.opex)}</td>
                        <td style={{padding:"5px 12px",textAlign:"right",fontWeight:600}}>{fmt$(r.noi)}</td>
                        <td style={{padding:"5px 12px",textAlign:"right",color:"#8B2500"}}>{fmt$(r.ds)}</td>
                        <td style={{padding:"5px 12px",textAlign:"right",fontWeight:700,color:r.dscr>=1.15?"#1a6b3c":"#8B2500"}}>{fmtX(r.dscr)}</td>
                        <td style={{padding:"5px 12px",textAlign:"right"}}>{fmt$(r.cf)}</td>
                        <td style={{padding:"5px 12px",textAlign:"right"}}>{fmt$(r.adjCf)}</td>
                        <td style={{padding:"5px 12px",textAlign:"right",color:r.ddfBalance>0?"#8B2500":"#1a6b3c"}}>{fmt$(r.ddfBalance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {baseFA && tab==="charts" && (
            <>
              <div style={{display:"flex",alignItems:"baseline",gap:10,marginBottom:18}}>
                <h2 style={{fontFamily:"'Playfair Display',serif",fontSize:20,fontWeight:400,color:"#111"}}>15-Year Trajectories</h2>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:18,marginBottom:22}}>
                {[
                  {key:"dscr",   label:"DSCR",               fmt:fmtX},
                  {key:"noi",    label:"Net Operating Income", fmt:fmt$},
                  {key:"adjCf",  label:"Adjusted Cash Flow",   fmt:fmt$},
                  {key:"ddfBal", label:"DDF Balance",          fmt:fmt$},
                ].map(c=>(
                  <div key={c.key} style={{background:"white",border:"1px solid #e0e0e0",borderRadius:6,padding:"14px 18px 10px"}}>
                    <Sparkline scenarios={scenarios} baseFA={baseFA} metricKey={c.key} label={c.label} fmt={c.fmt}/>
                  </div>
                ))}
              </div>
              <div style={{marginBottom:10,fontSize:9,letterSpacing:"0.1em",textTransform:"uppercase",color:"#888",fontWeight:700}}>Year 15 Disposition</div>
              <div style={{display:"grid",gridTemplateColumns:`repeat(${Math.min(scenarios.length,4)},1fr)`,gap:12}}>
                {scenarios.map((sc,i)=>{
                  const pf=buildProforma(baseFA,sc.overrides);
                  if(!pf) return null;
                  const d=pf.dispo;
                  return (
                    <div key={sc.id} style={{background:"white",border:`1px solid ${i===0?"#111":"#e0e0e0"}`,borderRadius:6,padding:"12px 14px"}}>
                      <div style={{display:"flex",alignItems:"center",gap:5,marginBottom:9}}>
                        <div style={{width:7,height:7,borderRadius:1,background:SCENARIO_COLORS[i%SCENARIO_COLORS.length]}}/>
                        <span style={{fontSize:9,fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase"}}>{sc.name}</span>
                      </div>
                      {[
                        {label:"Gross Value",  val:d.grossVal,  note:`@ ${fmtPct(d.capRate)}`},
                        {label:"Cost of Sale", val:-d.costSale},
                        {label:"Debt Payoff",  val:-d.debtBal},
                        {label:"Net Proceeds", val:d.netProc,   bold:true},
                      ].map(({label,val,bold,note})=>(
                        <div key={label} style={{display:"flex",justifyContent:"space-between",marginBottom:4,paddingTop:bold?4:0,borderTop:bold?"1px solid #e8e8e8":"none"}}>
                          <span style={{fontSize:9,color:"#aaa",textTransform:"uppercase",letterSpacing:"0.04em"}}>{label}{note&&<span style={{color:"#ccc"}}> {note}</span>}</span>
                          <span style={{fontSize:11,fontWeight:bold?700:500,color:bold?(val>0?"#1a6b3c":"#8B2500"):"#111"}}>{fmt$(val)}</span>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Version history panel — slides in from right */}
      <VersionPanel isOpen={versionPanelOpen} onClose={() => setVersionPanelOpen(false)} />
    </div>
  );
}
