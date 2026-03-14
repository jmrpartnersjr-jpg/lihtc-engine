import { useState, useEffect, useCallback } from "react";
import { upsertFinancialAssumptions, updateEquityTranche, updateDevFeeScheduleRow } from "./db.js";

const fmt$ = v => v == null ? "—" : "$" + Math.round(v).toLocaleString();
const fmtM = v => v == null ? "—" : "$" + (v / 1e6).toFixed(3) + "M";
const fmtPct = v => v == null ? "—" : (v * 100).toFixed(2) + "%";

const MILESTONE_OPTIONS = [
  "Vertical Closing", "CofO", "PIS", "Pre-Stabilization", "Conversion/Stabilization", "8609", "Custom"
];

// ── Inline editable number cell ───────────────────────────────────────────────
function EditPct({ value, onChange }) {
  const [editing, setEditing] = useState(false);
  const [raw, setRaw] = useState("");
  const start = () => { setRaw((value * 100).toFixed(1)); setEditing(true); };
  const commit = () => { setEditing(false); const v = parseFloat(raw); if (!isNaN(v)) onChange(v / 100); };
  return editing ? (
    <input autoFocus type="number" value={raw} onChange={e => setRaw(e.target.value)} onBlur={commit}
      onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
      style={{ width: 70, padding: "3px 6px", border: "1px solid #1a6b3c", borderRadius: 3, fontSize: 11, fontFamily: "'DM Mono',monospace", textAlign: "right", outline: "none" }} />
  ) : (
    <span onClick={start} style={{ cursor: "pointer", fontFamily: "'DM Mono',monospace", fontSize: 11, padding: "2px 4px", borderRadius: 2, border: "1px solid transparent" }}
      onMouseEnter={e => e.target.style.border = "1px solid #e0e0e0"}
      onMouseLeave={e => e.target.style.border = "1px solid transparent"}>
      {(value * 100).toFixed(1)}%
    </span>
  );
}

function EditDate({ value, onChange }) {
  const [editing, setEditing] = useState(false);
  return editing ? (
    <input autoFocus type="date" value={value || ""} onChange={e => { onChange(e.target.value); setEditing(false); }}
      onBlur={() => setEditing(false)}
      style={{ padding: "3px 6px", border: "1px solid #1a6b3c", borderRadius: 3, fontSize: 11, outline: "none" }} />
  ) : (
    <span onClick={() => setEditing(true)} style={{ cursor: "pointer", fontSize: 10, color: value ? "#333" : "#ccc", padding: "2px 4px", borderRadius: 2, border: "1px solid transparent" }}
      onMouseEnter={e => e.target.style.border = "1px solid #e0e0e0"}
      onMouseLeave={e => e.target.style.border = "1px solid transparent"}>
      {value || "mm/dd/yyyy"}
    </span>
  );
}

