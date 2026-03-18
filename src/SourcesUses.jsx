/**
 * SourcesUses.jsx — Module 5: Sources & Uses Summary
 * Clean rollup of Uses (by budget category) and Sources (from Debt stack + LIHTC equity).
 * All data pulled live from LihtcContext — single source of truth.
 */
import { useLihtc } from "./context/LihtcContext.jsx";
import { computeBudgetCalcs, computeLIHTC } from "./lihtcCalcs.js";

const fmt$ = v => v == null || v === 0
  ? "—"
  : "$" + Math.round(Math.abs(v)).toLocaleString();
const fmtPct = v => v == null ? "—" : (v * 100).toFixed(1) + "%";

/* ── tiny sub-components ─────────────────────────────────────────── */

function SectionRow({ label, value, bold, border, accent, pct, italic }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: bold ? "8px 14px" : "5px 14px",
      borderTop: border ? "2px solid #333" : "1px solid #f0f0f0",
      background: bold ? "#f5f5f0" : "transparent",
    }}>
      <span style={{
        fontSize: bold ? 12 : 11, fontWeight: bold ? 700 : 400,
        color: italic ? "#888" : "#222",
        fontStyle: italic ? "italic" : "normal",
      }}>
        {label}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <span style={{
          fontFamily: "Inter, sans-serif",
          fontSize: bold ? 13 : 11, fontWeight: bold ? 700 : 400,
          color: accent || "#222",
        }}>
          {value}
        </span>
        {pct != null && (
          <span style={{
            fontFamily: "Inter, sans-serif",
            fontSize: 10, color: "#888", minWidth: 44, textAlign: "right",
          }}>
            {fmtPct(pct)}
          </span>
        )}
      </div>
    </div>
  );
}

/* ── LIHTC defaults (same as Debt.jsx) ───────────────────────────── */
const LIHTC_DEFAULTS = {
  credit_type: "4pct", applicable_pct: 0.04, basis_boost: true, boost_factor: 1.30,
  applicable_fraction: 1.0, credit_period: 10, investor_price: 0.82,
  non_basis_costs: 6527411, commercial_costs: 0, federal_grants: 0, historic_reduction: 0,
  state_credit_applies: false, state_credit_annual: 0, state_credit_period: 10, state_credit_price: 0,
};

/* ── Default subdebt & other sources (same as Debt.jsx) ──────────── */
const DEFAULT_SUBDEBT = [
  { id: 400, label: "Deferred Developer Fee", priority: 1, loan_type: "deferred_fee", amount: 0, rate: 0, term_years: 12, payment_type: "accrual" },
  { id: 401, label: "Seller Note", priority: 2, loan_type: "seller", amount: 1000000, rate: 0, term_years: 15, payment_type: "accrual" },
  { id: 402, label: "CHIP", priority: 3, loan_type: "soft", amount: 900000, rate: 0.005, term_years: 15, payment_type: "accrual" },
  { id: 403, label: "Sponsor Note", priority: 4, loan_type: "sponsor", amount: 346031, rate: 0, term_years: 15, payment_type: "accrual" },
];
const DEFAULT_OTHER_SOURCES = [
  { id: 501, label: "GP Equity / Cash", amount: 0 },
  { id: 502, label: "HOME Funds", amount: 0 },
  { id: 503, label: "FHLB AHP", amount: 0 },
  { id: 504, label: "CDBG", amount: 0 },
  { id: 505, label: "Other Grant", amount: 0 },
];

/* ══════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ══════════════════════════════════════════════════════════════════ */

