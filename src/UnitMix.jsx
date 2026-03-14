import { useState, useCallback, useEffect } from "react";
import { useLihtc } from "./context/LihtcContext.jsx";
import { supabase } from "./supabase.js";

// ─────────────────────────────────────────────────────────────────────────────
// UNIT MIX TAB — LIHTC Engine
// AMI limits loaded from lihtc_ami_limits table in Supabase.
// Updated annually when HUD publishes new MTSP limits (~April 1).
// ─────────────────────────────────────────────────────────────────────────────

const AMI_LEVELS  = [30, 40, 50, 60, 65, 70, 75, 80, 90, 100];
const AMI_COL_MAP = {
  30:"pct_30", 40:"pct_40", 50:"pct_50", 60:"pct_60",
  65:"pct_65", 70:"pct_70", 75:"pct_75", 80:"pct_80",
  90:"pct_90", 100:"pct_100", fmr:"fmr"
};

const DEFAULT_METRO = "Seattle-Bellevue, WA HMFA";
const DEFAULT_YEAR  = 2025;

const DEFAULT_UNIT_MIX = [
  { id: 1, type: "Studio",    bedrooms: 0, count: 18, ami_pct: 60, utility_allowance: 70,  rent_override: null, notes: "" },
  { id: 2, type: "1 BD/1 BA", bedrooms: 1, count: 62, ami_pct: 60, utility_allowance: 90,  rent_override: null, notes: "" },
  { id: 3, type: "1 BD/1 BA", bedrooms: 1, count: 30, ami_pct: 50, utility_allowance: 90,  rent_override: null, notes: "" },
  { id: 4, type: "2 BD/1 BA", bedrooms: 2, count: 42, ami_pct: 60, utility_allowance: 110, rent_override: null, notes: "" },
  { id: 5, type: "2 BD/2 BA", bedrooms: 2, count: 15, ami_pct: 50, utility_allowance: 110, rent_override: null, notes: "" },
  { id: 6, type: "3 BD/2 BA", bedrooms: 3, count: 8,  ami_pct: 60, utility_allowance: 130, rent_override: null, notes: "" },
];

let _rowId = 100;
const mkRowId = () => ++_rowId;

const fmt$ = v => v == null ? "—" : "$" + Math.round(v).toLocaleString();
const fmtM = v => v == null ? "—" : "$" + (v / 1000000).toFixed(3) + "M";

// Build lookup grid from DB row: { 30: [825,884,...], 40: [...], fmr: [...] }
function buildAmiGrid(dbRow) {
  if (!dbRow) return null;
  const grid = {};
  for (const [ami, col] of Object.entries(AMI_COL_MAP)) {
    grid[Number(ami) || ami] = dbRow[col] ?? [];
  }
  return grid;
}

export function calcMaxAllowable(amiGrid, ami_pct, bedrooms) {
  if (!amiGrid) return 0;
  const row = amiGrid[ami_pct];
  if (!row || !row.length) return 0;
  return row[Math.min(bedrooms, 5)] ?? 0;
}

export function calcMaxRent(amiGrid, ami_pct, bedrooms, utilityAllowance = 0) {
  return Math.max(0, calcMaxAllowable(amiGrid, ami_pct, bedrooms) - utilityAllowance);
}

// ─── INPUT CELL ──────────────────────────────────────────────────────────────
function Cell({ value, onChange, type = "text", width, align = "right", placeholder, style = {} }) {
  return (
    <input
      type={type}
      value={value ?? ""}
      placeholder={placeholder}
      onChange={e => {
        const v = type === "number" ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value;
        onChange(v);
      }}
      style={{
        width: width || "100%", background: "transparent", border: "none",
        borderBottom: "1px solid transparent", outline: "none", fontSize: 11,
        fontFamily: "Inter, sans-serif", color: "#1a3a6b", textAlign: align,
        padding: "3px 6px", borderRadius: 0, ...style,
      }}
      onFocus={e => e.target.style.borderBottomColor = "#1a3a6b"}
      onBlur={e => e.target.style.borderBottomColor = "transparent"}
    />
  );
}