// ── Pay-In Schedule Table ─────────────────────────────────────────────────────
function PayInTable({ rows, totalAmt, onChangePct, onChangeDate, onChangeField, label }) {
  const sumPct = rows.reduce((s, r) => s + (r.pct_of_total ?? r.pct_of_cash_fee ?? 0), 0);
  const pctOk = Math.abs(sumPct - 1.0) < 0.001;

  return (
    <div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #111" }}>
              <th style={{ ...th, width: 30 }}>#</th>
              <th style={{ ...th }}>Milestone</th>
              <th style={{ ...th, textAlign: "right" }}>% of {label}</th>
              <th style={{ ...th, textAlign: "right" }}>Total $</th>
              <th style={{ ...th, textAlign: "right" }}>Residential $</th>
              <th style={{ ...th }}>Target Date</th>
              <th style={{ ...th }}>No Sooner Than</th>
              <th style={{ ...th, textAlign: "right" }}>Month #</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const pct = row.pct_of_total ?? row.pct_of_cash_fee ?? 0;
              const amt = totalAmt * pct;
              const res = amt * (row.residential_pct ?? 1.0);
              return (
                <tr key={row.id || i} style={{ borderBottom: "1px solid #f5f5f5", background: i % 2 === 0 ? "white" : "#fafafa" }}>
                  <td style={{ ...td, color: "#aaa", textAlign: "center" }}>{i + 1}</td>
                  <td style={{ ...td }}>
                    <select value={row.label || ""}
                      onChange={e => onChangeField(row, "label", e.target.value)}
                      style={{ fontSize: 11, border: "1px solid #e0e0e0", borderRadius: 3, padding: "3px 6px", fontFamily: "'DM Mono',monospace", background: "white" }}>
                      {MILESTONE_OPTIONS.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </td>
                  <td style={{ ...td, textAlign: "right" }}>
                    <EditPct value={pct} onChange={v => onChangePct(row, v)} />
                  </td>
                  <td style={{ ...td, textAlign: "right", fontFamily: "'DM Mono',monospace" }}>{fmt$(amt)}</td>
                  <td style={{ ...td, textAlign: "right", fontFamily: "'DM Mono',monospace", color: "#888" }}>{fmt$(res)}</td>
                  <td style={{ ...td }}>
                    <EditDate value={row.target_date} onChange={v => onChangeField(row, "target_date", v)} />
                  </td>
                  <td style={{ ...td }}>
                    <EditDate value={row.no_sooner_than} onChange={v => onChangeField(row, "no_sooner_than", v)} />
                  </td>
                  <td style={{ ...td, textAlign: "right" }}>
                    <input type="number" value={row.month_number ?? 0}
                      onChange={e => onChangeField(row, "month_number", Number(e.target.value))}
                      style={{ width: 50, padding: "3px 6px", border: "1px solid #e0e0e0", borderRadius: 3, fontSize: 11, fontFamily: "'DM Mono',monospace", textAlign: "right" }} />
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: "2px solid #111", background: "#f8f8f8" }}>
              <td colSpan={2} style={{ ...td, fontWeight: 700 }}>TOTAL</td>
              <td style={{ ...td, textAlign: "right", fontFamily: "'DM Mono',monospace", fontWeight: 700, color: pctOk ? "#1a6b3c" : "#8B2500" }}>
                {(sumPct * 100).toFixed(1)}%{!pctOk && " ⚠"}
              </td>
              <td style={{ ...td, textAlign: "right", fontFamily: "'DM Mono',monospace", fontWeight: 700 }}>{fmt$(totalAmt)}</td>
              <td colSpan={4} />
            </tr>
          </tfoot>
        </table>
      </div>
      {!pctOk && (
        <div style={{ marginTop: 6, padding: "6px 10px", background: "#fff5f3", border: "1px solid #f5c2b0", borderRadius: 4, fontSize: 10, color: "#8B2500" }}>
          Installment percentages sum to {(sumPct * 100).toFixed(1)}% — must equal 100%.
        </div>
      )}
    </div>
  );
}

const th = { padding: "5px 10px", textAlign: "left", fontSize: 8, color: "#888", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, whiteSpace: "nowrap" };
const td = { padding: "6px 10px" };

