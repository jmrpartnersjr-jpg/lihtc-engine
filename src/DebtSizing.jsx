import { useState, useMemo } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// DEBT SIZING CALCULATOR — LIHTC Engine
// Back-solves loan amount from NOI + target DSCR, or sizes by LTV/LTC.
// Shows amortization schedule, break-even analysis, and sensitivity grid.
// ─────────────────────────────────────────────────────────────────────────────

const fmt$  = v => v == null ? "—" : "$" + Math.round(v).toLocaleString();
const fmtM  = v => v == null ? "—" : "$" + (v / 1e6).toFixed(3) + "M";
const fmtX  = v => v == null ? "—" : v.toFixed(3) + "x";
const fmtPct= v => v == null ? "—" : (v * 100).toFixed(2) + "%";
const fmtPct1= v => v == null ? "—" : (v * 100).toFixed(1) + "%";

function calcADS(principal, annualRate, amortYears) {
  const n = amortYears * 12, r = annualRate / 12;
  if (r === 0) return principal / n * 12;
  const pmt = principal * r * Math.pow(1+r,n) / (Math.pow(1+r,n)-1);
  return pmt * 12;
}

function calcLoanFromDSCR(noi, targetDSCR, rate, amortYears) {
  // ADS = NOI / DSCR; back-solve principal from ADS
  const ads = noi / targetDSCR;
  const n = amortYears * 12, r = rate / 12;
  if (r === 0) return (ads / 12) * n;
  // P = (ads/12) * (1 - (1+r)^-n) / r
  return (ads / 12) * (1 - Math.pow(1+r,-n)) / r;
}

function calcBalanceAtYear(principal, annualRate, amortYears, year) {
  const n = amortYears * 12, r = annualRate / 12;
  const pmt = principal * r * Math.pow(1+r,n) / (Math.pow(1+r,n)-1);
  let bal = principal;
  for (let i = 0; i < year * 12; i++) bal = bal * (1+r) - pmt;
  return Math.max(bal, 0);
}

// ─── INPUT FIELD ─────────────────────────────────────────────────────────────
function Field({ label, value, onChange, type="number", format, suffix, note, accent, readOnly }) {
  const [focused, setFocused] = useState(false);
  const display = readOnly && format ? format(value) : value;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom: 4 }}>
        <span style={{ fontSize:10, color:"#666", letterSpacing:"0.05em", textTransform:"uppercase" }}>{label}</span>
        {suffix && <span style={{ fontSize:9, color:"#aaa" }}>{suffix}</span>}
      </div>
      <div style={{ position:"relative" }}>
        <input
          type={readOnly ? "text" : type}
          value={display ?? ""}
          readOnly={readOnly}
          onChange={e => {
            if (readOnly) return;
            const v = type === "number" ? (e.target.value === "" ? 0 : Number(e.target.value)) : e.target.value;
            onChange(v);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            width: "100%",
            padding: "7px 10px",
            border: `1px solid ${focused ? (accent||"#1a3a6b") : "#e0e0e0"}`,
            borderRadius: 3,
            fontSize: 12,
            fontFamily: "Inter, sans-serif",
            color: readOnly ? "#888" : "#111",
            background: readOnly ? "#f8f8f8" : "white",
            outline: "none",
            fontWeight: readOnly ? 400 : 500,
          }}
        />
      </div>
      {note && <div style={{ fontSize:9, color:"#aaa", marginTop:3 }}>{note}</div>}
    </div>
  );
}

// ─── RESULT ROW ───────────────────────────────────────────────────────────────
function ResultRow({ label, value, sub, bold, ok, warn, borderTop }) {
  const color = ok === true ? "#1a6b3c" : ok === false ? "#8B2500" : warn ? "#5a3a00" : "#111";
  return (
    <div style={{
      display:"flex", justifyContent:"space-between", alignItems:"center",
      padding: "6px 0",
      borderTop: borderTop ? "1px solid #e8e8e8" : "none",
      marginTop: borderTop ? 4 : 0,
    }}>
      <span style={{ fontSize:10, color:"#888", textTransform:"uppercase", letterSpacing:"0.04em" }}>{label}</span>
      <div style={{ textAlign:"right" }}>
        <div style={{ fontSize: bold ? 14 : 12, fontWeight: bold ? 700 : 500, color,
          fontFamily:"Inter, sans-serif" }}>{value}</div>
        {sub && <div style={{ fontSize:9, color:"#bbb" }}>{sub}</div>}
      </div>
    </div>
  );
}