export default function SourcesUsesPanel() {
  const { moduleStates } = useLihtc();

  // ── Budget calcs ──
  const budget   = moduleStates.budget;
  const unitMix  = moduleStates.unit_mix;
  const totalUnits = (unitMix?.rows ?? []).reduce((s, r) => s + (r.count || 0), 0) || 175;
  const bc = computeBudgetCalcs(budget, totalUnits);

  // ── LIHTC equity ──
  const lihtcInputs = { ...LIHTC_DEFAULTS, ...moduleStates.lihtc };
  const debtConst = moduleStates.debt?.construction ?? {};
  const teBondAmt = bc.tdc * (debtConst.bond_test_target_pct || 0.35);
  const lihtc = computeLIHTC(lihtcInputs, bc, totalUnits, teBondAmt);

  // ── Debt module state ──
  const permanent    = moduleStates.debt?.permanent ?? {};
  const rawSubdebt   = moduleStates.debt?.subdebt ?? DEFAULT_SUBDEBT;
  const otherSources = moduleStates.debt?.other_sources ?? DEFAULT_OTHER_SOURCES;

  // Sync DDF into subdebt
  const subdebt = rawSubdebt.map(l =>
    l.loan_type === "deferred_fee"
      ? { ...l, amount: bc.deferredDevFee || l.amount }
      : l
  );

  // ── USES ──
  const uses = [
    { label: "Land & Acquisition", amount: bc.acqTotal },
    { label: "Hard Costs",         amount: bc.hcTotal },
    { label: "Soft Costs",         amount: bc.scTotal },
    { label: "Financing & Legal",  amount: bc.finTotal },
    { label: "Org Costs & Reserves", amount: bc.orgTotal },
    { label: "Developer Fee",      amount: bc.devFee },
  ];
  const totalUses = bc.tdc;

  // ── SOURCES ──
  const permLoan = permanent.loan_amount || 0;
  const fedEquity = lihtc.equityRaised || 0;
  const stateEquity = lihtc.stateEquity || 0;

  // Build individual source lines — show subdebt items individually (not grouped)
  const sourceLines = [];

  // Senior debt
  sourceLines.push({ label: permanent.lender || "Senior Debt", amount: permLoan, color: "#1a3a6b" });

  // LIHTC equity
  sourceLines.push({ label: "Tax Credit Equity", amount: fedEquity, color: "#1a6b3c" });
  if (stateEquity > 0)
    sourceLines.push({ label: "State Credit Equity", amount: stateEquity, color: "#2a8a50" });

  // Each subdebt item individually (show all named items, even if $0)
  subdebt.forEach(l => {
    sourceLines.push({ label: l.label, amount: l.amount || 0, color: l.loan_type === "deferred_fee" ? "#5a3a00" : "#8B2500" });
  });

  // Other sources / grants (only show if non-zero)
  otherSources.forEach(s => {
    if ((s.amount || 0) > 0)
      sourceLines.push({ label: s.label, amount: s.amount, color: "#555" });
  });

  const totalSources = sourceLines.reduce((s, l) => s + l.amount, 0);
  const gap = totalSources - totalUses;

  // ── Per-unit metrics ──
  const perUnit = totalUnits > 0 ? {
    tdcPerUnit:  totalUses / totalUnits,
    hcPerUnit:   bc.hcTotal / totalUnits,
    equityPerUnit: fedEquity / totalUnits,
    debtPerUnit: permLoan / totalUnits,
  } : null;

  // ── Bond test ──
  const bondTestPct = lihtc.bondPct;
  const bondTestPass = lihtc.bondTestPass;

  const cardStyle = {
    background: "white", border: "1px solid #e0e0e0", borderRadius: 6,
    overflow: "hidden",
  };

  return (
    <div style={{ fontFamily: "Inter, sans-serif" }}>

      {/* ── HEADER ── */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 20, fontWeight: 400, color: "#111", margin: 0 }}>
            Sources & Uses
          </h2>
          <span style={{ fontSize: 9, color: "#aaa", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            MODULE 5 · PERMANENT CAPITAL STRUCTURE
          </span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {/* Bond test badge */}
          <div style={{
            padding: "4px 10px", borderRadius: 4, fontSize: 9, fontWeight: 700,
            background: bondTestPass ? "#f0f9f4" : "#fce8e3",
            color: bondTestPass ? "#1a6b3c" : "#8B2500",
            border: `1px solid ${bondTestPass ? "#b8dfc8" : "#f5c2b0"}`,
          }}>
            Bond Test: {fmtPct(bondTestPct)} {bondTestPass ? "✓" : "✗"}
          </div>
        </div>
      </div>

      {/* ── MAIN GRID: Uses + Sources side by side ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 }}>

        {/* ─── USES PANEL ─── */}
        <div style={cardStyle}>
          <div style={{
            padding: "12px 14px 8px", borderBottom: "2px solid #333",
            display: "flex", justifyContent: "space-between", alignItems: "baseline",
          }}>
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#888" }}>
              Uses
            </span>
            <span style={{ fontSize: 9, color: "#aaa" }}>{totalUnits} Units</span>
          </div>
          {uses.map(u => (
            <SectionRow key={u.label} label={u.label} value={fmt$(u.amount)} />
          ))}
          <SectionRow label="Total Costs" value={fmt$(totalUses)} bold border accent="#111" />
        </div>

        {/* ─── SOURCES PANEL ─── */}
        <div style={cardStyle}>
          <div style={{
            padding: "12px 14px 8px", borderBottom: "2px solid #333",
            display: "flex", justifyContent: "space-between", alignItems: "baseline",
          }}>
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#888" }}>
              Sources
            </span>
            <span style={{ fontSize: 9, color: "#aaa" }}>% of TDC</span>
          </div>
          {sourceLines.map(s => (
            <div key={s.label} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "5px 14px", borderBottom: "1px solid #f0f0f0",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 3, height: 14, background: s.color, borderRadius: 1, flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: "#222" }}>{s.label}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <span style={{ fontFamily: "Inter, sans-serif", fontSize: 11, color: "#222" }}>
                  {fmt$(s.amount)}
                </span>
                <span style={{ fontFamily: "Inter, sans-serif", fontSize: 10, color: "#888", minWidth: 44, textAlign: "right" }}>
                  {totalUses > 0 ? fmtPct(s.amount / totalUses) : "—"}
                </span>
              </div>
            </div>
          ))}
          <SectionRow label="Total Sources" value={fmt$(totalSources)} bold border accent="#111"
            pct={totalUses > 0 ? totalSources / totalUses : 0} />
        </div>
      </div>

      {/* ── GAP / SURPLUS ── */}
      <div style={{
        ...cardStyle,
        background: Math.abs(gap) < 1000 ? "#f0f9f4" : gap > 0 ? "#f0f9f4" : "#fce8e3",
        border: `1px solid ${Math.abs(gap) < 1000 ? "#b8dfc8" : gap > 0 ? "#b8dfc8" : "#f5c2b0"}`,
        padding: "12px 14px",
        display: "flex", justifyContent: "space-between", alignItems: "center",
        marginBottom: 20,
      }}>
        <span style={{
          fontSize: 12, fontWeight: 700, fontStyle: "italic",
          color: Math.abs(gap) < 1000 ? "#1a6b3c" : gap > 0 ? "#1a6b3c" : "#8B2500",
        }}>
          Total {gap >= 0 ? "Surplus" : "Gap"}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{
            fontFamily: "Inter, sans-serif", fontSize: 13, fontWeight: 700,
            color: Math.abs(gap) < 1000 ? "#1a6b3c" : gap > 0 ? "#1a6b3c" : "#8B2500",
          }}>
            {gap < 0 ? `(${fmt$(gap)})` : fmt$(gap)}
          </span>
          <span style={{
            fontFamily: "Inter, sans-serif", fontSize: 10,
            color: Math.abs(gap) < 1000 ? "#1a6b3c" : "#888",
          }}>
            {totalUses > 0 ? fmtPct(Math.abs(gap) / totalUses) : "0.0%"}
          </span>
        </div>
      </div>

      {/* ── METRICS ROW ── */}
      {perUnit && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {[
            { label: "TDC / Unit",    value: fmt$(perUnit.tdcPerUnit) },
            { label: "HC / Unit",     value: fmt$(perUnit.hcPerUnit) },
            { label: "Equity / Unit", value: fmt$(perUnit.equityPerUnit) },
            { label: "Sr. Debt / Unit", value: fmt$(perUnit.debtPerUnit) },
            { label: "Investor Price", value: `$${(lihtcInputs.investor_price || 0).toFixed(2)}` },
            { label: "Annual Credit",  value: fmt$(lihtc.annualCredit) },
          ].map(m => (
            <div key={m.label} style={{
              background: "white", border: "1px solid #e0e0e0", borderRadius: 5,
              padding: "8px 14px", minWidth: 120, flex: "1 1 120px",
            }}>
              <div style={{ fontSize: 8, color: "#888", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>
                {m.label}
              </div>
              <div style={{ fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: 13, color: "#111" }}>
                {m.value}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