// ── MAIN ─────────────────────────────────────────────────────────────────────
export default function TaxCreditPanel({ baseFA, projectId, scenarioId, budgetWithCalc, tranches, devFeeRows, onFAChange }) {
  // Credit parameters (persisted)
  const [creditType,  setCreditType]  = useState(baseFA?.credit_type  ?? "9pct");
  const [basisBoost,  setBasisBoost]  = useState(baseFA?.basis_boost  ?? false);
  const [appFrac,     setAppFrac]     = useState(baseFA?.applicable_fraction ?? 1.0);
  const [creditPrice, setCreditPrice] = useState(baseFA?.credit_price ?? 0.82);
  const [saving, setSaving] = useState(false);

  // Tranche rows local state
  const [localTranches, setLocalTranches] = useState(tranches || []);
  const [localFeeRows,  setLocalFeeRows]  = useState(devFeeRows || []);

  useEffect(() => {
    if (baseFA) {
      setCreditType(baseFA.credit_type ?? "9pct");
      setBasisBoost(baseFA.basis_boost ?? false);
      setAppFrac(baseFA.applicable_fraction ?? 1.0);
      setCreditPrice(baseFA.credit_price ?? 0.82);
    }
  }, [baseFA]);

  useEffect(() => { setLocalTranches(tranches || []); }, [tranches]);
  useEffect(() => { setLocalFeeRows(devFeeRows || []); }, [devFeeRows]);

  // ── Derived values ─────────────────────────────────────────────────────────
  // budgetWithCalc is a flat array of items from the calc engine
  const budgetItems = Array.isArray(budgetWithCalc) ? budgetWithCalc : (budgetWithCalc?.items || []);
  const tdc = budgetItems.length > 0
    ? budgetItems.reduce((s,i)=>s+(i.amount||0),0)
    : (budgetWithCalc?.totalCost ?? baseFA?.total_dev_cost ?? 67087503);
  const eligibleBasis = budgetItems.length > 0
    ? budgetItems.filter(i=>i.basis_eligible).reduce((s,i)=>s+(i.amount||0),0)
    : (tdc * 0.80);
  const qualifiedBasis   = eligibleBasis * appFrac;
  const boostFactor      = basisBoost ? 1.30 : 1.0;
  const creditPct        = creditType === "9pct" ? 0.09 : 0.04;
  const annualCredit     = qualifiedBasis * boostFactor * creditPct;
  const totalCredit      = annualCredit * 10;
  const lpEquity         = annualCredit * 10 * creditPrice;

  // Dev cost breakdown by category
  const byCat = {};
  budgetItems.forEach(r => { byCat[r.category] = (byCat[r.category] || 0) + (r.amount || 0); });

  // Save credit parameters
  const saveParams = useCallback(async () => {
    if (!projectId) return;
    setSaving(true);
    try {
      const updated = await upsertFinancialAssumptions(projectId, {
        credit_type: creditType,
        basis_boost: basisBoost,
        applicable_fraction: appFrac,
        credit_price: creditPrice,
      });
      onFAChange && onFAChange(updated);
    } catch (e) { console.error(e); }
    setSaving(false);
  }, [projectId, creditType, basisBoost, appFrac, creditPrice]);

  // Update tranche
  const handleTranchePct = useCallback(async (row, newPct) => {
    const pctField = "pct_of_total";
    setLocalTranches(prev => prev.map(r => r.id === row.id ? { ...r, [pctField]: newPct } : r));
    if (row.id) await updateEquityTranche(row.id, { [pctField]: newPct });
  }, []);

  const handleTrancheField = useCallback(async (row, field, val) => {
    setLocalTranches(prev => prev.map(r => r.id === row.id ? { ...r, [field]: val } : r));
    if (row.id) await updateEquityTranche(row.id, { [field]: val });
  }, []);

  // Update dev fee
  const handleFeePct = useCallback(async (row, newPct) => {
    setLocalFeeRows(prev => prev.map(r => r.id === row.id ? { ...r, pct_of_cash_fee: newPct } : r));
    if (row.id) await updateDevFeeScheduleRow(row.id, { pct_of_cash_fee: newPct });
  }, []);

  const handleFeeField = useCallback(async (row, field, val) => {
    setLocalFeeRows(prev => prev.map(r => r.id === row.id ? { ...r, [field]: val } : r));
    if (row.id) await updateDevFeeScheduleRow(row.id, { [field]: val });
  }, []);

  const cashDevFee = budgetItems.find(i => i.calc_key === "dev_fee_cash")?.amount ?? 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* HEADER */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <h2 style={{ fontFamily: "'Playfair Display',serif", fontSize: 20, fontWeight: 400, color: "#111", margin: 0 }}>Tax Credit</h2>
          <span style={{ fontSize: 9, color: "#aaa", letterSpacing: "0.08em", textTransform: "uppercase" }}>9% LIHTC · EQUITY SCHEDULE · FEE SCHEDULE</span>
        </div>
        <button onClick={saveParams} disabled={saving}
          style={{ background: "#1a6b3c", color: "white", border: "none", padding: "7px 16px", borderRadius: 3, cursor: "pointer", fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", fontFamily: "'DM Mono',monospace", fontWeight: 700, opacity: saving ? 0.6 : 1 }}>
          {saving ? "Saving…" : "Save Params"}
        </button>
      </div>

      {/* ── SECTION 1: CREDIT PARAMETERS ──────────────────────────────────── */}
      <div style={{ background: "white", border: "1px solid #e0e0e0", borderRadius: 6, padding: "18px 20px" }}>
        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#888", marginBottom: 14 }}>Credit Parameters</div>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-end" }}>

          {/* Credit Type */}
          <div>
            <div style={{ fontSize: 9, color: "#888", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Credit Type</div>
            <div style={{ display: "flex", gap: 6 }}>
              {[{ key: "9pct", label: "9%" }, { key: "4pct", label: "4%" }].map(ct => (
                <button key={ct.key} onClick={() => setCreditType(ct.key)}
                  style={{ padding: "6px 16px", borderRadius: 3, border: `1px solid ${creditType === ct.key ? "#1a6b3c" : "#e0e0e0"}`,
                    background: creditType === ct.key ? "#f0faf4" : "white",
                    color: creditType === ct.key ? "#1a6b3c" : "#888",
                    fontWeight: creditType === ct.key ? 700 : 400,
                    fontSize: 11, fontFamily: "'DM Mono',monospace", cursor: "pointer" }}>
                  {ct.label}
                </button>
              ))}
            </div>
          </div>

          {/* Difficult Development Boost */}
          <div>
            <div style={{ fontSize: 9, color: "#888", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>DDA/QCT Basis Boost</div>
            <button onClick={() => setBasisBoost(v => !v)}
              style={{ padding: "6px 14px", borderRadius: 3,
                border: `1px solid ${basisBoost ? "#1a3a6b" : "#e0e0e0"}`,
                background: basisBoost ? "#f0f3f9" : "white",
                color: basisBoost ? "#1a3a6b" : "#888",
                fontWeight: basisBoost ? 700 : 400,
                fontSize: 11, fontFamily: "'DM Mono',monospace", cursor: "pointer" }}>
              {basisBoost ? "130% Boost ✓" : "No Boost"}
            </button>
          </div>

          {/* Applicable Fraction */}
          <div>
            <div style={{ fontSize: 9, color: "#888", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Applicable Fraction</div>
            <input type="number" step="0.01" min="0" max="1" value={appFrac.toFixed(2)}
              onChange={e => setAppFrac(Math.min(1, Math.max(0, Number(e.target.value))))}
              style={{ width: 80, padding: "6px 8px", border: "1px solid #e0e0e0", borderRadius: 3, fontSize: 12, fontFamily: "'DM Mono',monospace", textAlign: "right" }} />
          </div>

          {/* Credit Price */}
          <div>
            <div style={{ fontSize: 9, color: "#888", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Credit Price</div>
            <input type="number" step="0.01" min="0.50" max="1.05" value={creditPrice.toFixed(2)}
              onChange={e => setCreditPrice(Math.min(1.05, Math.max(0, Number(e.target.value))))}
              style={{ width: 80, padding: "6px 8px", border: "1px solid #e0e0e0", borderRadius: 3, fontSize: 12, fontFamily: "'DM Mono',monospace", textAlign: "right" }} />
          </div>
        </div>

        {/* Credit summary */}
        <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
          {[
            { label: "Eligible Basis", value: fmt$(eligibleBasis), color: "#111" },
            { label: "Qualified Basis", value: fmt$(qualifiedBasis), color: "#111" },
            { label: "Annual Credit", value: fmt$(annualCredit), color: "#1a6b3c" },
            { label: "10-Year Credit", value: fmt$(totalCredit), color: "#1a6b3c" },
            { label: "LP Equity", value: fmtM(lpEquity), color: "#1a3a6b", bold: true },
          ].map(p => (
            <div key={p.label} style={{ background: "#f8f8f8", border: "1px solid #e0e0e0", borderRadius: 4, padding: "8px 12px", minWidth: 120 }}>
              <div style={{ fontSize: 9, color: "#888", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 3 }}>{p.label}</div>
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: p.bold ? 15 : 12, fontWeight: p.bold ? 700 : 500, color: p.color }}>{p.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── SECTION 2: DEV COST BREAKDOWN (read-only from budget) ─────────── */}
      <div style={{ background: "white", border: "1px solid #e0e0e0", borderRadius: 6, padding: "18px 20px" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 14 }}>
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#888" }}>Dev Cost Breakdown</span>
          <span style={{ fontSize: 9, color: "#aaa" }}>— read from Dev Budget</span>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #111" }}>
              <th style={{ ...th }}>Category</th>
              <th style={{ ...th, textAlign: "right" }}>Amount</th>
              <th style={{ ...th, textAlign: "right" }}>% of TDC</th>
              <th style={{ ...th }}>Basis Eligible?</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(byCat).length === 0 ? (
              <tr><td colSpan={4} style={{ ...td, color: "#aaa", textAlign: "center", padding: 20 }}>No budget data — go to Dev Budget tab</td></tr>
            ) : (
              Object.entries(byCat).map(([cat, amt]) => {
                const pct = tdc > 0 ? amt / tdc : 0;
                const eligible = ["Hard Costs", "Soft Costs", "Architecture & Engineering"].includes(cat);
                return (
                  <tr key={cat} style={{ borderBottom: "1px solid #f5f5f5" }}>
                    <td style={{ ...td }}>{cat}</td>
                    <td style={{ ...td, textAlign: "right", fontFamily: "'DM Mono',monospace" }}>{fmt$(amt)}</td>
                    <td style={{ ...td, textAlign: "right", fontFamily: "'DM Mono',monospace", color: "#888" }}>{fmtPct(pct)}</td>
                    <td style={{ ...td }}>
                      <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 10,
                        background: eligible ? "#f0faf4" : "#f5f5f5",
                        color: eligible ? "#1a6b3c" : "#aaa",
                        border: `1px solid ${eligible ? "#b8e6cc" : "#e0e0e0"}` }}>
                        {eligible ? "Yes" : "No"}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: "2px solid #111", background: "#f8f8f8" }}>
              <td style={{ ...td, fontWeight: 700 }}>TOTAL</td>
              <td style={{ ...td, textAlign: "right", fontFamily: "'DM Mono',monospace", fontWeight: 700 }}>{fmt$(tdc)}</td>
              <td style={{ ...td, textAlign: "right", fontFamily: "'DM Mono',monospace", fontWeight: 700 }}>100.0%</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* ── SECTION 3: LIHTC PAY-IN SCHEDULE ─────────────────────────────── */}
      <div style={{ background: "white", border: "1px solid #e0e0e0", borderRadius: 6, padding: "18px 20px" }}>
        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#888", marginBottom: 6 }}>LIHTC Equity Pay-In Schedule</div>
        <div style={{ fontSize: 10, color: "#aaa", marginBottom: 14 }}>
          Total LP Equity: <strong style={{ fontFamily: "'DM Mono',monospace", color: "#1a3a6b" }}>{fmtM(lpEquity)}</strong> · Click % to edit · Dates auto-save
        </div>
        {localTranches.length === 0 ? (
          <div style={{ textAlign: "center", padding: 24, color: "#bbb", fontSize: 11 }}>No equity tranches found for this scenario.</div>
        ) : (
          <PayInTable rows={localTranches} totalAmt={lpEquity}
            onChangePct={handleTranchePct}
            onChangeDate={(row, v) => handleTrancheField(row, "target_date", v)}
            onChangeField={handleTrancheField}
            label="Equity" />
        )}
      </div>

      {/* ── SECTION 4: CASH DEV FEE PAY-IN SCHEDULE ──────────────────────── */}
      <div style={{ background: "white", border: "1px solid #e0e0e0", borderRadius: 6, padding: "18px 20px" }}>
        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#888", marginBottom: 6 }}>Cash Developer Fee Pay-In Schedule</div>
        <div style={{ fontSize: 10, color: "#aaa", marginBottom: 14 }}>
          Total Cash Dev Fee: <strong style={{ fontFamily: "'DM Mono',monospace", color: "#5a3a00" }}>{fmt$(cashDevFee)}</strong> · Click % to edit · Dates auto-save
        </div>
        {localFeeRows.length === 0 ? (
          <div style={{ textAlign: "center", padding: 24, color: "#bbb", fontSize: 11 }}>No developer fee schedule found for this scenario.</div>
        ) : (
          <PayInTable rows={localFeeRows} totalAmt={cashDevFee}
            onChangePct={handleFeePct}
            onChangeDate={(row, v) => handleFeeField(row, "target_date", v)}
            onChangeField={handleFeeField}
            label="Cash Fee" />
        )}
      </div>

    </div>
  );
}