// ─── SENSITIVITY GRID ────────────────────────────────────────────────────────
function SensitivityGrid({ noi, baseRate, baseAmort, baseDSCR }) {
  const rates   = [baseRate - 0.005, baseRate - 0.0025, baseRate, baseRate + 0.0025, baseRate + 0.005];
  const dscrTargets = [1.10, 1.15, 1.20, 1.25, 1.30];

  return (
    <div style={{ background:"white", border:"1px solid #e0e0e0", borderRadius:6, padding:"14px 18px" }}>
      <div style={{ fontSize:9, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", color:"#888", marginBottom:3 }}>
        Loan Amount Sensitivity
      </div>
      <div style={{ fontSize:9, color:"#aaa", marginBottom:12 }}>
        NOI {fmt$(noi)} · {baseAmort}-yr amort · DSCR target (rows) × Interest Rate (cols)
      </div>
      <div style={{ overflowX:"auto" }}>
        <table style={{ borderCollapse:"collapse", fontSize:10, fontFamily:"Inter, sans-serif", width:"100%" }}>
          <thead>
            <tr style={{ borderBottom:"2px solid #111" }}>
              <th style={{ padding:"5px 10px", textAlign:"left", fontSize:8, color:"#888", textTransform:"uppercase", width:80 }}>DSCR ↓ / Rate →</th>
              {rates.map(r => (
                <th key={r} style={{ padding:"5px 8px", textAlign:"right", fontSize:8,
                  color: Math.abs(r - baseRate) < 0.0001 ? "#1a3a6b" : "#888",
                  fontWeight: Math.abs(r - baseRate) < 0.0001 ? 700 : 400,
                  textTransform:"uppercase" }}>
                  {(r*100).toFixed(2)}%
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dscrTargets.map(dscr => (
              <tr key={dscr} style={{ borderBottom:"1px solid #f5f5f5" }}>
                <td style={{ padding:"5px 10px",
                  color: Math.abs(dscr - baseDSCR) < 0.001 ? "#1a3a6b" : "#666",
                  fontWeight: Math.abs(dscr - baseDSCR) < 0.001 ? 700 : 400,
                  fontSize:10 }}>
                  {fmtX(dscr)}
                </td>
                {rates.map(r => {
                  const loan = calcLoanFromDSCR(noi, dscr, r, baseAmort);
                  const isBase = Math.abs(r - baseRate) < 0.0001 && Math.abs(dscr - baseDSCR) < 0.001;
                  return (
                    <td key={r} style={{ padding:"5px 8px", textAlign:"right",
                      background: isBase ? "#f0f3f9" : "transparent",
                      fontWeight: isBase ? 700 : 400,
                      color: isBase ? "#1a3a6b" : "#111" }}>
                      {fmtM(loan)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── AMORT SCHEDULE ───────────────────────────────────────────────────────────
function AmortSchedule({ principal, rate, amortYears, noi }) {
  const years = [1, 2, 3, 5, 7, 10, 15, 20, amortYears].filter((v,i,a) => v <= amortYears && a.indexOf(v) === i).sort((a,b)=>a-b);
  const r = rate / 12;
  const n = amortYears * 12;
  const pmt = r === 0 ? principal / n : principal * r * Math.pow(1+r,n) / (Math.pow(1+r,n)-1);
  const ads = pmt * 12;

  return (
    <div style={{ background:"white", border:"1px solid #e0e0e0", borderRadius:6, padding:"14px 18px" }}>
      <div style={{ fontSize:9, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", color:"#888", marginBottom:12 }}>
        Loan Balance & Coverage Over Time
      </div>
      <table style={{ width:"100%", borderCollapse:"collapse", fontSize:10, fontFamily:"Inter, sans-serif" }}>
        <thead>
          <tr style={{ borderBottom:"2px solid #111" }}>
            {["Year","Balance","Principal Paid","Int. Paid (Ann.)","DSCR"].map(h => (
              <th key={h} style={{ padding:"5px 10px", textAlign:"right", fontSize:8, color:"#888", textTransform:"uppercase", letterSpacing:"0.06em" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {years.map(yr => {
            const bal = calcBalanceAtYear(principal, rate, amortYears, yr);
            const prevBal = yr === 1 ? principal : calcBalanceAtYear(principal, rate, amortYears, yr - 1);
            const intPaid = (prevBal + bal) / 2 * rate; // approx annual interest
            const prinPaid = principal - bal;
            const dscr = noi / ads;
            return (
              <tr key={yr} style={{ borderBottom:"1px solid #f5f5f5" }}>
                <td style={{ padding:"5px 10px", textAlign:"right", color:"#aaa", fontWeight:700 }}>Yr {yr}</td>
                <td style={{ padding:"5px 10px", textAlign:"right" }}>{fmtM(bal)}</td>
                <td style={{ padding:"5px 10px", textAlign:"right", color:"#1a6b3c" }}>{fmtM(prinPaid)}</td>
                <td style={{ padding:"5px 10px", textAlign:"right", color:"#8B2500" }}>{fmt$(intPaid)}</td>
                <td style={{ padding:"5px 10px", textAlign:"right", fontWeight:700,
                  color: dscr >= 1.20 ? "#1a6b3c" : dscr >= 1.15 ? "#5a3a00" : "#8B2500" }}>
                  {fmtX(dscr)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function DebtSizingPanel({ baseFA, onLoanUpdate }) {
  const defaultNOI = baseFA?.base_residential_rev
    ? Math.round((baseFA.base_residential_rev + (baseFA.total_other_income||0)) * (1 - (baseFA.vacancy_rate||0.06)) - (baseFA.opex_y1||0))
    : 1800000;

  const [mode,       setMode]       = useState("dscr");     // "dscr" | "ltv" | "ltc"
  const [noi,        setNoi]        = useState(defaultNOI);
  const [targetDSCR, setTargetDSCR] = useState(1.20);
  const [rate,       setRate]       = useState(baseFA?.interest_rate || 0.0585);
  const [amort,      setAmort]      = useState(baseFA?.amort_years   || 40);
  const [tdc,        setTdc]        = useState(baseFA?.total_dev_cost || 67087503);
  const [value,      setValue]      = useState(0);          // for LTV mode
  const [ltvPct,     setLtvPct]     = useState(0.65);
  const [ltcPct,     setLtcPct]     = useState(0.60);
  const [showAmort,  setShowAmort]  = useState(false);
  const [showGrid,   setShowGrid]   = useState(true);

  const results = useMemo(() => {
    let loanAmount = 0;

    if (mode === "dscr") {
      loanAmount = calcLoanFromDSCR(noi, targetDSCR, rate, amort);
    } else if (mode === "ltv") {
      loanAmount = (value || 0) * ltvPct;
    } else if (mode === "ltc") {
      loanAmount = tdc * ltcPct;
    }

    const ads       = calcADS(loanAmount, rate, amort);
    const dscr      = noi / ads;
    const ltc       = loanAmount / tdc;
    const debtYield = noi / loanAmount;
    const breakeven = ads / ((baseFA?.base_residential_rev||noi) + (baseFA?.total_other_income||0));
    const bal10     = calcBalanceAtYear(loanAmount, rate, amort, 10);
    const bal15     = calcBalanceAtYear(loanAmount, rate, amort, 15);

    return { loanAmount, ads, dscr, ltc, debtYield, breakeven, bal10, bal15 };
  }, [mode, noi, targetDSCR, rate, amort, tdc, value, ltvPct, ltcPct, baseFA]);

  const dscrOk  = results.dscr >= 1.15;
  const dscrGood= results.dscr >= 1.25;

  return (
    <div>
      {/* Header */}
      <div style={{ display:"flex", alignItems:"baseline", justifyContent:"space-between", marginBottom:20 }}>
        <div style={{ display:"flex", alignItems:"baseline", gap:10 }}>
          <h2 style={{ fontFamily:"'Playfair Display',serif", fontSize:20, fontWeight:400, color:"#111" }}>Debt Sizing</h2>
          <span style={{ fontSize:9, color:"#aaa", letterSpacing:"0.08em", textTransform:"uppercase" }}>LOAN SIZING · DSCR · SENSITIVITY</span>
        </div>
        <div style={{ display:"flex", gap:6 }}>
          <button onClick={() => setShowGrid(v=>!v)}
            style={{ background:"white", border:"1px solid #e0e0e0", color:"#666", padding:"5px 11px", borderRadius:3, cursor:"pointer", fontSize:9, letterSpacing:"0.08em", textTransform:"uppercase", fontFamily:"Inter, sans-serif" }}>
            {showGrid ? "Hide Grid" : "Sensitivity"}
          </button>
          <button onClick={() => setShowAmort(v=>!v)}
            style={{ background:"white", border:"1px solid #e0e0e0", color:"#666", padding:"5px 11px", borderRadius:3, cursor:"pointer", fontSize:9, letterSpacing:"0.08em", textTransform:"uppercase", fontFamily:"Inter, sans-serif" }}>
            {showAmort ? "Hide Schedule" : "Amort Schedule"}
          </button>
          {onLoanUpdate && (
            <button
              onClick={() => { onLoanUpdate(results.loanAmount, rate, amort, results.ads); }}
              style={{ background:"#1a3a6b", color:"white", border:"none", padding:"5px 14px", borderRadius:3, cursor:"pointer", fontSize:9, letterSpacing:"0.08em", textTransform:"uppercase", fontFamily:"Inter, sans-serif", fontWeight:700 }}>
              Push to Proforma →
            </button>
          )}
        </div>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"300px 1fr", gap:18, alignItems:"start" }}>

        {/* LEFT — Inputs */}
        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>

          {/* Sizing Mode */}
          <div style={{ background:"white", border:"1px solid #e0e0e0", borderRadius:6, padding:"14px 16px" }}>
            <div style={{ fontSize:8, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", color:"#888", marginBottom:10 }}>Sizing Method</div>
            <div style={{ display:"flex", gap:6 }}>
              {[
                { key:"dscr", label:"By DSCR" },
                { key:"ltc",  label:"By LTC"  },
                { key:"ltv",  label:"By LTV"  },
              ].map(m => (
                <button key={m.key} onClick={() => setMode(m.key)}
                  style={{ flex:1, padding:"6px 4px", borderRadius:3, border:`1px solid ${mode===m.key?"#1a3a6b":"#e0e0e0"}`,
                    background: mode===m.key?"#f0f3f9":"white",
                    color: mode===m.key?"#1a3a6b":"#888",
                    fontWeight: mode===m.key?700:400,
                    fontSize:9, letterSpacing:"0.06em", textTransform:"uppercase",
                    fontFamily:"Inter, sans-serif", cursor:"pointer" }}>
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Core Inputs */}
          <div style={{ background:"white", border:"1px solid #e0e0e0", borderRadius:6, padding:"16px 16px 6px" }}>
            <div style={{ fontSize:8, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", color:"#888", marginBottom:12 }}>
              {mode === "dscr" ? "DSCR Sizing Inputs" : mode === "ltc" ? "LTC Sizing Inputs" : "LTV Sizing Inputs"}
            </div>

            <Field label="Year 1 NOI" value={noi} onChange={setNoi} suffix="$"
              note="Drives DSCR constraint" accent="#1a6b3c" />

            {mode === "dscr" && (
              <Field label="Target DSCR" value={targetDSCR} onChange={v=>setTargetDSCR(Number(v))}
                suffix={`→ ADS ${fmt$(noi / targetDSCR)}`}
                note="1.15x is target; 1.20x+ is conservative" />
            )}
            {mode === "ltc" && (
              <>
                <Field label="Total Dev Cost" value={tdc} onChange={setTdc} suffix="$" />
                <Field label="LTC %" value={(ltcPct*100).toFixed(1)} onChange={v=>setLtcPct(Number(v)/100)}
                  suffix={`→ ${fmtM(tdc*ltcPct)}`} note="Typical LIHTC: 55–65%" />
              </>
            )}
            {mode === "ltv" && (
              <>
                <Field label="Appraised Value" value={value} onChange={setValue} suffix="$" />
                <Field label="LTV %" value={(ltvPct*100).toFixed(1)} onChange={v=>setLtvPct(Number(v)/100)}
                  suffix={`→ ${fmtM((value||0)*ltvPct)}`} note="Typical LIHTC: 60–70%" />
              </>
            )}

            <div style={{ borderTop:"1px solid #f0f0f0", paddingTop:12, marginTop:4 }}>
              <div style={{ fontSize:8, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", color:"#888", marginBottom:12 }}>Loan Terms</div>
              <Field label="Interest Rate" value={(rate*100).toFixed(3)} onChange={v=>setRate(Number(v)/100)}
                suffix="% / yr" note="Permanent rate (not construction)" accent="#1a3a6b" />
              <Field label="Amortization" value={amort} onChange={v=>setAmort(Number(v))}
                suffix="years" note="35 or 40 yrs typical for LIHTC" />
              <Field label="Total Dev Cost" value={tdc} onChange={setTdc} suffix="$"
                note="For LTC % reference" />
            </div>
          </div>
        </div>

        {/* RIGHT — Results */}
        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>

          {/* Primary Result */}
          <div style={{ background: dscrOk ? "#f0f3f9" : "#fff5f3", border:`1px solid ${dscrOk?"#b8c8e0":"#f5c2b0"}`, borderRadius:6, padding:"18px 20px" }}>
            <div style={{ fontSize:8, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", color: dscrOk?"#1a3a6b":"#8B2500", marginBottom:6 }}>
              {mode==="dscr" ? "Sized Loan Amount" : "Loan Amount"}
            </div>
            <div style={{ fontFamily:"'Playfair Display',serif", fontSize:32, fontWeight:400, color:"#111", marginBottom:4 }}>
              {fmtM(results.loanAmount)}
            </div>
            <div style={{ fontSize:10, color:"#888" }}>
              {fmt$(results.loanAmount)} · {fmtPct1(results.ltc)} of TDC
            </div>
          </div>

          {/* Key Metrics */}
          <div style={{ background:"white", border:"1px solid #e0e0e0", borderRadius:6, padding:"14px 18px" }}>
            <div style={{ fontSize:8, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", color:"#888", marginBottom:10 }}>Key Metrics</div>

            <ResultRow label="Annual Debt Service" value={fmt$(results.ads)}
              sub={`${fmt$(results.ads/12)}/mo`} bold />
            <ResultRow label="DSCR" value={fmtX(results.dscr)}
              ok={dscrOk} sub={dscrOk ? (dscrGood?"Strong coverage":"Meets 1.15x target"):"Below 1.15x target"}
              bold />
            <ResultRow label="Debt Yield" value={fmtPct(results.debtYield)}
              ok={results.debtYield >= 0.07} sub="NOI ÷ Loan — lenders target 7–9%"
              warn={results.debtYield < 0.07} />
            <ResultRow label="LTC" value={fmtPct1(results.ltc)}
              ok={results.ltc <= 0.65} sub="Loan ÷ TDC" borderTop />
            <ResultRow label="Breakeven Occupancy" value={fmtPct1(results.breakeven)}
              ok={results.breakeven <= 0.80} sub="ADS ÷ Gross Revenue" />
            <ResultRow label="Balance @ Yr 10" value={fmtM(results.bal10)} borderTop
              sub={`${fmtPct1(results.bal10/results.loanAmount)} of original`} />
            <ResultRow label="Balance @ Yr 15" value={fmtM(results.bal15)}
              sub={`${fmtPct1(results.bal15/results.loanAmount)} of original`} />
          </div>

          {/* Rate / DSCR quick-adjust */}
          <div style={{ background:"white", border:"1px solid #e0e0e0", borderRadius:6, padding:"14px 18px" }}>
            <div style={{ fontSize:8, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", color:"#888", marginBottom:12 }}>Quick Adjustments</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
              {/* Rate slider */}
              <div>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
                  <span style={{ fontSize:9, color:"#666", textTransform:"uppercase", letterSpacing:"0.05em" }}>Rate</span>
                  <span style={{ fontSize:11, fontWeight:700, color:"#1a3a6b" }}>{(rate*100).toFixed(3)}%</span>
                </div>
                <input type="range" min={300} max={800} step={1}
                  value={Math.round(rate*10000)}
                  onChange={e => setRate(Number(e.target.value)/10000)}
                  style={{ width:"100%", accentColor:"#1a3a6b" }} />
                <div style={{ display:"flex", justifyContent:"space-between", fontSize:8, color:"#ccc" }}>
                  <span>3.00%</span><span>8.00%</span>
                </div>
              </div>
              {/* DSCR slider */}
              {mode === "dscr" && (
                <div>
                  <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
                    <span style={{ fontSize:9, color:"#666", textTransform:"uppercase", letterSpacing:"0.05em" }}>Target DSCR</span>
                    <span style={{ fontSize:11, fontWeight:700, color:"#1a3a6b" }}>{fmtX(targetDSCR)}</span>
                  </div>
                  <input type="range" min={110} max={150} step={1}
                    value={Math.round(targetDSCR*100)}
                    onChange={e => setTargetDSCR(Number(e.target.value)/100)}
                    style={{ width:"100%", accentColor:"#1a3a6b" }} />
                  <div style={{ display:"flex", justifyContent:"space-between", fontSize:8, color:"#ccc" }}>
                    <span>1.10x</span><span>1.50x</span>
                  </div>
                </div>
              )}
              {mode !== "dscr" && (
                <div>
                  <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
                    <span style={{ fontSize:9, color:"#666", textTransform:"uppercase", letterSpacing:"0.05em" }}>Amort</span>
                    <span style={{ fontSize:11, fontWeight:700, color:"#1a3a6b" }}>{amort} yrs</span>
                  </div>
                  <input type="range" min={20} max={40} step={5}
                    value={amort}
                    onChange={e => setAmort(Number(e.target.value))}
                    style={{ width:"100%", accentColor:"#1a3a6b" }} />
                  <div style={{ display:"flex", justifyContent:"space-between", fontSize:8, color:"#ccc" }}>
                    <span>20</span><span>40</span>
                  </div>
                </div>
              )}
            </div>
          </div>

        </div>
      </div>

      {/* Sensitivity Grid */}
      {showGrid && (
        <div style={{ marginTop:18 }}>
          <SensitivityGrid noi={noi} baseRate={rate} baseAmort={amort} baseDSCR={targetDSCR} />
        </div>
      )}

      {/* Amort Schedule */}
      {showAmort && results.loanAmount > 0 && (
        <div style={{ marginTop:14 }}>
          <AmortSchedule principal={results.loanAmount} rate={rate} amortYears={amort} noi={noi} />
        </div>
      )}

      {/* Push confirmation */}
      {onLoanUpdate && (
        <div style={{ marginTop:16, padding:"12px 16px", background:"#f0f3f9", border:"1px solid #b8c8e0", borderRadius:5, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <div style={{ fontSize:9, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", color:"#1a3a6b", marginBottom:3 }}>Ready to push to proforma?</div>
            <div style={{ fontSize:10, color:"#888" }}>
              Loan {fmtM(results.loanAmount)} · {(rate*100).toFixed(3)}% · {amort}-yr amort · ADS {fmt$(results.ads)} · DSCR {fmtX(results.dscr)}
            </div>
          </div>
          <button
            onClick={() => onLoanUpdate(results.loanAmount, rate, amort, results.ads)}
            style={{ background:"#1a3a6b", color:"white", border:"none", padding:"9px 18px", borderRadius:4, cursor:"pointer", fontSize:10, letterSpacing:"0.08em", textTransform:"uppercase", fontFamily:"Inter, sans-serif", fontWeight:700, flexShrink:0 }}>
            Push to Proforma →
          </button>
        </div>
      )}
    </div>
  );
}
