import { useState, useMemo, useEffect, useCallback } from "react";
import { fetchScenarioSources, upsertScenarioSource, deleteScenarioSource,
         upsertFinancialAssumptions } from "./db.js";

const fmt$  = v => v == null ? "—" : "$" + Math.round(v).toLocaleString();
const fmtM  = v => v == null ? "—" : "$" + (v / 1e6).toFixed(3) + "M";
const fmtX  = v => v == null ? "—" : v.toFixed(3) + "x";
const fmtPct= v => v == null ? "—" : (v * 100).toFixed(2) + "%";
const pct   = v => v == null ? "" : (v * 100).toFixed(3);

function calcADS(principal, annualRate, amortYears) {
  if (!principal || !annualRate || !amortYears) return 0;
  const n = amortYears * 12, r = annualRate / 12;
  if (r === 0) return principal / n * 12;
  const pmt = principal * r * Math.pow(1+r,n) / (Math.pow(1+r,n)-1);
  return pmt * 12;
}

function calcLoanFromDSCR(noi, dscr, rate, amort) {
  if (!noi || !dscr || !rate || !amort) return 0;
  const ads = noi / dscr;
  const n = amort * 12, r = rate / 12;
  if (r === 0) return (ads/12) * n;
  return (ads/12) * (1 - Math.pow(1+r,-n)) / r;
}

function calcBalanceAtYear(principal, rate, amortYears, year) {
  if (!principal || !rate || !amortYears) return 0;
  const n = amortYears * 12, r = rate / 12;
  const pmt = principal * r * Math.pow(1+r,n) / (Math.pow(1+r,n)-1);
  let bal = principal;
  for (let i = 0; i < year * 12; i++) bal = bal * (1+r) - pmt;
  return Math.max(bal, 0);
}

const SECTION = { background:"white", border:"1px solid #e0e0e0", borderRadius:6, padding:"16px 20px", marginBottom:16 };
const STITLE = { fontSize:9, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", color:"#888", marginBottom:14 };
const LABEL = { fontSize:10, color:"#666", textTransform:"uppercase", letterSpacing:"0.04em", marginBottom:4, display:"block" };
const iStyle = (focused, ro, ac="#1a3a6b") => ({
  width:"100%", padding:"6px 10px", borderRadius:3, boxSizing:"border-box",
  border:`1px solid ${focused ? ac : "#e0e0e0"}`,
  fontSize:12, fontFamily:"'DM Mono',monospace",
  color:ro?"#888":"#111", background:ro?"#f8f8f8":"white", outline:"none",
});

const TYPE_META = {
  const_loan_te:      { label:"Tax-Exempt Const Loan",   isDebt:true, isConst:true  },
  const_loan_taxable: { label:"Taxable Const Loan",       isDebt:true, isConst:true  },
  perm_loan:          { label:"Permanent Loan",            isDebt:true, isConst:false },
  sub_debt:           { label:"Sub-Debt / Soft Loan",      isDebt:true, isConst:false },
  grant:              { label:"Grant",                     isDebt:false,isConst:false },
  other:              { label:"Other Source",              isDebt:false,isConst:false },
  lihtc_equity:       { label:"LIHTC LP Equity",           isDebt:false,isConst:false },
  deferred_fee:       { label:"Deferred Developer Fee",    isDebt:false,isConst:false },
};

function Metric({ label, value, ok, warn, sub, bold }) {
  const color = ok===true?"#1a6b3c":ok===false?"#8B2500":warn?"#5a3a00":"#111";
  return (
    <div style={{ padding:"8px 12px", background:"#f9f9f9", borderRadius:4, border:"1px solid #ebebeb", flex:1, minWidth:90 }}>
      <div style={{ fontSize:9, color:"#aaa", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4 }}>{label}</div>
      <div style={{ fontFamily:"'DM Mono',monospace", fontSize:bold?15:12, fontWeight:bold?700:500, color }}>{value}</div>
      {sub && <div style={{ fontSize:9, color:"#bbb", marginTop:2 }}>{sub}</div>}
    </div>
  );
}

function SectionHeader({ label, sub, action }) {
  return (
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14, paddingBottom:8, borderBottom:"2px solid #111" }}>
      <div>
        <div style={{ fontFamily:"'Playfair Display',serif", fontSize:15, fontWeight:400, color:"#111" }}>{label}</div>
        {sub && <div style={{ fontSize:9, color:"#aaa", textTransform:"uppercase", letterSpacing:"0.07em", marginTop:2 }}>{sub}</div>}
      </div>
      {action}
    </div>
  );
}

