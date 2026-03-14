/**
 * SourcesUses.jsx — read-only Sources & Uses matrix
 * Construction Stack | Permanent Stack
 * Rows = Sources List, Columns = Dev Budget categories
 */

const fmt$ = v => v == null || v === 0 ? "—" : "$" + Math.round(v).toLocaleString();
const fmtM = v => v == null ? "—" : "$" + (v / 1e6).toFixed(3) + "M";
const fmtPct = v => v == null ? "—" : (v * 100).toFixed(1) + "%";

const SOURCE_TYPE_COLORS = {
  const_loan_te:     "#1a3a6b",
  const_loan_taxable:"#2a5a9b",
  perm_loan:         "#1a3a6b",
  lihtc_equity:      "#1a6b3c",
  deferred_fee:      "#5a3a00",
  sub_debt:          "#8B2500",
  grant:             "#555",
  other:             "#888",
};

// Which sources appear in construction vs permanent stack
const CONST_TYPES  = new Set(["const_loan_te", "const_loan_taxable"]);
const PERM_TYPES   = new Set(["perm_loan", "lihtc_equity", "deferred_fee", "sub_debt", "grant", "other"]);

// Budget categories that go into each "uses" column
const USES_COLS = [
  { key: "Acquisition",    label: "Acquisition" },
  { key: "Hard Costs",     label: "Hard Costs" },
  { key: "Soft Costs",     label: "Soft Costs" },
  { key: "Architecture & Engineering", label: "A&E" },
  { key: "Financing Costs",label: "Financing" },
  { key: "Developer Fee",  label: "Dev Fee" },
  { key: "Reserves",       label: "Reserves" },
];