// ─── AMI SELECT ──────────────────────────────────────────────────────────────
function AmiSelect({ value, onChange }) {
  return (
    <select value={value} onChange={e => onChange(Number(e.target.value))}
      style={{ background: "transparent", border: "none", fontSize: 11, fontFamily: "Inter, sans-serif", color: "#5a3a00", fontWeight: 700, cursor: "pointer", outline: "none", padding: "3px 2px", width: "100%", textAlign: "right" }}>
      {AMI_LEVELS.map(a => <option key={a} value={a}>{a}%</option>)}
      <option value={0}>Market</option>
    </select>
  );
}

// ─── BD SELECT ───────────────────────────────────────────────────────────────
function BdSelect({ value, onChange }) {
  return (
    <select value={value} onChange={e => onChange(Number(e.target.value))}
      style={{ background: "transparent", border: "none", fontSize: 11, fontFamily: "Inter, sans-serif", color: "#111", cursor: "pointer", outline: "none", padding: "3px 2px", width: "100%" }}>
      {[0, 1, 2, 3, 4].map(n => <option key={n} value={n}>{n === 0 ? "Studio" : `${n} BD`}</option>)}
    </select>
  );
}

// ─── SUMMARY CARD ────────────────────────────────────────────────────────────
function SummaryCard({ label, value, sub, accent }) {
  const colors = {
    green: { bg: "#f0f9f4", border: "#b8dfc8", text: "#1a6b3c" },
    navy:  { bg: "#f0f3f9", border: "#b8c8e0", text: "#1a3a6b" },
    brown: { bg: "#fdf8f0", border: "#e8d9b8", text: "#5a3a00" },
    gray:  { bg: "#f8f8f8", border: "#e0e0e0", text: "#444" },
  };
  const c = colors[accent] || colors.gray;
  return (
    <div style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 5, padding: "11px 14px", minWidth: 120 }}>
      <div style={{ fontSize: 8, textTransform: "uppercase", letterSpacing: "0.1em", color: c.text, fontWeight: 700, marginBottom: 5 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "'Playfair Display', serif", color: "#111", marginBottom: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 9, color: "#aaa" }}>{sub}</div>}
    </div>
  );
}

