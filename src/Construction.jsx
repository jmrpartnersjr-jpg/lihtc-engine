import { useState, useMemo } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// CONSTRUCTION SOURCES WATERFALL — LIHTC Engine
// Models equity pay-in tranches, construction loan draws, and closing uses
// ─────────────────────────────────────────────────────────────────────────────

const fmt$  = v => v == null ? "—" : "$" + Math.round(v).toLocaleString();
const fmtM  = v => v == null ? "—" : "$" + (v/1e6).toFixed(3) + "M";
const fmtPct= v => v == null ? "—" : (v*100).toFixed(1) + "%";

// Recharts for draw schedule chart
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ReferenceLine, ResponsiveContainer, LineChart, Line } from "recharts";

const MONTHS = ["Const Start","M2","M3","M4","M5","M6","M7","M8","M9","M10","M11","M12","M13","M14","M15","M16","M17","M18","Const Complete","Perm Close"];

// ─── TRANCHE ROW ─────────────────────────────────────────────────────────────
function TrancheRow({ tranche, onUpdate, onRemove }) {
  return (
    <tr style={{ borderBottom:"1px solid #f5f5f5" }}>
      <td style={{ padding:"5px 8px" }}>
        <input value={tranche.label} onChange={e => onUpdate("label", e.target.value)}
          style={{ width:"100%", padding:"3px 6px", border:"1px solid #e8e8e8", borderRadius:2,
            fontSize:10, fontFamily:"Inter, sans-serif", outline:"none" }} />
      </td>
      <td style={{ padding:"5px 8px" }}>
        <select value={tranche.type} onChange={e => onUpdate("type", e.target.value)}
          style={{ width:"100%", padding:"3px 6px", border:"1px solid #e8e8e8", borderRadius:2,
            fontSize:10, fontFamily:"Inter, sans-serif", outline:"none" }}>
          <option value="equity">LP Equity</option>
          <option value="gp_equity">GP Equity</option>
          <option value="bridge">Bridge / Conv.</option>
          <option value="deferred">Deferred Dev Fee</option>
          <option value="other">Other</option>
        </select>
      </td>
      <td style={{ padding:"5px 8px" }}>
        <input type="number" value={tranche.amount}
          onChange={e => onUpdate("amount", Number(e.target.value))}
          style={{ width:110, padding:"3px 6px", border:"1px solid #e8e8e8", borderRadius:2,
            fontSize:10, fontFamily:"Inter, sans-serif", textAlign:"right", outline:"none" }} />
      </td>
      <td style={{ padding:"5px 8px" }}>
        <select value={tranche.timing} onChange={e => onUpdate("timing", e.target.value)}
          style={{ width:"100%", padding:"3px 6px", border:"1px solid #e8e8e8", borderRadius:2,
            fontSize:10, fontFamily:"Inter, sans-serif", outline:"none" }}>
          <option value="closing">Construction Closing</option>
          <option value="50pct">50% Completion</option>
          <option value="breakeven">Breakeven / Stabilized</option>
          <option value="perm_close">Perm Closing</option>
          <option value="split_3">3 Equal Tranches</option>
          <option value="split_4">4 Equal Tranches</option>
        </select>
      </td>
      <td style={{ padding:"5px 8px", textAlign:"center" }}>
        <button onClick={onRemove}
          style={{ background:"none", border:"none", cursor:"pointer", color:"#ccc",
            fontSize:13, lineHeight:1 }}>✕</button>
      </td>
    </tr>
  );
}

