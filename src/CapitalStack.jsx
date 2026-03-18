import { useState, useMemo, useEffect } from "react";
import { fetchScenarioSources, upsertScenarioSource } from "./db.js";

const fmt$  = v => v == null ? "—" : "$" + Math.round(v).toLocaleString();
const fmtM  = v => v == null ? "—" : "$" + (v / 1e6).toFixed(3) + "M";
const fmtPct= v => v == null ? "—" : (v * 100).toFixed(1) + "%";

const SECTION = { background:"white", border:"1px solid #e0e0e0", borderRadius:6, padding:"16px 20px", marginBottom:16 };
const STITLE  = { fontSize:9, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", color:"#888", marginBottom:14 };

const TYPE_LABELS = {
  const_loan_te:"Tax-Exempt Const. Loan", const_loan_taxable:"Taxable Const. Loan",
  perm_loan:"Permanent Loan", lihtc_equity:"LIHTC LP Equity",
  deferred_fee:"Deferred Dev. Fee", sub_debt:"Sub-Debt / Soft", grant:"Grant", other:"Other",
};

const SRC_COLORS = {
  const_loan_te:"#1a3a6b", const_loan_taxable:"#2c5f9e", perm_loan:"#1a3a6b",
  lihtc_equity:"#1a6b3c", deferred_fee:"#5a3a00", sub_debt:"#8B2500", grant:"#666", other:"#888",
};

function InlineText({ value, onChange, placeholder }) {
  const [editing, setEditing] = useState(false);
  const [raw, setRaw] = useState(value||"");
  const commit = () => { setEditing(false); if (raw !== value) onChange(raw); };
  if (editing) return (
    <input autoFocus value={raw} onChange={e=>setRaw(e.target.value)} onBlur={commit}
      onKeyDown={e=>{ if(e.key==="Enter") commit(); if(e.key==="Escape"){setRaw(value||"");setEditing(false);}}}
      style={{ padding:"2px 6px", border:"1px solid #1a3a6b", borderRadius:3, fontSize:11, outline:"none",
        fontFamily:"Inter, sans-serif", width:140 }} />
  );
  return (
    <span onClick={()=>{setRaw(value||"");setEditing(true);}}
      style={{ cursor:"pointer", fontSize:11, color:value?"#333":"#ccc",
        fontFamily:"Inter, sans-serif", padding:"2px 4px", borderRadius:2, border:"1px solid transparent" }}
      onMouseEnter={e=>e.target.style.border="1px solid #e0e0e0"}
      onMouseLeave={e=>e.target.style.border="1px solid transparent"}>
      {value||placeholder||"—"}
    </span>
  );
}

function InlineAmt({ value, onChange }) {
  const [editing, setEditing] = useState(false);
  const [raw, setRaw] = useState("");
  const commit = () => { setEditing(false); const v=Number(raw); if(!isNaN(v)) onChange(v); };
  if (editing) return (
    <input autoFocus type="number" value={raw} onChange={e=>setRaw(e.target.value)} onBlur={commit}
      onKeyDown={e=>{if(e.key==="Enter")commit();if(e.key==="Escape")setEditing(false);}}
      style={{ width:120, padding:"2px 6px", border:"1px solid #1a3a6b", borderRadius:3,
        fontSize:12, fontFamily:"Inter, sans-serif", textAlign:"right", outline:"none" }} />
  );
  return (
    <span onClick={()=>{setRaw(String(Math.round(value||0)));setEditing(true);}}
      style={{ cursor:"pointer", fontFamily:"Inter, sans-serif", fontSize:12, fontWeight:700,
        padding:"2px 4px", borderRadius:2, border:"1px solid transparent" }}
      onMouseEnter={e=>e.target.style.border="1px solid #e0e0e0"}
      onMouseLeave={e=>e.target.style.border="1px solid transparent"}>
      {fmtM(value)}
    </span>
  );
}

function CreditSensitivity({ annualCredit, creditYears, basePrice }) {
  const prices = [0.78, 0.80, 0.82, 0.84, 0.86, 0.88, 0.90];
  return (
    <div style={{ marginTop:14, borderTop:"1px solid #f0f0f0", paddingTop:12 }}>
      <div style={STITLE}>Credit Price Sensitivity</div>
      <div style={{ display:"flex", gap:0, border:"1px solid #e0e0e0", borderRadius:4, overflow:"hidden" }}>
        {prices.map(p=>{
          const eq=annualCredit*creditYears*p;
          const isBase=Math.abs(p-basePrice)<0.005;
          return (
            <div key={p} style={{ flex:1, padding:"8px 6px", textAlign:"center",
              background:isBase?"#f0f3f9":"white", borderLeft:p===prices[0]?"none":"1px solid #e8e8e8" }}>
              <div style={{ fontSize:9, color:isBase?"#1a3a6b":"#aaa", fontWeight:isBase?700:400,
                fontFamily:"Inter, sans-serif" }}>{(p*100).toFixed(0)}¢</div>
              <div style={{ fontSize:11, fontWeight:isBase?700:500, color:isBase?"#1a3a6b":"#111",
                fontFamily:"Inter, sans-serif", marginTop:2 }}>{fmtM(eq)}</div>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize:9, color:"#aaa", marginTop:5 }}>
        Annual credit {fmtM(annualCredit)} × {creditYears} yrs × price
      </div>
    </div>
  );
}

export default function CapitalStackTab({ scenario, baseFA, budgetWithCalc }) {
  const [sources, setSources] = useState([]);
  const [saving,  setSaving]  = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!scenario?.id) { setLoading(false); return; }
    setLoading(true);
    fetchScenarioSources(scenario.id)
      .then(d=>{setSources(d);setLoading(false);})
      .catch(()=>setLoading(false));
  }, [scenario?.id]);

  const amountFor = (src) => {
    if (!src.is_calculated) return src.amount;
    if (src.source_type==="perm_loan")    return baseFA?.loan_amount || src.amount;
    if (src.source_type==="lihtc_equity") return baseFA ? (baseFA.annual_credit||0)*(baseFA.credit_years||10)*(baseFA.credit_price||0.82) : src.amount;
    if (src.source_type==="deferred_fee") {
      const calcItem = budgetWithCalc?.find(i=>i.calc_key==="dev_fee_deferred");
      return calcItem?.amount || baseFA?.deferred_fee || src.amount;
    }
    return src.amount;
  };

  const saveSource = async (src) => {
    setSaving(true);
    try {
      const updated = await upsertScenarioSource(scenario.id, src);
      setSources(prev=>prev.map(s=>s.id===updated.id?updated:s));
    } catch(e){console.error(e);}
    finally{setSaving(false);}
  };

  const updateAndSave = (id, fields) => {
    const src=sources.find(s=>s.id===id);
    if(!src)return;
    setSources(prev=>prev.map(s=>s.id===id?{...s,...fields}:s));
    saveSource({...src,...fields});
  };

  const tdc = useMemo(()=>{
    if(budgetWithCalc&&budgetWithCalc.length>0) return budgetWithCalc.reduce((s,i)=>s+(i.amount||0),0);
    return baseFA?.total_dev_cost||0;
  },[budgetWithCalc,baseFA]);

  const totalSources = sources.reduce((s,src)=>s+amountFor(src),0);
  const gap          = totalSources - tdc;
  const annualCredit = baseFA?.annual_credit||0;
  const creditYears  = baseFA?.credit_years||10;
  const creditPrice  = baseFA?.credit_price||0.82;

  const groups = [
    { label:"Construction",     srcs:sources.filter(s=>s.source_type==="const_loan_te"||s.source_type==="const_loan_taxable") },
    { label:"Permanent Debt",   srcs:sources.filter(s=>s.source_type==="perm_loan") },
    { label:"LIHTC Equity",     srcs:sources.filter(s=>s.source_type==="lihtc_equity") },
    { label:"Deferred Dev Fee", srcs:sources.filter(s=>s.source_type==="deferred_fee") },
    { label:"Soft Sources",     srcs:sources.filter(s=>["sub_debt","grant","other"].includes(s.source_type)) },
  ];

  if (loading) return <div style={{ padding:40, color:"#888", fontSize:12 }}>Loading capital stack…</div>;
  if (!scenario?.id) return <div style={{ padding:40, color:"#aaa", fontSize:12 }}>Select a project to view the capital stack.</div>;

  return (
    <div>
      <div style={{ display:"flex", alignItems:"baseline", justifyContent:"space-between", marginBottom:20 }}>
        <div>
          <h2 style={{ fontFamily:"'Playfair Display',serif", fontSize:20, fontWeight:400, color:"#111", margin:0 }}>Capital Stack</h2>
          <div style={{ fontSize:9, color:"#aaa", letterSpacing:"0.08em", textTransform:"uppercase", marginTop:3 }}>MASTER SOURCES LIST</div>
        </div>
        {saving && <span style={{ fontSize:9, color:"#aaa" }}>saving…</span>}
      </div>

      {/* Summary cards */}
      <div style={{ display:"flex", gap:10, marginBottom:16, flexWrap:"wrap" }}>
        {[
          {label:"Total Sources", value:fmtM(totalSources), color:"#111"},
          {label:"Total Dev Cost", value:fmtM(tdc), color:"#111"},
          {label:"Gap (Src – TDC)", value:fmtM(gap), color:Math.abs(gap)<1000?"#1a6b3c":"#8B2500"},
          {label:"LIHTC Equity", value:fmtM(annualCredit*creditYears*creditPrice), color:"#1a6b3c"},
        ].map(m=>(
          <div key={m.label} style={{ flex:1, minWidth:120, padding:"10px 14px", background:"white",
            border:"1px solid #e0e0e0", borderRadius:5 }}>
            <div style={{ fontSize:9, color:"#aaa", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4 }}>{m.label}</div>
            <div style={{ fontFamily:"Inter, sans-serif", fontSize:15, fontWeight:700, color:m.color }}>{m.value}</div>
          </div>
        ))}
      </div>

      {/* Stacked bar */}
      <div style={{...SECTION, padding:"14px 20px"}}>
        <div style={STITLE}>Sources Composition</div>
        <div style={{ display:"flex", height:28, borderRadius:4, overflow:"hidden", marginBottom:8 }}>
          {sources.filter(s=>amountFor(s)>0).map(src=>{
            const amt=amountFor(src);
            const w=totalSources>0?(amt/totalSources*100).toFixed(1):0;
            return <div key={src.id} title={`${src.name}: ${fmtM(amt)}`}
              style={{ width:`${w}%`, background:SRC_COLORS[src.source_type]||"#ccc" }} />;
          })}
        </div>
        <div style={{ display:"flex", flexWrap:"wrap", gap:"6px 16px" }}>
          {sources.filter(s=>amountFor(s)>0).map(src=>(
            <div key={src.id} style={{ display:"flex", alignItems:"center", gap:5, fontSize:9, color:"#666" }}>
              <div style={{ width:8, height:8, borderRadius:1, background:SRC_COLORS[src.source_type]||"#ccc", flexShrink:0 }} />
              <span>{src.name}</span>
              <span style={{ color:"#aaa" }}>{fmtPct(totalSources>0?amountFor(src)/totalSources:0)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Master sources table */}
      <div style={SECTION}>
        <div style={STITLE}>Sources Detail — click name or lender to edit</div>
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead>
            <tr style={{ borderBottom:"2px solid #111" }}>
              {["Source","Lender / Agency","Amount","% of TDC",""].map(h=>(
                <th key={h} style={{ padding:"6px 12px", textAlign:h==="Amount"||h==="% of TDC"?"right":"left",
                  fontSize:8, color:"#888", textTransform:"uppercase", letterSpacing:"0.08em",
                  fontFamily:"Inter, sans-serif" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.flatMap(g=>{
              if(g.srcs.length===0) return [];
              const headerRow = (
                <tr key={`hdr-${g.label}`}>
                  <td colSpan={5} style={{ padding:"10px 12px 3px", fontSize:8, fontWeight:700,
                    letterSpacing:"0.1em", textTransform:"uppercase", color:"#bbb" }}>{g.label}</td>
                </tr>
              );
              const srcRows = g.srcs.map((src,i)=>{
                const amt=amountFor(src);
                const pctTDC=tdc>0?amt/tdc:0;
                const isSoft=!src.is_calculated;
                const color=SRC_COLORS[src.source_type]||"#888";
                return (
                  <tr key={src.id} style={{ borderBottom:i===g.srcs.length-1?"none":"1px solid #f5f5f5" }}>
                    <td style={{ padding:"9px 12px" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                        <div style={{ width:6, height:6, borderRadius:"50%", background:color, flexShrink:0 }} />
                        <div>
                          <div style={{ fontSize:11, fontWeight:600, color:"#111", fontFamily:"Inter, sans-serif" }}>
                            {src.name}
                            {src.is_calculated && <span style={{ marginLeft:5, fontSize:7, background:"#f0f3f9", color:"#1a3a6b", padding:"1px 4px", borderRadius:2, fontWeight:700 }}>CALC</span>}
                          </div>
                          <div style={{ fontSize:9, color:"#aaa", marginTop:1 }}>{TYPE_LABELS[src.source_type]||src.source_type}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding:"9px 12px" }}>
                      <InlineText value={src.lender_agency} placeholder="add lender"
                        onChange={v=>updateAndSave(src.id,{lender_agency:v})} />
                    </td>
                    <td style={{ padding:"9px 12px", textAlign:"right" }}>
                      {isSoft
                        ? <InlineAmt value={amt} onChange={v=>updateAndSave(src.id,{amount:v})} />
                        : <span style={{ fontFamily:"Inter, sans-serif", fontSize:12, fontWeight:700 }}>{fmtM(amt)}</span>
                      }
                    </td>
                    <td style={{ padding:"9px 12px", textAlign:"right" }}>
                      <span style={{ fontFamily:"Inter, sans-serif", fontSize:11, color:"#888" }}>{fmtPct(pctTDC)}</span>
                    </td>
                    <td style={{ padding:"9px 12px" }}>
                      <div style={{ height:6, background:"#f0f0f0", borderRadius:3, overflow:"hidden", width:80 }}>
                        <div style={{ height:"100%", background:color, width:`${Math.min(pctTDC*100,100)}%` }} />
                      </div>
                    </td>
                  </tr>
                );
              });
              return [headerRow, ...srcRows];
            })}
            {/* Total */}
            <tr style={{ borderTop:"2px solid #111" }}>
              <td style={{ padding:"10px 12px", fontWeight:700, fontSize:12, fontFamily:"'Playfair Display',serif" }}>Total Sources</td>
              <td />
              <td style={{ padding:"10px 12px", textAlign:"right", fontFamily:"Inter, sans-serif", fontSize:14, fontWeight:700 }}>{fmtM(totalSources)}</td>
              <td style={{ padding:"10px 12px", textAlign:"right", fontFamily:"Inter, sans-serif", fontSize:11, color:"#888" }}>100%</td>
              <td />
            </tr>
            <tr>
              <td colSpan={5} style={{ padding:"4px 12px 8px", fontSize:10,
                color:Math.abs(gap)<1000?"#1a6b3c":"#8B2500", fontFamily:"Inter, sans-serif" }}>
                {Math.abs(gap)<1000?"✓ Sources balance to TDC":`Gap vs TDC: ${fmtM(Math.abs(gap))} ${gap>0?"(overfunded)":"(shortfall)"}`}
                <span style={{ color:"#aaa", marginLeft:12 }}>TDC: {fmtM(tdc)}</span>
              </td>
            </tr>
          </tbody>
        </table>

        {annualCredit>0 && (
          <CreditSensitivity annualCredit={annualCredit} creditYears={creditYears} basePrice={creditPrice} />
        )}
      </div>
    </div>
  );
}
