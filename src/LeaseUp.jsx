/**
 * LeaseUp.jsx — Lease-Up Analysis Module
 *
 * Models velocity-based lease-up income during initial occupancy.
 * Monthly waterfall: pre-leasing (no revenue) then post-C/O ramp
 * at a configurable units/month velocity until stabilized.
 *
 * Reads from: unit_mix (total units, annual revenue), proforma (opex)
 * Writes to:  lease_up context
 */
import { useMemo } from "react";
import { useLihtc } from "./context/LihtcContext.jsx";

/* ── formatters ───────────────────────────────────────────────── */
const fmt$ = v => v == null ? "\u2014" : "$" + Math.round(v).toLocaleString();
const fmtPct = v => v == null ? "\u2014" : (v * 100).toFixed(1) + "%";

/* ── defaults ─────────────────────────────────────────────────── */
const DEFAULT_LEASE_UP = {
  pre_lease_months: 3,
  on_site_goal_months: 7,
  velocity: 25,           // units per month after C/O
  rent_override: null,     // monthly stabilized rent (null = auto from unit mix)
  opex_override: null,     // monthly stabilized opex (null = auto from proforma)
  opex_ramp: true,         // true = opex ramps with occupancy; false = fixed from month 1
};

/* ── compute monthly lease-up schedule ────────────────────────── */
function computeLeaseUp(inputs, totalUnits, monthlyRentStab, monthlyOpexStab) {
  const {
    pre_lease_months = 3,
    on_site_goal_months = 7,
    velocity = 25,
    opex_ramp = true,
  } = inputs;

  const months = [];
  let cumulativeUnits = 0;
  let cumulativeNOI = 0;

  const totalMonths = pre_lease_months + on_site_goal_months;

  for (let i = 0; i < totalMonths; i++) {
    const isPreLease = i < pre_lease_months;
    const leaseMonth = i - pre_lease_months + 1; // negative for pre-lease
    const monthLabel = isPreLease ? -(pre_lease_months - i) : leaseMonth;

    // Units leased this month
    let unitsThisMonth = 0;
    if (!isPreLease) {
      unitsThisMonth = Math.min(velocity, totalUnits - cumulativeUnits);
      cumulativeUnits += unitsThisMonth;
    }

    const occupancy = totalUnits > 0 ? cumulativeUnits / totalUnits : 0;

    // Revenue proportional to occupancy
    const revenue = monthlyRentStab * occupancy;

    // OpEx: ramp with occupancy or fixed from month 1 post-C/O
    let opex = 0;
    if (!isPreLease) {
      opex = opex_ramp ? monthlyOpexStab * occupancy : monthlyOpexStab;
    }

    const noi = revenue - opex;
    cumulativeNOI += noi;

    months.push({
      idx: i,
      monthLabel,
      isPreLease,
      unitsThisMonth,
      cumulativeUnits,
      occupancy,
      revenue,
      opex,
      noi,
      cumulativeNOI,
    });
  }

  return { months, cumulativeNOI, totalMonths };
}

/* ── tiny inline input ────────────────────────────────────────── */
function TinyInput({ value, onChange, prefix, suffix, width, step, placeholder, disabled }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
      {prefix && <span style={{ fontSize: 10, color: "#888" }}>{prefix}</span>}
      <input
        type="number"
        value={value ?? ""}
        step={step || 1}
        placeholder={placeholder}
        disabled={disabled}
        onChange={e => {
          const v = e.target.value === "" ? null : Number(e.target.value);
          onChange(v);
        }}
        style={{
          width: width || 80, padding: "3px 6px", border: "1px solid #ddd",
          borderRadius: 3, fontSize: 11, outline: "none", textAlign: "right",
          fontFamily: "Inter, sans-serif",
          background: disabled ? "#f5f5f5" : "white",
          color: disabled ? "#aaa" : "#111",
        }}
      />
      {suffix && <span style={{ fontSize: 10, color: "#888" }}>{suffix}</span>}
    </div>
  );
}