// ─── AMI DISTRIBUTION BAR ────────────────────────────────────────────────────
function AmiDistBar({ rows }) {
  const byAmi = {}, total = rows.reduce((s, r) => s + (r.count || 0), 0);
  rows.forEach(r => {
    const key = r.ami_pct === 0 ? "Market" : `${r.ami_pct}%`;
    byAmi[key] = (byAmi[key] || 0) + (r.count || 0);
  });
  const palette = { "30%":"#1a3a6b","40%":"#1a5a8a","50%":"#1a6b3c","60%":"#2a8a50","65%":"#3a7a30","70%":"#5a3a00","75%":"#7a4a00","80%":"#8B2500","90%":"#6b0000","100%":"#888","Market":"#ccc" };
  const entries = Object.entries(byAmi);
  return (
    <div>
      <div style={{ display: "flex", height: 10, borderRadius: 2, overflow: "hidden", marginBottom: 6 }}>
        {entries.map(([k, v]) => (
          <div key={k} style={{ width: `${(v / total) * 100}%`, background: palette[k] || "#999", transition: "width 0.2s" }} title={`${k}: ${v} units`} />
        ))}
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {entries.map(([k, v]) => (
          <div key={k} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 9 }}>
            <div style={{ width: 8, height: 8, borderRadius: 1, background: palette[k] || "#999", flexShrink: 0 }} />
            <span style={{ color: "#888" }}>{k}: </span>
            <span style={{ fontWeight: 700, color: "#111" }}>{v}u ({((v / total) * 100).toFixed(0)}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── MAX RENT REFERENCE TABLE ─────────────────────────────────────────────────
function MaxRentTable({ amiGrid, metroName, fiscalYear }) {
  const brs = [0, 1, 2, 3];
  const amis = [50, 60, 70, 80];
  const uaByBr = { 0: 70, 1: 90, 2: 110, 3: 130 };
  return (
    <div style={{ background: "white", border: "1px solid #e0e0e0", borderRadius: 6, padding: "14px 18px" }}>
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#888", marginBottom: 4 }}>
        Max Rent Reference
      </div>
      <div style={{ fontSize: 8, color: "#aaa", marginBottom: 10 }}>
        {metroName} · FY{fiscalYear} MTSP · Source: HUD · Max Rent = Max Allowable − UA
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10, fontFamily: "Inter, sans-serif" }}>
        <thead>
          <tr style={{ borderBottom: "2px solid #111" }}>
            <th style={{ padding: "5px 8px", textAlign: "left", fontSize: 8, color: "#888", textTransform: "uppercase" }}>Unit Type</th>
            {amis.map(a => (
              <th key={a} style={{ padding: "5px 8px", textAlign: "right", fontSize: 8, color: "#888", textTransform: "uppercase" }}>{a}% AMI</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {brs.map(br => (
            <tr key={br} style={{ borderBottom: "1px solid #f5f5f5" }}>
              <td style={{ padding: "5px 8px", color: "#444" }}>{br === 0 ? "Studio" : `${br} BD`}</td>
              {amis.map(a => (
                <td key={a} style={{ padding: "5px 8px", textAlign: "right", fontWeight: 500 }}>
                  {fmt$(calcMaxAllowable(amiGrid, a, br))}
                  <span style={{ fontSize: 8, color: "#ccc", marginLeft: 3 }}>−{fmt$(uaByBr[br])}</span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── MAIN UNIT MIX PANEL ──────────────────────────────────────────────────────
export default function UnitMixPanel({ onRevenueChange }) {
  const { moduleStates, updateModule } = useLihtc();

  // Rows + metro/year — all versioned via context
  const rows          = moduleStates.unit_mix?.rows       ?? DEFAULT_UNIT_MIX;
  const selectedMetro = moduleStates.unit_mix?.metro_name ?? DEFAULT_METRO;
  const selectedYear  = moduleStates.unit_mix?.fiscal_year ?? DEFAULT_YEAR;

  // AMI grid — reference data, fetched fresh, not versioned
  const [amiGrid,         setAmiGrid]         = useState(null);
  const [amiLoading,      setAmiLoading]      = useState(true);
  const [amiError,        setAmiError]        = useState(null);
  const [availableMetros, setAvailableMetros] = useState([DEFAULT_METRO]);
  const [availableYears,  setAvailableYears]  = useState([DEFAULT_YEAR]);

  // UI only — never versioned
  const [showRef, setShowRef] = useState(false);

  // Fetch available metros + years on mount
  useEffect(() => {
    supabase
      .from("lihtc_ami_limits")
      .select("metro_name, fiscal_year")
      .order("fiscal_year", { ascending: false })
      .then(({ data }) => {
        if (!data) return;
        setAvailableMetros([...new Set(data.map(r => r.metro_name))]);
        setAvailableYears([...new Set(data.map(r => r.fiscal_year))]);
      });
  }, []);

  // Fetch AMI grid whenever metro or year changes
  useEffect(() => {
    setAmiLoading(true);
    setAmiError(null);
    supabase
      .from("lihtc_ami_limits")
      .select("*")
      .eq("metro_name", selectedMetro)
      .eq("fiscal_year", selectedYear)
      .single()
      .then(({ data, error }) => {
        if (error || !data) {
          setAmiError(`No AMI data for ${selectedMetro} FY${selectedYear}`);
          setAmiGrid(null);
        } else {
          setAmiGrid(buildAmiGrid(data));
        }
        setAmiLoading(false);
      });
  }, [selectedMetro, selectedYear]);

  // Write rows back to context
  const setRows = useCallback((updater) => {
    const currentRows = moduleStates.unit_mix?.rows ?? DEFAULT_UNIT_MIX;
    const nextRows = typeof updater === "function" ? updater(currentRows) : updater;
    updateModule("unit_mix", { rows: nextRows });
  }, [moduleStates.unit_mix, updateModule]);

  // Write metro/year selection to context (saved with version snapshots)
  const setMetro = (v) => updateModule("unit_mix", { metro_name: v });
  const setYear  = (v) => updateModule("unit_mix", { fiscal_year: v });

  // Row operations
  const updateRow = useCallback((id, field, value) => {
    setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  }, [setRows]);

  const addRow = () => setRows(prev => [...prev, {
    id: mkRowId(), type: "New Unit", bedrooms: 1, count: 0,
    ami_pct: 60, utility_allowance: 90, rent_override: null, notes: ""
  }]);

  const removeRow    = (id) => setRows(prev => prev.filter(r => r.id !== id));
  const duplicateRow = (id) => {
    const src = rows.find(r => r.id === id);
    if (!src) return;
    const idx = rows.findIndex(r => r.id === id);
    const newRows = [...rows];
    newRows.splice(idx + 1, 0, { ...src, id: mkRowId(), type: src.type + " (copy)" });
    setRows(newRows);
  };

  // Row calculations
  const calcRow = (r) => {
    const maxAllowable = r.ami_pct === 0 ? 0 : calcMaxAllowable(amiGrid, r.ami_pct, r.bedrooms);
    const maxRent = r.rent_override != null
      ? r.rent_override
      : Math.max(0, maxAllowable - (r.utility_allowance || 0));
    return { maxAllowable, maxRent, monthlyRevenue: maxRent * (r.count || 0), annualRevenue: maxRent * (r.count || 0) * 12 };
  };

  const totalUnits     = rows.reduce((s, r) => s + (r.count || 0), 0);
  const totalAnnualRev = rows.reduce((s, r) => s + calcRow(r).annualRevenue, 0);
  const avgRent        = totalUnits > 0 ? (totalAnnualRev / 12 / totalUnits) : 0;
  const lihtcUnits     = rows.filter(r => r.ami_pct > 0 && r.ami_pct <= 80).reduce((s, r) => s + (r.count || 0), 0);

  const COL_WIDTHS = { type:160, bd:80, count:60, ami:72, ua:72, maxallow:90, maxrent:90, monthrev:100, annrev:110, notes:120, actions:56 };

  const TH = ({ children, w, align = "right" }) => (
    <th style={{ padding:"6px 8px", textAlign:align, fontSize:8, color:"#888", textTransform:"uppercase", letterSpacing:"0.07em", fontWeight:700, whiteSpace:"nowrap", width:w }}>
      {children}
    </th>
  );

  const selStyle = { background:"white", border:"1px solid #d0d0d0", borderRadius:4, fontSize:10, fontFamily:"Inter, sans-serif", color:"#111", padding:"4px 8px", cursor:"pointer", outline:"none" };

  return (
    <div>
      {/* Header */}
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:18 }}>
        <div>
          <div style={{ display:"flex", alignItems:"baseline", gap:10, marginBottom:8 }}>
            <h2 style={{ fontFamily:"'Playfair Display', serif", fontSize:20, fontWeight:400, color:"#111" }}>Unit Mix</h2>
            <span style={{ fontSize:9, color:"#aaa", letterSpacing:"0.08em", textTransform:"uppercase" }}>RENT SCHEDULE · REVENUE CALC</span>
          </div>
          {/* Metro / Year selector */}
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <select value={selectedMetro} onChange={e => setMetro(e.target.value)} style={{ ...selStyle, minWidth:240 }}>
              {availableMetros.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <select value={selectedYear} onChange={e => setYear(Number(e.target.value))} style={{ ...selStyle, width:80 }}>
              {availableYears.map(y => <option key={y} value={y}>FY{y}</option>)}
            </select>
            {amiLoading && <span style={{ fontSize:9, color:"#aaa" }}>Loading limits…</span>}
            {!amiLoading && amiError   && <span style={{ fontSize:9, color:"#8B2500" }}>⚠ {amiError}</span>}
            {!amiLoading && !amiError  && <span style={{ fontSize:9, color:"#1a6b3c" }}>✓ HUD MTSP FY{selectedYear}</span>}
          </div>
        </div>
        <div style={{ display:"flex", gap:8, marginTop:4 }}>
          <button onClick={() => setShowRef(v => !v)}
            style={{ background:"white", border:"1px solid #e0e0e0", color:"#666", padding:"5px 12px", borderRadius:3, cursor:"pointer", fontSize:9, letterSpacing:"0.08em", textTransform:"uppercase", fontFamily:"Inter, sans-serif" }}>
            {showRef ? "Hide" : "AMI Ref"}
          </button>
          <button onClick={addRow}
            style={{ background:"#1a3a6b", color:"white", border:"none", padding:"5px 12px", borderRadius:3, cursor:"pointer", fontSize:9, letterSpacing:"0.08em", textTransform:"uppercase", fontFamily:"Inter, sans-serif", fontWeight:700 }}>
            + Row
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div style={{ display:"flex", gap:10, marginBottom:20, flexWrap:"wrap" }}>
        <SummaryCard label="Total Units"      value={totalUnits}                sub={`${lihtcUnits} LIHTC`}                    accent="navy"  />
        <SummaryCard label="Annual Revenue"   value={fmtM(totalAnnualRev)}      sub="Gross residential"                        accent="green" />
        <SummaryCard label="Avg Monthly Rent" value={fmt$(avgRent)}             sub="Per unit"                                 accent="brown" />
        <SummaryCard label="Monthly Revenue"  value={fmt$(totalAnnualRev / 12)} sub={`${totalUnits} units × ${fmt$(avgRent)}`} accent="gray"  />
      </div>

      {/* AMI Distribution */}
      <div style={{ background:"white", border:"1px solid #e0e0e0", borderRadius:6, padding:"12px 16px", marginBottom:16 }}>
        <div style={{ fontSize:8, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", color:"#888", marginBottom:8 }}>Unit Distribution by AMI</div>
        <AmiDistBar rows={rows} />
      </div>

      {/* Reference table (collapsible) */}
      {showRef && !amiLoading && amiGrid && (
        <div style={{ marginBottom:16 }}>
          <MaxRentTable amiGrid={amiGrid} metroName={selectedMetro} fiscalYear={selectedYear} />
        </div>
      )}

      {/* Main grid */}
      <div style={{ background:"white", border:"1px solid #e0e0e0", borderRadius:6, overflowX:"auto" }}>
        {amiLoading ? (
          <div style={{ padding:40, textAlign:"center", color:"#aaa", fontSize:11 }}>Loading AMI limits…</div>
        ) : (
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11, fontFamily:"Inter, sans-serif" }}>
            <thead>
              <tr style={{ borderBottom:"2px solid #111", background:"#fafafa" }}>
                <TH w={COL_WIDTHS.type}    align="left">Unit Type</TH>
                <TH w={COL_WIDTHS.bd}                  >Bedrooms</TH>
                <TH w={COL_WIDTHS.count}               >Count</TH>
                <TH w={COL_WIDTHS.ami}                 >AMI %</TH>
                <TH w={COL_WIDTHS.ua}                  >Util Allow</TH>
                <TH w={COL_WIDTHS.maxallow}            >Max Allowable</TH>
                <TH w={COL_WIDTHS.maxrent}             >Max Rent</TH>
                <TH w={COL_WIDTHS.monthrev}            >Mo. Revenue</TH>
                <TH w={COL_WIDTHS.annrev}              >Ann. Revenue</TH>
                <TH w={COL_WIDTHS.notes}  align="left" >Notes</TH>
                <TH w={COL_WIDTHS.actions}             ></TH>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => {
                const { maxAllowable, maxRent, monthlyRevenue, annualRevenue } = calcRow(r);
                const isOverride = r.rent_override != null;
                const netMax = maxAllowable - (r.utility_allowance || 0);
                return (
                  <tr key={r.id} style={{ borderBottom:"1px solid #f5f5f5", background: idx % 2 === 0 ? "white" : "#fdfcfb" }}>
                    <td style={{ padding:"4px 8px", textAlign:"left" }}>
                      <Cell value={r.type} onChange={v => updateRow(r.id, "type", v)} align="left" style={{ fontWeight:600, color:"#111" }} />
                    </td>
                    <td style={{ padding:"4px 8px", textAlign:"right" }}>
                      <BdSelect value={r.bedrooms} onChange={v => updateRow(r.id, "bedrooms", v)} />
                    </td>
                    <td style={{ padding:"4px 8px", textAlign:"right" }}>
                      <Cell value={r.count} onChange={v => updateRow(r.id, "count", v)} type="number" style={{ fontWeight:700, color:"#111", width:50 }} />
                    </td>
                    <td style={{ padding:"4px 8px", textAlign:"right" }}>
                      <AmiSelect value={r.ami_pct} onChange={v => updateRow(r.id, "ami_pct", v)} />
                    </td>
                    <td style={{ padding:"4px 8px", textAlign:"right" }}>
                      <Cell value={r.utility_allowance} onChange={v => updateRow(r.id, "utility_allowance", v)} type="number" style={{ color:"#666", width:60 }} />
                    </td>
                    <td style={{ padding:"4px 14px", textAlign:"right" }}>
                      <span style={{ fontSize:11, color:"#aaa" }}>{r.ami_pct === 0 ? "Market" : fmt$(maxAllowable)}</span>
                    </td>
                    <td style={{ padding:"4px 8px", textAlign:"right" }}>
                      <div style={{ position:"relative" }}>
                        <Cell
                          value={r.rent_override ?? ""}
                          onChange={v => updateRow(r.id, "rent_override", v === "" ? null : Number(v))}
                          type="number"
                          placeholder={r.ami_pct === 0 ? "—" : fmt$(Math.max(0, netMax))}
                          style={{ color: isOverride ? "#5a3a00" : "#111", fontWeight: isOverride ? 700 : 400, width:80 }}
                        />
                        {isOverride && r.rent_override > netMax && <span style={{ position:"absolute", right:-14, top:4, fontSize:9, color:"#8B2500" }} title="Above net max">↑</span>}
                        {isOverride && r.rent_override < netMax && <span style={{ position:"absolute", right:-14, top:4, fontSize:9, color:"#1a6b3c" }} title="Below net max">↓</span>}
                      </div>
                    </td>
                    <td style={{ padding:"4px 14px", textAlign:"right" }}>
                      <span style={{ fontSize:11, fontWeight:500 }}>{fmt$(monthlyRevenue)}</span>
                    </td>
                    <td style={{ padding:"4px 14px", textAlign:"right" }}>
                      <span style={{ fontSize:11, fontWeight:700, color:"#1a3a6b" }}>{fmt$(annualRevenue)}</span>
                    </td>
                    <td style={{ padding:"4px 8px" }}>
                      <Cell value={r.notes} onChange={v => updateRow(r.id, "notes", v)} align="left" style={{ color:"#aaa", fontSize:10 }} />
                    </td>
                    <td style={{ padding:"4px 6px", textAlign:"right", whiteSpace:"nowrap" }}>
                      <button onClick={() => duplicateRow(r.id)} title="Duplicate" style={{ background:"none", border:"none", cursor:"pointer", color:"#bbb", fontSize:11, padding:"2px 3px" }}>⎘</button>
                      <button onClick={() => removeRow(r.id)}    title="Remove"    style={{ background:"none", border:"none", cursor:"pointer", color:"#ddd", fontSize:11, padding:"2px 3px" }}>✕</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ borderTop:"2px solid #111", background:"#fafafa" }}>
                <td colSpan={2} style={{ padding:"8px 14px", fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em", color:"#888" }}>TOTAL</td>
                <td style={{ padding:"8px 8px", textAlign:"right", fontWeight:700, fontSize:12 }}>{totalUnits}</td>
                <td colSpan={4} />
                <td style={{ padding:"8px 14px", textAlign:"right", fontWeight:700, fontSize:12 }}>{fmt$(totalAnnualRev / 12)}</td>
                <td style={{ padding:"8px 14px", textAlign:"right", fontWeight:700, fontSize:13, color:"#1a3a6b" }}>{fmtM(totalAnnualRev)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {/* Push to proforma */}
      <div style={{ marginTop:16, padding:"12px 16px", background:"#f0f3f9", border:"1px solid #b8c8e0", borderRadius:5, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div>
          <div style={{ fontSize:9, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", color:"#1a3a6b", marginBottom:3 }}>Gross Annual Revenue</div>
          <div style={{ fontSize:22, fontWeight:700, fontFamily:"'Playfair Display', serif", color:"#111" }}>{fmtM(totalAnnualRev)}</div>
          <div style={{ fontSize:9, color:"#888", marginTop:2 }}>
            {totalUnits} units · {fmt$(avgRent)}/mo avg · {fmt$(totalAnnualRev / 12)}/mo total
          </div>
        </div>
        {onRevenueChange && (
          <button onClick={() => onRevenueChange(totalAnnualRev)}
            style={{ background:"#1a3a6b", color:"white", border:"none", padding:"9px 18px", borderRadius:4, cursor:"pointer", fontSize:10, letterSpacing:"0.08em", textTransform:"uppercase", fontFamily:"Inter, sans-serif", fontWeight:700 }}>
            Push to Proforma →
          </button>
        )}
      </div>
    </div>
  );
}