function StackTable({ title, subtitle, sources, budgetByCategory, tdc, accent }) {
  const totalSources = sources.reduce((s, r) => s + (r.amount || 0), 0);
  const usesTotal = USES_COLS.reduce((s, c) => s + (budgetByCategory[c.key] || 0), 0);
  const gap = totalSources - usesTotal;

  return (
    <div style={{ background: "white", border: "1px solid #e0e0e0", borderRadius: 6, padding: "18px 20px", marginBottom: 20 }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span style={{ fontFamily: "'Playfair Display',serif", fontSize: 16, fontWeight: 400, color: "#111" }}>{title}</span>
          <span style={{ fontSize: 9, color: "#aaa", letterSpacing: "0.08em", textTransform: "uppercase" }}>{subtitle}</span>
        </div>
        <div style={{ display: "flex", gap: 16, marginTop: 8 }}>
          <span style={{ fontSize: 10, color: "#888" }}>
            Sources: <strong style={{ fontFamily: "'DM Mono',monospace", color: accent }}>{fmtM(totalSources)}</strong>
          </span>
          <span style={{ fontSize: 10, color: "#888" }}>
            Uses: <strong style={{ fontFamily: "'DM Mono',monospace", color: "#111" }}>{fmtM(usesTotal)}</strong>
          </span>
          {Math.abs(gap) > 1000 && (
            <span style={{ fontSize: 10, color: gap > 0 ? "#8B2500" : "#1a6b3c" }}>
              {gap > 0 ? `Gap: ${fmtM(gap)}` : `Excess: ${fmtM(Math.abs(gap))}`}
            </span>
          )}
        </div>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 11, width: "100%", minWidth: 700 }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #111" }}>
              <th style={{ ...th, width: 160 }}>Source</th>
              <th style={{ ...th, textAlign: "right", minWidth: 90 }}>Amount</th>
              {USES_COLS.map(c => (
                <th key={c.key} style={{ ...th, textAlign: "right", minWidth: 80 }}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sources.map((s, i) => {
              const color = SOURCE_TYPE_COLORS[s.source_type] || "#888";
              // Simple allocation: pro-rata fill from left to right
              // Each source fills each use bucket proportionally
              const srcPct = totalSources > 0 ? (s.amount || 0) / totalSources : 0;
              return (
                <tr key={s.id || i} style={{ borderBottom: "1px solid #f5f5f5", background: i % 2 === 0 ? "white" : "#fafafa" }}>
                  <td style={{ ...td, paddingLeft: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ width: 3, height: 16, background: color, borderRadius: 1, flexShrink: 0 }} />
                      <span style={{ fontWeight: 600, color: "#111", fontSize: 11 }}>{s.name}</span>
                    </div>
                  </td>
                  <td style={{ ...td, textAlign: "right", fontFamily: "'DM Mono',monospace", fontWeight: 600, color: accent }}>{fmtM(s.amount)}</td>
                  {USES_COLS.map(c => {
                    const bucket = budgetByCategory[c.key] || 0;
                    const allocated = bucket * srcPct;
                    return (
                      <td key={c.key} style={{ ...td, textAlign: "right", fontFamily: "'DM Mono',monospace", fontSize: 10, color: allocated > 0 ? "#333" : "#ddd" }}>
                        {allocated > 100 ? fmt$(allocated) : "—"}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: "2px solid #111", background: "#f8f8f8" }}>
              <td style={{ ...td, fontWeight: 700 }}>TOTAL</td>
              <td style={{ ...td, textAlign: "right", fontFamily: "'DM Mono',monospace", fontWeight: 700, color: accent }}>{fmtM(totalSources)}</td>
              {USES_COLS.map(c => {
                const bucket = budgetByCategory[c.key] || 0;
                return (
                  <td key={c.key} style={{ ...td, textAlign: "right", fontFamily: "'DM Mono',monospace", fontWeight: 700 }}>
                    {bucket > 0 ? fmtM(bucket) : "—"}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

const th = { padding: "5px 10px", textAlign: "left", fontSize: 8, color: "#888", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 };
const td = { padding: "7px 10px" };

export default function SourcesUsesPanel({ sources, budgetWithCalc, baseFA }) {
  const tdc = budgetWithCalc?.totalCost ?? baseFA?.total_dev_cost ?? 0;

  // Build budget-by-category lookup
  const budgetByCategory = {};
  (budgetWithCalc?.items || []).forEach(item => {
    budgetByCategory[item.category] = (budgetByCategory[item.category] || 0) + (item.amount || 0);
  });
  // Also include CALC items
  (budgetWithCalc?.calcItems || []).forEach(item => {
    if (item.category) {
      budgetByCategory[item.category] = (budgetByCategory[item.category] || 0) + (item.amount || 0);
    }
  });

  const constSources = (sources || []).filter(s => CONST_TYPES.has(s.source_type));
  const permSources  = (sources || []).filter(s => PERM_TYPES.has(s.source_type));

  const constTotal = constSources.reduce((s, r) => s + (r.amount || 0), 0);
  const permTotal  = permSources.reduce((s, r) => s + (r.amount || 0), 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>

      {/* HEADER */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <h2 style={{ fontFamily: "'Playfair Display',serif", fontSize: 20, fontWeight: 400, color: "#111", margin: 0 }}>Sources & Uses</h2>
          <span style={{ fontSize: 9, color: "#aaa", letterSpacing: "0.08em", textTransform: "uppercase" }}>CONSTRUCTION · PERMANENT · READ-ONLY</span>
        </div>
        <div style={{ fontSize: 10, color: "#888" }}>TDC: <strong style={{ fontFamily: "'DM Mono',monospace", color: "#111" }}>{fmtM(tdc)}</strong></div>
      </div>

      {/* Note */}
      <div style={{ padding: "10px 14px", background: "#f0f3f9", border: "1px solid #b8c8e0", borderRadius: 5, fontSize: 10, color: "#555", marginBottom: 8 }}>
        <strong>Construction Stack</strong> shows lenders active during construction (const loans, which are repaid at conversion).{" "}
        <strong>Permanent Stack</strong> shows sources that remain at stabilization. Allocations are pro-rata across use categories.
      </div>

      {/* CONSTRUCTION STACK */}
      <StackTable
        title="Construction Stack"
        subtitle="Interest-only · Retires at conversion"
        sources={constSources}
        budgetByCategory={budgetByCategory}
        tdc={tdc}
        accent="#1a3a6b"
      />

      {/* PERMANENT STACK */}
      <StackTable
        title="Permanent Stack"
        subtitle="Remains at stabilization"
        sources={permSources}
        budgetByCategory={budgetByCategory}
        tdc={tdc}
        accent="#1a6b3c"
      />

      {/* TOTAL RECAP */}
      <div style={{ background: "white", border: "1px solid #e0e0e0", borderRadius: 6, padding: "14px 20px" }}>
        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#888", marginBottom: 10 }}>Recap</div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          {[
            { label: "TDC (Uses)",         value: fmtM(tdc),             color: "#111" },
            { label: "Const Sources",       value: fmtM(constTotal),      color: "#1a3a6b" },
            { label: "Perm Sources",        value: fmtM(permTotal),       color: "#1a6b3c" },
            { label: "Total Sources",       value: fmtM(constTotal > permTotal ? constTotal : permTotal), color: "#111" },
            { label: "Gap / (Surplus)",     value: fmtM(tdc - permTotal), color: Math.abs(tdc - permTotal) < 1000 ? "#1a6b3c" : "#8B2500" },
          ].map(p => (
            <div key={p.label} style={{ background: "#f8f8f8", border: "1px solid #e0e0e0", borderRadius: 4, padding: "8px 14px", minWidth: 130 }}>
              <div style={{ fontSize: 9, color: "#888", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 3 }}>{p.label}</div>
              <div style={{ fontFamily: "'DM Mono',monospace", fontWeight: 700, fontSize: 14, color: p.color }}>{p.value}</div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