/* ── summary card ─────────────────────────────────────────────── */
function SummaryCard({ label, value, sub, accent }) {
  const colors = {
    green: { bg: "#f0f9f4", border: "#b8dfc8", text: "#1a6b3c" },
    navy:  { bg: "#f0f3f9", border: "#b8c8e0", text: "#1a3a6b" },
    brown: { bg: "#fdf8f0", border: "#e8d9b8", text: "#5a3a00" },
    gray:  { bg: "#f8f8f8", border: "#e0e0e0", text: "#444" },
    red:   { bg: "#fce8e3", border: "#f5c2b0", text: "#8B2500" },
  };
  const c = colors[accent] || colors.gray;
  return (
    <div style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 5, padding: "11px 14px", minWidth: 130, flex: "1 1 130px" }}>
      <div style={{ fontSize: 8, textTransform: "uppercase", letterSpacing: "0.1em", color: c.text, fontWeight: 700, marginBottom: 5 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "'Playfair Display', serif", color: "#111", marginBottom: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 9, color: "#aaa" }}>{sub}</div>}
    </div>
  );
}

/* ── occupancy ramp bar chart ─────────────────────────────────── */
function OccupancyChart({ months }) {
  const maxH = 48;
  const barW = Math.max(16, Math.min(32, 500 / months.length));

  return (
    <div style={{ background: "white", border: "1px solid #e0e0e0", borderRadius: 6, padding: "14px 18px", marginBottom: 16 }}>
      <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#888", marginBottom: 10 }}>
        Occupancy Ramp-Up
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: maxH + 18 }}>
        {months.map(m => {
          const h = Math.max(1, m.occupancy * maxH);
          const isPre = m.isPreLease;
          return (
            <div key={m.idx} style={{ display: "flex", flexDirection: "column", alignItems: "center", width: barW }}>
              <div style={{ fontSize: 7, color: "#888", marginBottom: 2 }}>
                {m.occupancy > 0 ? Math.round(m.occupancy * 100) + "%" : ""}
              </div>
              <div
                style={{
                  width: barW - 4,
                  height: h,
                  background: isPre ? "#e0e0e0" : m.occupancy >= 1 ? "#1a6b3c" : "#1a3a6b",
                  borderRadius: "2px 2px 0 0",
                  transition: "height 0.2s",
                }}
                title={`Month ${m.monthLabel}: ${fmtPct(m.occupancy)} occupied`}
              />
              <div style={{ fontSize: 7, color: isPre ? "#bbb" : "#666", marginTop: 2, fontWeight: m.monthLabel === 1 ? 700 : 400 }}>
                {m.monthLabel > 0 ? m.monthLabel : m.monthLabel}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 14, marginTop: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 8, color: "#888" }}>
          <div style={{ width: 8, height: 8, background: "#e0e0e0", borderRadius: 1 }} />
          Pre-leasing
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 8, color: "#888" }}>
          <div style={{ width: 8, height: 8, background: "#1a3a6b", borderRadius: 1 }} />
          Leasing
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 8, color: "#888" }}>
          <div style={{ width: 8, height: 8, background: "#1a6b3c", borderRadius: 1 }} />
          Stabilized
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ══════════════════════════════════════════════════════════════════ */