function SourceRow({ src, onChange, onDelete, isCalc }) {
  const [open, setOpen] = useState(false);
  const meta = TYPE_META[src.source_type] || TYPE_META.other;
  const ads = !meta.isConst && src.rate && src.amort_years
    ? calcADS(src.amount, src.rate, src.amort_years) : 0;

  return (
    <div style={{ border:"1px solid #e8e8e8", borderRadius:5, marginBottom:8, overflow:"hidden" }}>
      <div style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px",
        background:open?"#f8f9fc":"white", cursor:"pointer" }}
        onClick={()=>setOpen(v=>!v)}>
        <div style={{ width:7, height:7, borderRadius:"50%", background:"#1a3a6b", flexShrink:0 }} />
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:11, fontWeight:600, color:"#111", fontFamily:"'DM Mono',monospace" }}>
            {src.name}
            {isCalc && <span style={{ marginLeft:6, fontSize:8, background:"#f0f3f9", color:"#1a3a6b", padding:"1px 5px", borderRadius:3, fontWeight:700 }}>CALC</span>}
          </div>
          {src.lender_agency && <div style={{ fontSize:9, color:"#aaa" }}>{src.lender_agency}</div>}
        </div>
        <div style={{ textAlign:"right", flexShrink:0 }}>
          <div style={{ fontFamily:"'DM Mono',monospace", fontSize:12, fontWeight:700, color:"#111" }}>{fmtM(src.amount)}</div>
          {src.rate > 0 && (
            <div style={{ fontSize:9, color:"#888" }}>
              {fmtPct(src.rate)}{src.amort_years ? ` · ${src.amort_years}-yr amort` : ""}
              {src.term_years ? ` · ${src.term_years}-yr term` : ""}
              {src.term_months ? ` · ${src.term_months}-mo const` : ""}
            </div>
          )}
          {src.rate === 0 && src.source_type === "deferred_fee" && <div style={{ fontSize:9, color:"#1a6b3c" }}>0% deferred</div>}
        </div>
        <div style={{ fontSize:10, color:"#ccc", marginLeft:4 }}>{open?"▲":"▼"}</div>
      </div>

      {open && (
        <div style={{ padding:"14px 16px", borderTop:"1px solid #f0f0f0", background:"#fdfdfd" }}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:10 }}>
            <div>
              <label style={LABEL}>Name</label>
              <input value={src.name} onChange={e=>onChange({name:e.target.value})} style={iStyle(false,false)} />
            </div>
            <div>
              <label style={LABEL}>Lender / Agency</label>
              <input value={src.lender_agency||""} onChange={e=>onChange({lender_agency:e.target.value})}
                style={iStyle(false,false)} placeholder="e.g. R4 Capital, WSHFC" />
            </div>
          </div>

          {!isCalc && (
            <div style={{ marginBottom:10 }}>
              <label style={LABEL}>Amount</label>
              <input type="number" value={src.amount||""} onChange={e=>onChange({amount:Number(e.target.value)||0})} style={iStyle(false,false)} />
            </div>
          )}
          {isCalc && (
            <div style={{ marginBottom:10 }}>
              <label style={LABEL}>Amount (engine calculated)</label>
              <input value={fmt$(src.amount)} readOnly style={iStyle(false,true)} />
            </div>
          )}

          {meta.isDebt && (
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:10 }}>
              <div>
                <label style={LABEL}>Rate (%/yr)</label>
                <input type="number" step="0.001" value={src.rate ? pct(src.rate) : ""}
                  onChange={e=>onChange({rate:Number(e.target.value)/100||0})}
                  placeholder="e.g. 6.500" style={iStyle(false,false)} />
              </div>
              {meta.isConst ? (
                <div>
                  <label style={LABEL}>Const. Period (mo)</label>
                  <input type="number" value={src.term_months||""} onChange={e=>onChange({term_months:Number(e.target.value)||null})}
                    placeholder="e.g. 24" style={iStyle(false,false)} />
                </div>
              ) : (
                <>
                  <div>
                    <label style={LABEL}>Loan Term (yrs)</label>
                    <input type="number" value={src.term_years||""} onChange={e=>onChange({term_years:Number(e.target.value)||null})}
                      placeholder="e.g. 10" style={iStyle(false,false)} />
                  </div>
                  <div>
                    <label style={LABEL}>Amortization (yrs)</label>
                    <input type="number" value={src.amort_years||""} onChange={e=>onChange({amort_years:Number(e.target.value)||null})}
                      placeholder="e.g. 40" style={iStyle(false,false)} />
                  </div>
                </>
              )}
              <div>
                <label style={LABEL}>Notes</label>
                <input value={src.notes||""} onChange={e=>onChange({notes:e.target.value})}
                  style={iStyle(false,false)} placeholder="Optional" />
              </div>
            </div>
          )}

          {ads > 0 && !meta.isConst && (
            <div style={{ marginTop:10, padding:"8px 12px", background:"#f0f3f9", borderRadius:4,
              fontSize:10, fontFamily:"'DM Mono',monospace", color:"#1a3a6b" }}>
              Annual Debt Service: <strong>{fmt$(ads)}</strong> &nbsp;({fmt$(ads/12)}/mo)
              &nbsp;·&nbsp;{src.term_years || "?"}-yr term, {src.amort_years}-yr amort
            </div>
          )}

          {!isCalc && (
            <div style={{ marginTop:12, textAlign:"right" }}>
              <button onClick={onDelete}
                style={{ background:"white", border:"1px solid #f5c2b0", color:"#8B2500",
                  padding:"5px 12px", borderRadius:3, cursor:"pointer", fontSize:9,
                  fontFamily:"'DM Mono',monospace", textTransform:"uppercase", letterSpacing:"0.06em" }}>
                Remove
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SensGrid({ noi, baseRate, baseAmort, baseDSCR }) {
  const rates   = [-0.005,-0.0025,0,0.0025,0.005].map(d=>baseRate+d);
  const targets = [1.10,1.15,1.20,1.25,1.30];
  return (
    <div style={SECTION}>
      <div style={STITLE}>Perm Loan Sensitivity · DSCR target (rows) × Interest rate (cols)</div>
      <div style={{ fontSize:9, color:"#aaa", marginBottom:10 }}>NOI {fmt$(noi)} · {baseAmort}-yr amort</div>
      <table style={{ width:"100%", borderCollapse:"collapse", fontFamily:"'DM Mono',monospace", fontSize:10 }}>
        <thead>
          <tr style={{ borderBottom:"2px solid #111" }}>
            <th style={{ padding:"4px 8px", textAlign:"left", fontSize:8, color:"#888" }}>DSCR\Rate</th>
            {rates.map(r=>(
              <th key={r} style={{ padding:"4px 8px", textAlign:"right", fontSize:8,
                color:Math.abs(r-baseRate)<0.0001?"#1a3a6b":"#888",
                fontWeight:Math.abs(r-baseRate)<0.0001?700:400 }}>{(r*100).toFixed(2)}%</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {targets.map(dscr=>(
            <tr key={dscr} style={{ borderBottom:"1px solid #f5f5f5" }}>
              <td style={{ padding:"4px 8px", fontSize:10,
                color:Math.abs(dscr-baseDSCR)<0.001?"#1a3a6b":"#666",
                fontWeight:Math.abs(dscr-baseDSCR)<0.001?700:400 }}>{fmtX(dscr)}</td>
              {rates.map(r=>{
                const loan=calcLoanFromDSCR(noi,dscr,r,baseAmort);
                const isBase=Math.abs(r-baseRate)<0.0001&&Math.abs(dscr-baseDSCR)<0.001;
                return <td key={r} style={{ padding:"4px 8px", textAlign:"right",
                  background:isBase?"#f0f3f9":"transparent", fontWeight:isBase?700:400,
                  color:isBase?"#1a3a6b":"#111" }}>{fmtM(loan)}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AmortSchedule({ principal, rate, amortYears, termYears, noi }) {
  const snapYears = [1,3,5,7,10,15,20,amortYears].filter((v,i,a)=>v<=amortYears&&a.indexOf(v)===i).sort((a,b)=>a-b);
  const ads = calcADS(principal, rate, amortYears);
  return (
    <div style={SECTION}>
      <div style={STITLE}>Amortization Schedule</div>
      <table style={{ width:"100%", borderCollapse:"collapse", fontFamily:"'DM Mono',monospace", fontSize:10 }}>
        <thead>
          <tr style={{ borderBottom:"2px solid #111" }}>
            {["Year","Balance","DSCR","Annual Interest"].map(h=>(
              <th key={h} style={{ padding:"5px 10px", textAlign:"right", fontSize:8, color:"#888", textTransform:"uppercase" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {snapYears.map(yr=>{
            const bal=calcBalanceAtYear(principal,rate,amortYears,yr);
            const prevBal=yr===1?principal:calcBalanceAtYear(principal,rate,amortYears,yr-1);
            const intPaid=(prevBal+bal)/2*rate;
            const dscr=ads>0?noi/ads:0;
            const isTerm=termYears&&yr===Number(termYears);
            return (
              <tr key={yr} style={{ borderBottom:"1px solid #f5f5f5", background:isTerm?"#fffbe6":"transparent" }}>
                <td style={{ padding:"4px 10px", textAlign:"right", color:"#aaa", fontWeight:700 }}>
                  Yr {yr}{isTerm?<span style={{ fontSize:8, color:"#5a3a00", marginLeft:4 }}>← maturity</span>:null}
                </td>
                <td style={{ padding:"4px 10px", textAlign:"right" }}>{fmtM(bal)}</td>
                <td style={{ padding:"4px 10px", textAlign:"right", fontWeight:700,
                  color:dscr>=1.20?"#1a6b3c":dscr>=1.15?"#5a3a00":"#8B2500" }}>{fmtX(dscr)}</td>
                <td style={{ padding:"4px 10px", textAlign:"right", color:"#8B2500" }}>{fmt$(intPaid)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function DebtTab({ scenario, baseFA, onFAUpdate }) {
  const [sources,    setSources]    = useState([]);
  const [saving,     setSaving]     = useState(false);
  const [dscrTarget, setDscrTarget] = useState(1.20);
  const [showGrid,   setShowGrid]   = useState(true);
  const [showAmort,  setShowAmort]  = useState(false);
  const [loading,    setLoading]    = useState(true);

  useEffect(() => {
    if (!scenario?.id) { setLoading(false); return; }
    setLoading(true);
    fetchScenarioSources(scenario.id)
      .then(d => { setSources(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [scenario?.id]);

  useEffect(() => {
    if (baseFA?.dscr_target) setDscrTarget(baseFA.dscr_target);
  }, [baseFA?.dscr_target]);

  const constSources = sources.filter(s=>s.source_type==="const_loan_te"||s.source_type==="const_loan_taxable");
  const permSource   = sources.find(s=>s.source_type==="perm_loan");
  const equitySrc    = sources.find(s=>s.source_type==="lihtc_equity");
  const deferredSrc  = sources.find(s=>s.source_type==="deferred_fee");
  const subDebtSrcs  = sources.filter(s=>s.source_type==="sub_debt"||s.source_type==="grant"||s.source_type==="other");

  const noi = useMemo(() => {
    if (!baseFA) return 0;
    return Math.round(
      ((baseFA.base_residential_rev||0)+(baseFA.total_other_income||0))
      *(1-(baseFA.vacancy_rate||0.06))-(baseFA.opex_y1||0)
    );
  }, [baseFA]);

  const permLoan  = permSource?.amount     || 0;
  const permRate  = permSource?.rate       || 0.0585;
  const permAmort = permSource?.amort_years|| 40;
  const permTerm  = permSource?.term_years || 10;
  const dscrSized = calcLoanFromDSCR(noi, dscrTarget, permRate, permAmort);
  const ads       = calcADS(permLoan, permRate, permAmort);
  const dscr      = ads > 0 ? noi/ads : 0;
  const dscrOk    = dscr >= dscrTarget;

  const saveSource = useCallback(async (src) => {
    if (!scenario?.id) return;
    setSaving(true);
    try {
      const updated = await upsertScenarioSource(scenario.id, src);
      setSources(prev=>prev.map(s=>s.id===updated.id?updated:s));
    } catch(e) { console.error(e); }
    finally { setSaving(false); }
  }, [scenario?.id]);

  const updateAndSave = (id, fields) => {
    setSources(prev=>prev.map(s=>s.id===id?{...s,...fields}:s));
    const src = sources.find(s=>s.id===id);
    if (src) saveSource({...src,...fields});
  };

  const saveDscrTarget = async (val) => {
    setDscrTarget(val);
    if (!scenario?.project_id) return;
    try {
      const updated = await upsertFinancialAssumptions(scenario.project_id, { dscr_target: val });
      onFAUpdate?.(updated);
    } catch(e) { console.error(e); }
  };

  const addSubDebt = async () => {
    try {
      const saved = await upsertScenarioSource(scenario.id, {
        name:"New Soft Source", source_type:"sub_debt", is_calculated:false,
        amount:0, rate:0, sort_order:sources.length+1,
      });
      setSources(prev=>[...prev,saved]);
    } catch(e) { console.error(e); }
  };

  const removeSource = async (id) => {
    await deleteScenarioSource(id);
    setSources(prev=>prev.filter(s=>s.id!==id));
  };

  if (loading) return <div style={{ padding:40, color:"#888", fontSize:12 }}>Loading…</div>;
  if (!scenario?.id) return <div style={{ padding:40, color:"#aaa", fontSize:12 }}>Select a project to view debt sources.</div>;

  return (
    <div>
      <div style={{ display:"flex", alignItems:"baseline", justifyContent:"space-between", marginBottom:20 }}>
        <div>
          <h2 style={{ fontFamily:"'Playfair Display',serif", fontSize:20, fontWeight:400, color:"#111", margin:0 }}>Debt</h2>
          <div style={{ fontSize:9, color:"#aaa", letterSpacing:"0.08em", textTransform:"uppercase", marginTop:3 }}>CONSTRUCTION · PERMANENT · SOFT SOURCES</div>
        </div>
        <div style={{ display:"flex", gap:6, alignItems:"center" }}>
          {saving && <span style={{ fontSize:9, color:"#aaa" }}>saving…</span>}
          <button onClick={()=>setShowGrid(v=>!v)}
            style={{ background:"white", border:"1px solid #e0e0e0", color:"#666", padding:"5px 11px", borderRadius:3, cursor:"pointer", fontSize:9, textTransform:"uppercase", fontFamily:"'DM Mono',monospace" }}>
            {showGrid?"Hide Grid":"Sensitivity"}
          </button>
          <button onClick={()=>setShowAmort(v=>!v)}
            style={{ background:"white", border:"1px solid #e0e0e0", color:"#666", padding:"5px 11px", borderRadius:3, cursor:"pointer", fontSize:9, textTransform:"uppercase", fontFamily:"'DM Mono',monospace" }}>
            {showAmort?"Hide Schedule":"Amort Schedule"}
          </button>
        </div>
      </div>

      {/* 1. Construction Debt */}
      <div style={SECTION}>
        <SectionHeader label="Construction Debt" sub="Interest-only during construction period" />
        {constSources.length===0 && <div style={{ color:"#bbb", fontSize:11, padding:"10px 0" }}>No construction loan sources.</div>}
        {constSources.map(src=>(
          <SourceRow key={src.id} src={src} isCalc={src.is_calculated}
            onChange={fields=>updateAndSave(src.id,fields)}
            onDelete={()=>removeSource(src.id)} />
        ))}
        <div style={{ fontSize:9, color:"#aaa", marginTop:4, padding:"6px 10px", background:"#f9f9f9", borderRadius:4 }}>
          Construction loan amounts are engine-calculated (LTC × TDC). Edit rate and term above.
        </div>
      </div>

      {/* 2. Permanent Debt */}
      <div style={SECTION}>
        <SectionHeader label="Permanent Debt"
          sub={`NOI ${fmt$(noi)}`}
          action={
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <span style={{ fontSize:9, color:"#666", textTransform:"uppercase", letterSpacing:"0.06em" }}>Target DSCR</span>
              <input type="number" step="0.01" value={dscrTarget}
                onChange={e=>saveDscrTarget(Number(e.target.value)||1.20)}
                style={{ width:68, padding:"4px 8px", border:"1px solid #e0e0e0", borderRadius:3,
                  fontFamily:"'DM Mono',monospace", fontSize:12, fontWeight:700, color:"#1a3a6b", textAlign:"center", outline:"none" }} />
              <span style={{ fontSize:9, color:"#888" }}>→ sizes to {fmtM(dscrSized)}</span>
            </div>
          }
        />

        <div style={{ display:"flex", gap:8, marginBottom:14, flexWrap:"wrap" }}>
          <Metric label="Perm Loan" value={fmtM(permLoan)} bold />
          <Metric label="Annual Debt Service" value={fmt$(ads)} sub={fmt$(ads/12)+"/mo"} />
          <Metric label="DSCR" value={fmtX(dscr)} ok={dscrOk} bold
            sub={dscrOk?"Meets target":"Below target — reduce loan or increase NOI"} />
          <Metric label="Sized @ Target" value={fmtM(dscrSized)} sub={`${fmtPct(dscrTarget)} DSCR`} />
          <Metric label="Debt Yield" value={permLoan>0?`${((noi/permLoan)*100).toFixed(2)}%`:"—"}
            ok={permLoan>0&&noi/permLoan>=0.07} sub="NOI ÷ Loan" />
        </div>

        {permSource ? (
          <SourceRow src={permSource} isCalc={permSource.is_calculated}
            onChange={fields=>updateAndSave(permSource.id,fields)}
            onDelete={()=>removeSource(permSource.id)} />
        ) : (
          <div style={{ color:"#bbb", fontSize:11 }}>No permanent loan configured.</div>
        )}
      </div>

      {/* 3. Equity & Deferred (read-only summary) */}
      {(equitySrc||deferredSrc) && (
        <div style={SECTION}>
          <SectionHeader label="Equity & Deferred Fee" sub="Engine-calculated — configure in Capital Stack" />
          {[equitySrc,deferredSrc].filter(Boolean).map(src=>(
            <SourceRow key={src.id} src={src} isCalc={true}
              onChange={fields=>updateAndSave(src.id,fields)}
              onDelete={()=>{}} />
          ))}
        </div>
      )}

      {/* 4. Sub-Debt / Soft Sources */}
      <div style={SECTION}>
        <SectionHeader label="Sub-Debt & Soft Sources" sub="Grants, HOME loans, subordinate debt"
          action={
            <button onClick={addSubDebt}
              style={{ background:"#1a6b3c", color:"white", border:"none", padding:"5px 14px",
                borderRadius:3, cursor:"pointer", fontSize:9, textTransform:"uppercase",
                fontFamily:"'DM Mono',monospace", fontWeight:700, letterSpacing:"0.06em" }}>
              + Add Source
            </button>
          }
        />
        {subDebtSrcs.length===0 && <div style={{ color:"#bbb", fontSize:11, padding:"8px 0" }}>No soft sources added.</div>}
        {subDebtSrcs.map(src=>(
          <SourceRow key={src.id} src={src} isCalc={false}
            onChange={fields=>updateAndSave(src.id,fields)}
            onDelete={()=>removeSource(src.id)} />
        ))}
      </div>

      {/* Sensitivity grid */}
      {showGrid && noi>0 && permRate>0 && (
        <SensGrid noi={noi} baseRate={permRate} baseAmort={permAmort} baseDSCR={dscrTarget} />
      )}

      {/* Amort schedule */}
      {showAmort && permLoan>0 && (
        <AmortSchedule principal={permLoan} rate={permRate} amortYears={permAmort} termYears={permTerm} noi={noi} />
      )}
    </div>
  );
}