// ─── USES ROW ────────────────────────────────────────────────────────────────
function UsesRow({ item, onUpdate, onRemove }) {
  return (
    <tr style={{ borderBottom:"1px solid #f5f5f5" }}>
      <td style={{ padding:"5px 8px" }}>
        <input value={item.label} onChange={e => onUpdate("label", e.target.value)}
          style={{ width:"100%", padding:"3px 6px", border:"1px solid #e8e8e8", borderRadius:2,
            fontSize:10, fontFamily:"Inter, sans-serif", outline:"none" }} />
      </td>
      <td style={{ padding:"5px 8px" }}>
        <input type="number" value={item.amount}
          onChange={e => onUpdate("amount", Number(e.target.value))}
          style={{ width:120, padding:"3px 6px", border:"1px solid #e8e8e8", borderRadius:2,
            fontSize:10, fontFamily:"Inter, sans-serif", textAlign:"right", outline:"none" }} />
      </td>
      <td style={{ padding:"5px 8px" }}>
        <select value={item.when} onChange={e => onUpdate("when", e.target.value)}
          style={{ width:"100%", padding:"3px 6px", border:"1px solid #e8e8e8", borderRadius:2,
            fontSize:10, fontFamily:"Inter, sans-serif", outline:"none" }}>
          <option value="closing">At Closing</option>
          <option value="during">During Construction</option>
          <option value="perm">At Perm Close</option>
        </select>
      </td>
      <td style={{ padding:"5px 8px", textAlign:"center" }}>
        <button onClick={onRemove}
          style={{ background:"none", border:"none", cursor:"pointer", color:"#ccc", fontSize:13 }}>✕</button>
      </td>
    </tr>
  );
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
export default function ConstructionPanel({ baseFA }) {
  const tdc = baseFA?.total_dev_cost || 67087503;
  const permLoan = baseFA?.loan_amount || 34049115;
  const lihtcEquity = (baseFA?.annual_credit || 2952064) * (baseFA?.credit_years || 10) * (baseFA?.credit_price || 0.82);
  const deferredFee = baseFA?.deferred_fee || 5927282;
  const otherSources = baseFA?.other_sources || 2952064;
  const constMonths = 18;
  const constRate = 0.065;

  const [tranches, setTranches] = useState([
    { id:1, label:"R4 Capital — Tranche 1", type:"equity",   amount: Math.round(lihtcEquity*0.15), timing:"closing" },
    { id:2, label:"R4 Capital — Tranche 2", type:"equity",   amount: Math.round(lihtcEquity*0.35), timing:"50pct" },
    { id:3, label:"R4 Capital — Tranche 3", type:"equity",   amount: Math.round(lihtcEquity*0.50), timing:"perm_close" },
    { id:4, label:"GP Equity",              type:"gp_equity", amount: 500000,                      timing:"closing" },
    { id:5, label:"Deferred Dev Fee",       type:"deferred",  amount: deferredFee,                 timing:"perm_close" },
    { id:6, label:"Other Sources / Grants", type:"other",     amount: otherSources,                timing:"closing" },
  ]);

  const [constLoanAmt,  setConstLoanAmt]  = useState(Math.round(tdc * 0.55));
  const [constLoanRate, setConstLoanRate] = useState(7.25);  // %
  const [loanOriginFee, setLoanOriginFee] = useState(1.0);   // %
  const [constMonthsN,  setConstMonthsN]  = useState(18);

  const [uses, setUses] = useState([
    { id:1, label:"Hard Construction",   amount: 38000000, when:"during" },
    { id:2, label:"Soft Costs",          amount: 5000000,  when:"during" },
    { id:3, label:"Land / Acquisition",  amount: 2500000,  when:"closing" },
    { id:4, label:"Construction Int.",   amount: 1800000,  when:"during" },
    { id:5, label:"Loan Origination",    amount: Math.round(constLoanAmt*loanOriginFee/100), when:"closing" },
    { id:6, label:"Dev Fee (Cash)",      amount: baseFA?.developer_fee_cash || 2920221, when:"perm" },
    { id:7, label:"Reserves",            amount: 1200000,  when:"perm" },
  ]);

  const nextId = (arr) => Math.max(0, ...arr.map(x=>x.id)) + 1;

  const totalTranches  = tranches.reduce((s,t)=>s+t.amount,0);
  const totalUses      = uses.reduce((s,u)=>s+u.amount,0);
  const constInterest  = constLoanAmt * (constLoanRate/100) * (constMonthsN/12) * 0.55; // avg drawn
  const gap            = totalUses - (totalTranches + constLoanAmt + permLoan);
  const balances       = (() => {
    const steps = ["Closing","50% Compl.","Stabilized","Perm Close"];
    const timingMap = { closing:0, "50pct":1, breakeven:2, perm_close:3, split_3:"split", split_4:"split" };
    return steps.map((step, i) => {
      const inflow = tranches.reduce((s,t) => {
        const ti = timingMap[t.timing];
        if (ti === "split") {
          const parts = t.timing==="split_3" ? 3 : 4;
          return s + t.amount/parts;
        }
        return ti===i ? s+t.amount : s;
      }, 0);
      const loan = i===0 ? constLoanAmt : 0;
      return { step, inflow, loan };
    });
  })();

  // Draw schedule (simplified S-curve over construction)
  const drawData = Array.from({length: constMonthsN+1}, (_, m) => {
    const pct = m===0 ? 0 : Math.min(1, (m/constMonthsN)**0.8);
    const prevPct = m===0 ? 0 : Math.min(1, ((m-1)/constMonthsN)**0.8);
    const draw = Math.round((pct - prevPct) * constLoanAmt * 0.9);
    const cumulativeDraw = Math.round(pct * constLoanAmt * 0.9);
    const interest = Math.round(cumulativeDraw * (constLoanRate/100) / 12);
    return { month: m===0 ? "Closing" : m===constMonthsN ? "Complete" : `M${m}`,
      draw, cumulativeDraw, interest };
  }).filter((_, i) => i===0 || i===Math.floor(constMonthsN/4) ||
    i===Math.floor(constMonthsN/2) || i===Math.floor(constMonthsN*3/4) || i===constMonthsN);

  const TRANCHE_COLORS = { equity:"#5a3a00", gp_equity:"#1a3a6b", bridge:"#8B2500",
    deferred:"#1a6b3c", other:"#888" };

  return (
    <div>
      {/* Header */}
      <div style={{ display:"flex", alignItems:"baseline", gap:10, marginBottom:20 }}>
        <h2 style={{ fontFamily:"'Playfair Display',serif", fontSize:20, fontWeight:400, color:"#111" }}>
          Construction Waterfall
        </h2>
        <span style={{ fontSize:9, color:"#aaa", letterSpacing:"0.08em", textTransform:"uppercase" }}>
          EQUITY PAY-IN · DRAWS · SOURCES & USES
        </span>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 300px", gap:18, alignItems:"start" }}>

        {/* LEFT */}
        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>

          {/* Equity Tranches */}
          <div style={{ background:"white", border:"1px solid #e0e0e0", borderRadius:6, padding:"16px 18px" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
              <div style={{ fontSize:9, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", color:"#888" }}>
                Equity Pay-In Schedule
              </div>
              <button onClick={() => setTranches(t => [...t,
                {id:nextId(t), label:"New Tranche", type:"equity", amount:0, timing:"closing"}])}
                style={{ background:"#1a3a6b", color:"white", border:"none", padding:"4px 10px",
                  borderRadius:2, cursor:"pointer", fontSize:9, letterSpacing:"0.07em",
                  textTransform:"uppercase", fontFamily:"Inter, sans-serif" }}>
                + Add
              </button>
            </div>
            <table style={{ width:"100%", borderCollapse:"collapse" }}>
              <thead>
                <tr style={{ borderBottom:"2px solid #111" }}>
                  {["Label","Type","Amount","Timing",""].map(h => (
                    <th key={h} style={{ padding:"5px 8px", textAlign:"left", fontSize:8,
                      color:"#888", textTransform:"uppercase", letterSpacing:"0.07em" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tranches.map((t,i) => (
                  <TrancheRow key={t.id} tranche={t}
                    onUpdate={(f,v) => setTranches(prev => prev.map(x=>x.id===t.id?{...x,[f]:v}:x))}
                    onRemove={() => setTranches(prev => prev.filter(x=>x.id!==t.id))} />
                ))}
                <tr style={{ borderTop:"2px solid #111", background:"#fafafa" }}>
                  <td colSpan={2} style={{ padding:"7px 8px", fontSize:10, fontWeight:700,
                    fontFamily:"Inter, sans-serif" }}>TOTAL EQUITY SOURCES</td>
                  <td style={{ padding:"7px 8px", fontSize:11, fontWeight:700,
                    fontFamily:"Inter, sans-serif", textAlign:"left" }}>{fmt$(totalTranches)}</td>
                  <td colSpan={2}/>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Construction Uses */}
          <div style={{ background:"white", border:"1px solid #e0e0e0", borderRadius:6, padding:"16px 18px" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
              <div style={{ fontSize:9, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", color:"#888" }}>
                Uses of Funds
              </div>
              <button onClick={() => setUses(u => [...u,
                {id:nextId(u), label:"New Use", amount:0, when:"during"}])}
                style={{ background:"#1a3a6b", color:"white", border:"none", padding:"4px 10px",
                  borderRadius:2, cursor:"pointer", fontSize:9, letterSpacing:"0.07em",
                  textTransform:"uppercase", fontFamily:"Inter, sans-serif" }}>
                + Add
              </button>
            </div>
            <table style={{ width:"100%", borderCollapse:"collapse" }}>
              <thead>
                <tr style={{ borderBottom:"2px solid #111" }}>
                  {["Use Item","Amount","When",""].map(h => (
                    <th key={h} style={{ padding:"5px 8px", textAlign:"left", fontSize:8,
                      color:"#888", textTransform:"uppercase", letterSpacing:"0.07em" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {uses.map(u => (
                  <UsesRow key={u.id} item={u}
                    onUpdate={(f,v) => setUses(prev => prev.map(x=>x.id===u.id?{...x,[f]:v}:x))}
                    onRemove={() => setUses(prev => prev.filter(x=>x.id!==u.id))} />
                ))}
                <tr style={{ borderTop:"2px solid #111", background:"#fafafa" }}>
                  <td style={{ padding:"7px 8px", fontSize:10, fontWeight:700,
                    fontFamily:"Inter, sans-serif" }}>TOTAL USES</td>
                  <td style={{ padding:"7px 8px", fontSize:11, fontWeight:700,
                    fontFamily:"Inter, sans-serif" }}>{fmt$(totalUses)}</td>
                  <td colSpan={2}/>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Draw Schedule Chart */}
          <div style={{ background:"white", border:"1px solid #e0e0e0", borderRadius:6, padding:"16px 18px" }}>
            <div style={{ fontSize:9, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase",
              color:"#888", marginBottom:14 }}>Construction Loan Draw Schedule (S-Curve)</div>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={drawData} margin={{top:0,right:10,left:0,bottom:0}}>
                <XAxis dataKey="month" tick={{fontSize:8,fontFamily:"Inter, sans-serif"}} />
                <YAxis tickFormatter={v=>"$"+(v/1e6).toFixed(1)+"M"}
                  tick={{fontSize:8,fontFamily:"Inter, sans-serif"}} width={55} />
                <Tooltip formatter={(v,n)=>[fmt$(v),n]}
                  contentStyle={{fontSize:10,fontFamily:"Inter, sans-serif"}} />
                <Bar dataKey="draw" name="Period Draw" fill="#1a3a6b" opacity={0.75} radius={[2,2,0,0]} />
                <Bar dataKey="interest" name="Monthly Interest" fill="#8B2500" opacity={0.6} radius={[2,2,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

        </div>

        {/* RIGHT — Construction Loan + Summary */}
        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>

          {/* Construction Loan */}
          <div style={{ background:"white", border:"1px solid #e0e0e0", borderRadius:6, padding:"16px 16px 10px" }}>
            <div style={{ fontSize:8, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase",
              color:"#888", marginBottom:12 }}>Construction Loan</div>
            <div style={{ marginBottom:12 }}>
              <div style={{ fontSize:10, color:"#666", marginBottom:5, textTransform:"uppercase",
                letterSpacing:"0.05em" }}>Loan Amount</div>
              <input type="number" value={constLoanAmt}
                onChange={e=>setConstLoanAmt(Number(e.target.value))}
                style={{ width:"100%", padding:"7px 10px", border:"1px solid #e0e0e0", borderRadius:3,
                  fontSize:12, fontFamily:"Inter, sans-serif", outline:"none" }} />
              <div style={{ fontSize:9, color:"#aaa", marginTop:3 }}>{fmtPct(constLoanAmt/tdc)} of TDC</div>
            </div>
            <div style={{ marginBottom:12 }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
                <span style={{ fontSize:10, color:"#666", textTransform:"uppercase",
                  letterSpacing:"0.05em" }}>Interest Rate</span>
                <span style={{ fontSize:11, fontWeight:700, color:"#1a3a6b",
                  fontFamily:"Inter, sans-serif" }}>{constLoanRate.toFixed(2)}%</span>
              </div>
              <input type="range" min={400} max={900} step={5}
                value={Math.round(constLoanRate*100)}
                onChange={e=>setConstLoanRate(Number(e.target.value)/100)}
                style={{ width:"100%", accentColor:"#1a3a6b" }} />
              <div style={{ display:"flex", justifyContent:"space-between", fontSize:8, color:"#ccc" }}>
                <span>4.00%</span><span>9.00%</span>
              </div>
            </div>
            <div style={{ marginBottom:12 }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
                <span style={{ fontSize:10, color:"#666", textTransform:"uppercase",
                  letterSpacing:"0.05em" }}>Construction Period</span>
                <span style={{ fontSize:11, fontWeight:700, color:"#1a3a6b",
                  fontFamily:"Inter, sans-serif" }}>{constMonthsN} mo</span>
              </div>
              <input type="range" min={12} max={30} step={1}
                value={constMonthsN}
                onChange={e=>setConstMonthsN(Number(e.target.value))}
                style={{ width:"100%", accentColor:"#1a3a6b" }} />
              <div style={{ display:"flex", justifyContent:"space-between", fontSize:8, color:"#ccc" }}>
                <span>12 mo</span><span>30 mo</span>
              </div>
            </div>
            <div style={{ marginBottom:8 }}>
              <div style={{ fontSize:10, color:"#666", marginBottom:5, textTransform:"uppercase",
                letterSpacing:"0.05em" }}>Origination Fee</div>
              <input type="number" step={0.25} value={loanOriginFee}
                onChange={e=>setLoanOriginFee(Number(e.target.value))}
                style={{ width:"100%", padding:"7px 10px", border:"1px solid #e0e0e0", borderRadius:3,
                  fontSize:12, fontFamily:"Inter, sans-serif", outline:"none" }} />
              <div style={{ fontSize:9, color:"#aaa", marginTop:3 }}>
                % → {fmt$(constLoanAmt*loanOriginFee/100)}
              </div>
            </div>
            <div style={{ background:"#f8f9fc", borderRadius:4, padding:"8px 10px", marginTop:6 }}>
              <div style={{ fontSize:8, color:"#aaa", marginBottom:4 }}>Est. Total Interest</div>
              <div style={{ fontSize:13, fontWeight:700, fontFamily:"Inter, sans-serif",
                color:"#8B2500" }}>{fmt$(constInterest)}</div>
              <div style={{ fontSize:8, color:"#aaa" }}>avg 55% drawn × {constMonthsN}mo</div>
            </div>
          </div>

          {/* Sources & Uses Balance */}
          <div style={{ background:"white", border:"1px solid #e0e0e0", borderRadius:6, padding:"16px 16px" }}>
            <div style={{ fontSize:8, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase",
              color:"#888", marginBottom:12 }}>Sources & Uses Check</div>
            {[
              { label:"Perm Loan (at close)", value: permLoan, color:"#1a3a6b" },
              { label:"Construction Loan",    value: constLoanAmt, color:"#1a3a6b" },
              { label:"Equity Tranches",      value: totalTranches, color:"#5a3a00" },
              { label:"TOTAL SOURCES",        value: permLoan + constLoanAmt + totalTranches,
                bold:true, borderTop:true },
              { label:"TOTAL USES",           value: totalUses, bold:true },
            ].map((r,i)=>(
              <div key={i} style={{ display:"flex", justifyContent:"space-between",
                padding:"5px 0", borderTop: r.borderTop ? "1px solid #e0e0e0" : "none",
                marginTop: r.borderTop ? 4 : 0 }}>
                <span style={{ fontSize:10, color: r.bold?"#111":"#888",
                  fontWeight: r.bold?700:400, textTransform:"uppercase",
                  letterSpacing:"0.04em" }}>{r.label}</span>
                <span style={{ fontSize: r.bold?13:11, fontWeight: r.bold?700:500,
                  color: r.color||"#111", fontFamily:"Inter, sans-serif" }}>
                  {fmt$(r.value)}
                </span>
              </div>
            ))}
            <div style={{ marginTop:10, padding:"8px 12px", borderRadius:4,
              background: Math.abs(gap)<10000 ? "#e8f4ee" : gap<0 ? "#f0f3f9" : "#fff5f3",
              border: `1px solid ${Math.abs(gap)<10000 ? "#a8d8bb" : gap<0?"#b8c8e0":"#f5c2b0"}` }}>
              <div style={{ fontSize:8, fontWeight:700, textTransform:"uppercase",
                letterSpacing:"0.08em", color: Math.abs(gap)<10000?"#1a6b3c":gap<0?"#1a3a6b":"#8B2500",
                marginBottom:3 }}>
                {Math.abs(gap)<10000 ? "✓ BALANCED" : gap<0 ? "⚑ SOURCES EXCEED USES" : "⚠ GAP — SOURCES SHORTAGE"}
              </div>
              <div style={{ fontSize:13, fontWeight:700, fontFamily:"Inter, sans-serif",
                color: Math.abs(gap)<10000?"#1a6b3c":gap<0?"#1a3a6b":"#8B2500" }}>
                {gap > 0 ? "+" : ""}{fmt$(Math.abs(gap))}
              </div>
            </div>
          </div>

          {/* Pay-in Timing */}
          <div style={{ background:"white", border:"1px solid #e0e0e0", borderRadius:6, padding:"16px 16px" }}>
            <div style={{ fontSize:8, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase",
              color:"#888", marginBottom:12 }}>Equity Pay-In by Timing</div>
            {[
              { label:"At Construction Closing", timing:"closing" },
              { label:"At 50% Completion",        timing:"50pct" },
              { label:"At Breakeven/Stabilized",  timing:"breakeven" },
              { label:"At Perm Closing",          timing:"perm_close" },
              { label:"Multi-Tranche (3 or 4)",   timing:"split" },
            ].map(row => {
              const amt = tranches.filter(t =>
                row.timing === "split"
                  ? t.timing==="split_3"||t.timing==="split_4"
                  : t.timing===row.timing
              ).reduce((s,t)=>s+t.amount,0);
              return amt > 0 ? (
                <div key={row.timing} style={{ display:"flex", justifyContent:"space-between",
                  padding:"5px 0", borderBottom:"1px solid #f8f8f8" }}>
                  <span style={{ fontSize:10, color:"#888" }}>{row.label}</span>
                  <span style={{ fontSize:11, fontWeight:500, color:"#111",
                    fontFamily:"Inter, sans-serif" }}>{fmt$(amt)}</span>
                </div>
              ) : null;
            })}
          </div>

        </div>
      </div>
    </div>
  );
}