export default function LeaseUpPanel() {
  const { moduleStates, updateModule } = useLihtc();

  // ── Read lease-up state ──
  const lu = moduleStates.lease_up || DEFAULT_LEASE_UP;
  const update = patch => updateModule("lease_up", patch);

  // ── Pull from other modules ──
  const unitMix = moduleStates.unit_mix;
  const rows = unitMix?.rows ?? [];
  const totalUnits = rows.reduce((s, r) => s + (r.count || 0), 0) || 175;
  const annualRevenue = unitMix?.computed_annual_revenue || 0;

  const proforma = moduleStates.proforma || {};
  const opexLines = proforma.opex_lines || [];
  const customOpex = proforma.custom_opex || [];
  const allOpex = [...opexLines, ...customOpex];
  // Compute Year 1 total opex from proforma lines (matching proforma logic)
  const yr1EGI = annualRevenue * (1 - (proforma.vacancy_rate || 0.06));
  const yr1OpexFromLines = allOpex.reduce((s, line) => {
    if (line.is_pct_egi) return s + yr1EGI * (line.pct || 0);
    return s + (line.amount || 0);
  }, 0);
  const repReserve = totalUnits * (proforma.replacement_reserve_per_unit || 350);
  const annualOpex = yr1OpexFromLines + repReserve;

  // Effective monthly values (override-able)
  const monthlyRentStab = lu.rent_override != null ? lu.rent_override : Math.round(annualRevenue / 12);
  const monthlyOpexStab = lu.opex_override != null ? lu.opex_override : Math.round(annualOpex / 12);

  // ── Compute schedule ──
  const result = useMemo(
    () => computeLeaseUp(lu, totalUnits, monthlyRentStab, monthlyOpexStab),
    [lu, totalUnits, monthlyRentStab, monthlyOpexStab]
  );

  const { months, cumulativeNOI } = result;

  // ── NOI scaling outputs ──
  const noi100 = cumulativeNOI;
  const noi75 = cumulativeNOI * 0.75;
  const noi50 = cumulativeNOI * 0.50;
  const noi25 = cumulativeNOI * 0.25;

  // ── Styles ──
  const cardStyle = { background: "white", border: "1px solid #e0e0e0", borderRadius: 6, overflow: "hidden" };
  const hdrCell = {
    padding: "6px 8px", textAlign: "right", fontSize: 8, fontWeight: 700,
    color: "#888", letterSpacing: "0.04em", whiteSpace: "nowrap",
    borderBottom: "2px solid #333", textTransform: "uppercase",
  };
  const numCell = {
    padding: "4px 8px", textAlign: "right", fontSize: 10,
    fontFamily: "Inter, sans-serif", color: "#333", whiteSpace: "nowrap",
  };

  return (
    <div style={{ fontFamily: "Inter, sans-serif" }}>

      {/* ── HEADER ── */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 20, fontWeight: 400, color: "#111", margin: 0 }}>
            Lease-Up Analysis
          </h2>
          <span style={{ fontSize: 9, color: "#aaa", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            VELOCITY-BASED INCOME RAMP
          </span>
        </div>
        <div style={{
          padding: "4px 10px", borderRadius: 4, fontSize: 9, fontWeight: 700,
          background: cumulativeNOI >= 0 ? "#f0f9f4" : "#fce8e3",
          color: cumulativeNOI >= 0 ? "#1a6b3c" : "#8B2500",
          border: `1px solid ${cumulativeNOI >= 0 ? "#b8dfc8" : "#f5c2b0"}`,
        }}>
          Lease-Up NOI: {fmt$(cumulativeNOI)}
        </div>
      </div>

      {/* ── SUMMARY CARDS ── */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <SummaryCard label="Total Units" value={totalUnits} sub={`${lu.velocity || 25} units/mo velocity`} accent="navy" />
        <SummaryCard label="Lease-Up Period" value={`${(lu.pre_lease_months || 3) + (lu.on_site_goal_months || 7)} mo`} sub={`${lu.pre_lease_months || 3} pre-lease + ${lu.on_site_goal_months || 7} on-site`} accent="brown" />
        <SummaryCard label="NOI (100%)" value={fmt$(noi100)} sub="Full lease-up NOI" accent="green" />
        <SummaryCard label="Output to Sources (25%)" value={fmt$(noi25)} sub="Conservative estimate" accent="navy" />
      </div>

      {/* ── INPUTS PANEL ── */}
      <div style={{ ...cardStyle, padding: "14px 18px", marginBottom: 16 }}>
        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#1a3a6b", marginBottom: 12 }}>
          Leasing Assumptions
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>

          {/* Column 1: Timing */}
          <div>
            <div style={{ fontSize: 8, color: "#888", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8, fontWeight: 700 }}>Timing</div>
            {[
              { label: "Pre-leasing Months", val: lu.pre_lease_months ?? 3, key: "pre_lease_months", step: 1 },
              { label: "On-Site Leasing Goal (months)", val: lu.on_site_goal_months ?? 7, key: "on_site_goal_months", step: 1 },
            ].map(f => (
              <div key={f.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ fontSize: 10, color: "#444" }}>{f.label}</span>
                <TinyInput value={f.val} onChange={v => update({ [f.key]: v })} width={60} step={f.step} />
              </div>
            ))}
          </div>

          {/* Column 2: Velocity */}
          <div>
            <div style={{ fontSize: 8, color: "#888", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8, fontWeight: 700 }}>Velocity</div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span style={{ fontSize: 10, color: "#444" }}>Units / Month</span>
              <TinyInput value={lu.velocity ?? 25} onChange={v => update({ velocity: v })} width={60} step={1} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span style={{ fontSize: 10, color: "#444" }}>Total Units</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#1a3a6b" }}>{totalUnits}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span style={{ fontSize: 10, color: "#444" }}>OpEx Ramps w/ Occupancy</span>
              <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={lu.opex_ramp !== false}
                  onChange={e => update({ opex_ramp: e.target.checked })}
                  style={{ accentColor: "#1a3a6b" }}
                />
                <span style={{ fontSize: 9, color: "#888" }}>{lu.opex_ramp !== false ? "Yes" : "No"}</span>
              </label>
            </div>
          </div>

          {/* Column 3: Stabilized values */}
          <div>
            <div style={{ fontSize: 8, color: "#888", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8, fontWeight: 700 }}>Stabilized Monthly</div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div>
                <span style={{ fontSize: 10, color: "#444" }}>Monthly Rent</span>
                {lu.rent_override == null && <span style={{ fontSize: 8, color: "#1a6b3c", marginLeft: 4 }}>auto</span>}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                <TinyInput
                  value={lu.rent_override ?? Math.round(annualRevenue / 12)}
                  onChange={v => update({ rent_override: v })}
                  prefix="$"
                  width={90}
                  step={1000}
                />
                {lu.rent_override != null && (
                  <button
                    onClick={() => update({ rent_override: null })}
                    title="Reset to auto (from Unit Mix)"
                    style={{ background: "none", border: "none", cursor: "pointer", color: "#bbb", fontSize: 11, padding: "1px 3px" }}
                    onMouseEnter={e => e.target.style.color = "#8B2500"}
                    onMouseLeave={e => e.target.style.color = "#bbb"}
                  >&#8634;</button>
                )}
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div>
                <span style={{ fontSize: 10, color: "#444" }}>Monthly OpEx</span>
                {lu.opex_override == null && <span style={{ fontSize: 8, color: "#1a6b3c", marginLeft: 4 }}>auto</span>}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                <TinyInput
                  value={lu.opex_override ?? Math.round(annualOpex / 12)}
                  onChange={v => update({ opex_override: v })}
                  prefix="$"
                  width={90}
                  step={1000}
                />
                {lu.opex_override != null && (
                  <button
                    onClick={() => update({ opex_override: null })}
                    title="Reset to auto (from Proforma)"
                    style={{ background: "none", border: "none", cursor: "pointer", color: "#bbb", fontSize: 11, padding: "1px 3px" }}
                    onMouseEnter={e => e.target.style.color = "#8B2500"}
                    onMouseLeave={e => e.target.style.color = "#bbb"}
                  >&#8634;</button>
                )}
              </div>
            </div>
            <div style={{ fontSize: 8, color: "#aaa", marginTop: 4 }}>
              Auto values from Unit Mix / Proforma
            </div>
          </div>
        </div>
      </div>

      {/* ── OCCUPANCY CHART ── */}
      <OccupancyChart months={months} />

      {/* ── MONTH-BY-MONTH TABLE ── */}
      <div style={{ ...cardStyle, padding: 0, marginBottom: 16 }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", fontSize: 10, width: "100%", minWidth: 700 }}>
            <thead>
              <tr style={{ background: "#fafafa" }}>
                <th style={{ ...hdrCell, textAlign: "center", minWidth: 60 }}>Month</th>
                <th style={{ ...hdrCell, minWidth: 90 }}>Units Leased</th>
                <th style={{ ...hdrCell, minWidth: 90 }}>Cumulative</th>
                <th style={{ ...hdrCell, minWidth: 80 }}>% Occ</th>
                <th style={{ ...hdrCell, minWidth: 100 }}>Revenue</th>
                <th style={{ ...hdrCell, minWidth: 100 }}>OpEx</th>
                <th style={{ ...hdrCell, minWidth: 100 }}>NOI</th>
                <th style={{ ...hdrCell, minWidth: 110 }}>Cum. NOI</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m, idx) => {
                const isStab = m.occupancy >= 1;
                const rowBg = m.isPreLease
                  ? "#fafafa"
                  : idx % 2 === 0 ? "white" : "#fdfcfb";

                return (
                  <tr key={m.idx} style={{ borderBottom: "1px solid #f0f0f0", background: rowBg }}>
                    {/* Month label */}
                    <td style={{
                      ...numCell, textAlign: "center", fontWeight: 700,
                      color: m.isPreLease ? "#bbb" : m.monthLabel === 1 ? "#1a3a6b" : "#333",
                    }}>
                      {m.isPreLease ? `Pre ${m.monthLabel}` : m.monthLabel}
                    </td>
                    {/* Units leased this month */}
                    <td style={{ ...numCell, color: m.unitsThisMonth > 0 ? "#1a3a6b" : "#ccc", fontWeight: m.unitsThisMonth > 0 ? 600 : 400 }}>
                      {m.unitsThisMonth > 0 ? m.unitsThisMonth : "\u2014"}
                    </td>
                    {/* Cumulative units */}
                    <td style={{ ...numCell, fontWeight: 600 }}>
                      {m.cumulativeUnits}
                    </td>
                    {/* Occupancy % */}
                    <td style={{ ...numCell }}>
                      {m.occupancy > 0 ? (
                        <span style={{
                          fontSize: 10, fontWeight: isStab ? 700 : 500,
                          color: isStab ? "#1a6b3c" : "#1a3a6b",
                          background: isStab ? "#f0f9f4" : "transparent",
                          border: isStab ? "1px solid #b8dfc8" : "none",
                          borderRadius: 3, padding: isStab ? "1px 5px" : 0,
                        }}>
                          {fmtPct(m.occupancy)}
                        </span>
                      ) : (
                        <span style={{ color: "#ccc" }}>{fmtPct(0)}</span>
                      )}
                    </td>
                    {/* Revenue */}
                    <td style={{ ...numCell, color: m.revenue > 0 ? "#1a6b3c" : "#ccc" }}>
                      {m.revenue > 0 ? fmt$(m.revenue) : "\u2014"}
                    </td>
                    {/* OpEx */}
                    <td style={{ ...numCell, color: m.opex > 0 ? "#8B2500" : "#ccc" }}>
                      {m.opex > 0 ? `(${fmt$(m.opex)})` : "\u2014"}
                    </td>
                    {/* NOI */}
                    <td style={{
                      ...numCell, fontWeight: 600,
                      color: m.noi > 0 ? "#1a6b3c" : m.noi < 0 ? "#8B2500" : "#ccc",
                    }}>
                      {m.noi !== 0 ? (m.noi < 0 ? `(${fmt$(Math.abs(m.noi))})` : fmt$(m.noi)) : "\u2014"}
                    </td>
                    {/* Cumulative NOI */}
                    <td style={{
                      ...numCell, fontWeight: 700,
                      color: m.cumulativeNOI >= 0 ? "#1a3a6b" : "#8B2500",
                    }}>
                      {m.cumulativeNOI < 0 ? `(${fmt$(Math.abs(m.cumulativeNOI))})` : fmt$(m.cumulativeNOI)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: "2px solid #333", background: "#fafafa" }}>
                <td style={{ padding: "8px 8px", textAlign: "center", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#888" }}>
                  Total
                </td>
                <td style={{ ...numCell, fontWeight: 700 }}>
                  {months.reduce((s, m) => s + m.unitsThisMonth, 0)}
                </td>
                <td style={{ ...numCell, fontWeight: 700 }}>
                  {totalUnits}
                </td>
                <td style={{ ...numCell, fontWeight: 700, color: "#1a6b3c" }}>
                  {fmtPct(months.length > 0 ? months[months.length - 1].occupancy : 0)}
                </td>
                <td style={{ ...numCell, fontWeight: 700, color: "#1a6b3c" }}>
                  {fmt$(months.reduce((s, m) => s + m.revenue, 0))}
                </td>
                <td style={{ ...numCell, fontWeight: 700, color: "#8B2500" }}>
                  ({fmt$(months.reduce((s, m) => s + m.opex, 0))})
                </td>
                <td colSpan={1} style={{ ...numCell, fontWeight: 700, color: cumulativeNOI >= 0 ? "#1a6b3c" : "#8B2500" }}>
                  {cumulativeNOI < 0 ? `(${fmt$(Math.abs(cumulativeNOI))})` : fmt$(cumulativeNOI)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* ── NOI SCALING SUMMARY ── */}
      <div style={{ ...cardStyle, padding: "14px 18px", marginBottom: 16 }}>
        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#1a3a6b", marginBottom: 12 }}>
          Lease-Up NOI Summary
        </div>
        <div style={{ fontSize: 8, color: "#aaa", marginBottom: 10 }}>
          Scaled NOI for Sources & Uses sensitivity. The 25% figure is the conservative output typically used.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
          {[
            { label: "100%", value: noi100, accent: "#1a6b3c", bg: "#f0f9f4", border: "#b8dfc8" },
            { label: "75%", value: noi75, accent: "#1a3a6b", bg: "#f0f3f9", border: "#b8c8e0" },
            { label: "50%", value: noi50, accent: "#5a3a00", bg: "#fdf8f0", border: "#e8d9b8" },
            { label: "25%", value: noi25, accent: "#8B2500", bg: "#fce8e3", border: "#f5c2b0" },
          ].map(tier => (
            <div key={tier.label} style={{
              background: tier.bg, border: `1px solid ${tier.border}`,
              borderRadius: 5, padding: "10px 14px", textAlign: "center",
            }}>
              <div style={{ fontSize: 8, fontWeight: 700, color: tier.accent, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
                NOI at {tier.label}
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, fontFamily: "'Playfair Display', serif", color: "#111" }}>
                {fmt$(tier.value)}
              </div>
              {tier.label === "25%" && (
                <div style={{ fontSize: 8, color: tier.accent, marginTop: 3, fontWeight: 600 }}>
                  Output to Sources
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── BOTTOM SUMMARY BAR ── */}
      <div style={{
        padding: "12px 16px", background: "#f0f3f9", border: "1px solid #b8c8e0",
        borderRadius: 5, display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <div>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#1a3a6b", marginBottom: 3 }}>
            Lease-Up NOI (25% Conservative)
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "'Playfair Display', serif", color: "#111" }}>
            {fmt$(noi25)}
          </div>
          <div style={{ fontSize: 9, color: "#888", marginTop: 2 }}>
            {totalUnits} units at {lu.velocity || 25}/mo over {(lu.pre_lease_months || 3) + (lu.on_site_goal_months || 7)} months
            ({lu.pre_lease_months || 3} pre-lease + {lu.on_site_goal_months || 7} on-site)
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 9, color: "#888", marginBottom: 2 }}>Stabilized Monthly</div>
          <div style={{ fontSize: 11, color: "#1a6b3c" }}>Rent: {fmt$(monthlyRentStab)}</div>
          <div style={{ fontSize: 11, color: "#8B2500" }}>OpEx: {fmt$(monthlyOpexStab)}</div>
        </div>
      </div>
    </div>
  );
}
