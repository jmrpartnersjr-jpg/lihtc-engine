import { useState, useMemo, useEffect, useCallback } from "react";
import { updateBudgetItem, upsertBudgetAssumptions } from "./db.js";
import { runCalcEngine, ASSUMP_FIELDS, ASSUMP_GROUPS } from "./calcEngine.js";

// ─────────────────────────────────────────────────────────────────────────────
// DETAILED DEVELOPMENT BUDGET — LIHTC Engine
// Mirrors the structure of the Apollo SL Detail Dev Budget tab.
// Categories → line items, each with amount + basis eligible toggle.
// Totals flow into Tax Credit Basis calc.
// ─────────────────────────────────────────────────────────────────────────────

const fmt$ = v => v == null || v === 0 ? "—" : "$" + Math.round(v).toLocaleString();
const fmtM = v => v == null || v === 0 ? "—" : "$" + (v / 1e6).toFixed(3) + "M";
const fmtPct = v => v == null ? "—" : (v * 100).toFixed(1) + "%";

// ─── DEFAULT BUDGET (from Apollo SL Detail Dev Budget) ────────────────────────
const DEFAULT_BUDGET = [
  {
    id: "acquisition", label: "Acquisition", color: "#5a3a00",
    items: [
      { id: "land_purchase",  label: "Land Purchase Price",    amount: 4400000,    basis: false, note: "" },
      { id: "closing_costs",  label: "Acquisition Closing Costs", amount: 88000,  basis: false, note: "2% of land" },
      { id: "extension_fees", label: "Extension / Pursuit Fees",  amount: 0,      basis: false, note: "" },
    ]
  },
  {
    id: "hard_costs", label: "Hard Costs", color: "#1a3a6b",
    items: [
      { id: "hard_residential",  label: "Hard Costs — Residential",    amount: 31200000, basis: true,  note: "" },
      { id: "hard_parking",      label: "Hard Costs — Parking",        amount: 1500000,  basis: false, note: "Parking removed from basis" },
      { id: "ffe",               label: "FF&E / GC Exclusions",        amount: 300000,   basis: true,  note: "" },
      { id: "demolition",        label: "Demolition",                  amount: 50000,    basis: true,  note: "" },
      { id: "ti_costs",          label: "T/I Costs (community space)", amount: 0,        basis: true,  note: "" },
      { id: "contingency",       label: "Contingency (Sponsor)",       amount: 1652500,  basis: true,  note: "5% of hard" },
      { id: "sales_tax",         label: "Sales Tax",                   amount: 3678465,  basis: true,  note: "10.6%" },
      { id: "pp_bond",           label: "P&P Bond Premium",            amount: 300000,   basis: true,  note: "" },
    ]
  },
  {
    id: "soft_costs", label: "Soft Costs", color: "#1a6b3c",
    items: [
      { id: "architect",        label: "Architecture",                amount: 1175000, basis: true,  note: "" },
      { id: "engineering",      label: "Engineering (Civil/MEP/Struct/Land)", amount: 600000, basis: true, note: "" },
      { id: "appraisal",        label: "Appraisal",                   amount: 5000,   basis: true,  note: "" },
      { id: "market_study",     label: "Market Study",                amount: 4500,   basis: true,  note: "" },
      { id: "environmental",    label: "Environmental Assessment",    amount: 5000,   basis: true,  note: "" },
      { id: "geotech",          label: "Geotechnical",                amount: 30000,  basis: true,  note: "" },
      { id: "survey",           label: "Survey, Topo & Boundary",     amount: 12000,  basis: true,  note: "" },
      { id: "legal_re",         label: "Legal — Real Estate",         amount: 50000,  basis: true,  note: "" },
      { id: "proj_mgmt",        label: "Project Management Fees",     amount: 300000, basis: true,  note: "R/P" },
      { id: "other_consultants",label: "Other Consultants",           amount: 277500, basis: true,  note: "Energy, Green, ADA, Arborist" },
      { id: "const_mgmt",       label: "Construction Management",     amount: 169365, basis: true,  note: "" },
      { id: "title_recording",  label: "Title & Recording",           amount: 100000, basis: true,  note: "" },
      { id: "permits",          label: "Permits, Fees & Hook-Ups",    amount: 1011715,basis: true,  note: "" },
      { id: "impact_fees",      label: "Impact & Mitigation Fees",    amount: 1300000,basis: true,  note: "" },
      { id: "other_inspections",label: "Other Inspections & Testing", amount: 100000, basis: true,  note: "" },
      { id: "soft_contingency", label: "Soft Cost Contingency",       amount: 514008, basis: true,  note: "10%" },
    ]
  },
  {
    id: "financing", label: "Financing & Legal", color: "#8B2500",
    items: [
      { id: "const_orig",       label: "Construction Origination & Fees", amount: 507558, basis: true,  note: "1% of const loan" },
      { id: "perm_orig",        label: "Perm Origination & Fees",         amount: 340491, basis: false, note: "1% of perm loan" },
      { id: "const_int",        label: "Construction Period Interest",     amount: 3164218,basis: true,  note: "" },
      { id: "lease_up_int",     label: "Lease-Up Period Interest",        amount: 1987588, basis: false, note: "" },
      { id: "wshfc_bond",       label: "WSHFC Bond Related Costs",        amount: 432191, basis: true,  note: "" },
      { id: "bond_legal",       label: "Bond Legal",                      amount: 85000,  basis: true,  note: "" },
      { id: "lihtc_issuance",   label: "LIHTC Issuance Fees",             amount: 145825, basis: false, note: "" },
      { id: "const_lender_3p",  label: "Construction Lender — Third Party Reports", amount: 65000, basis: true, note: "" },
      { id: "const_legal",      label: "Construction Loan Legal (Dev+Lender)", amount: 75000, basis: true, note: "" },
      { id: "equity_dd",        label: "Equity DD Fees",                  amount: 50000,  basis: false, note: "" },
      { id: "perm_legal",       label: "Perm Legal (Dev+Lender)",         amount: 50000,  basis: false, note: "" },
      { id: "cost_cert",        label: "Cost Certification",              amount: 30000,  basis: true,  note: "" },
      { id: "loan_guarantor",   label: "Loan Guarantor Fee",              amount: 300000, basis: false, note: "" },
      { id: "cbo_fees",         label: "CBO Fees / Legal",                amount: 20000,  basis: false, note: "" },
      { id: "lihtc_legal",      label: "LIHTC Legal (Synd/Dev/Other)",    amount: 50000,  basis: false, note: "" },
      { id: "trustee",          label: "Trustee / Fiscal (Bonds)",        amount: 37500,  basis: true,  note: "" },
      { id: "fin_consultant",   label: "Finance Consultant / Credits",    amount: 20000,  basis: false, note: "" },
    ]
  },
  {
    id: "org_costs", label: "Organizational & Carrying Costs", color: "#555",
    items: [
      { id: "op_reserves",      label: "Operating Reserves",             amount: 637500,  basis: false, note: "6 months" },
      { id: "rep_reserves",     label: "Replacement Reserves",           amount: 61250,   basis: false, note: "$350/unit" },
      { id: "ads_reserve",      label: "ADS Reserve (6 months DS)",      amount: 1110159, basis: false, note: "" },
      { id: "working_capital",  label: "Working Capital / Lease-Up",     amount: 159598,  basis: false, note: "3 months" },
      { id: "entity_legal",     label: "Entity Legal",                   amount: 5000,    basis: true,  note: "" },
      { id: "const_accounting", label: "Construction Accounting",        amount: 50000,   basis: false, note: "" },
      { id: "project_audit",    label: "Project Audit",                  amount: 30000,   basis: false, note: "" },
      { id: "tenant_engagement",label: "Pre-Tenant Engagement",          amount: 68000,   basis: true,  note: "" },
      { id: "sponsor_donation", label: "Sponsor Donation (Nonprofit)",   amount: 65000,   basis: false, note: "" },
      { id: "insurance",        label: "Insurance (Development Period)",  amount: 400000,  basis: true,  note: "" },
      { id: "re_taxes",         label: "RE Taxes During Development",    amount: 50000,   basis: true,  note: "" },
      { id: "org_other",        label: "Org Other",                      amount: 133000,  basis: true,  note: "" },
      { id: "dev_utilities",    label: "Development Period Utilities",   amount: 25000,   basis: true,  note: "" },
    ]
  },
  {
    id: "dev_fee", label: "Developer Fee", color: "#1a3a6b",
    items: [
      { id: "dev_fee_cash_closing",    label: "Cash Portion — Closing",    amount: 729852,  basis: true,  note: "25% of cash fee" },
      { id: "dev_fee_cash_completion", label: "Cash Portion — Completion", amount: 729852,  basis: true,  note: "25% of cash fee" },
      { id: "dev_fee_cash_conversion", label: "Cash Portion — Conversion", amount: 1459704, basis: true,  note: "50% of cash fee" },
      { id: "dev_fee_deferred",        label: "Deferred Developer Fee",    amount: 5927282, basis: true,  note: "" },
    ]
  },
];

// ─── LINE ITEM ROW ─────────────────────────────────────────────────────────────
function LineItemRow({ item, catColor, onUpdate, onRemove, showNotes }) {
  const [editAmt, setEditAmt] = useState(false);
  const [amt, setAmt] = useState(item.amount);

  return (
    <tr style={{ borderBottom: "1px solid #f5f5f5" }}>
      {/* Basis toggle */}
      <td style={{ padding: "5px 8px", textAlign: "center", width: 64 }}>
        <button
          onClick={() => onUpdate("basis", !item.basis)}
          title={item.basis ? "Click to mark NOT in basis" : "Click to mark IN basis"}
          style={{
            padding: "2px 7px", borderRadius: 2, border: "none", cursor: "pointer",
            fontSize: 9, fontWeight: 700, letterSpacing: "0.04em",
            background: item.basis ? "#e8f4ee" : "#f5f5f5",
            color: item.basis ? "#1a6b3c" : "#bbb",
          }}>
          {item.basis ? "BASIS" : "NO"}
        </button>
      </td>
      {/* Line item label */}
      <td style={{ padding: "5px 10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {item.calcType === "calc" && (
            <span style={{
              fontSize: 8, padding: "1px 5px", borderRadius: 2, border: "1px solid #c47a3a",
              color: "#c47a3a", background: "#fdf8f0", fontWeight: 700, letterSpacing: "0.05em",
              flexShrink: 0, whiteSpace: "nowrap",
            }} title={`Calculated: ${item.calcKey || ""}`}>CALC</span>
          )}
          <input
            value={item.label}
            onChange={e => onUpdate("label", e.target.value)}
            readOnly={item.calcType === "calc"}
            style={{
              flex: 1, background: "transparent", border: "none",
              fontSize: 11, fontFamily: "'DM Mono',monospace",
              color: item.calcType === "calc" ? "#888" : "#333",
              outline: "none", padding: 0, cursor: item.calcType === "calc" ? "default" : "text",
            }}
          />
        </div>
      </td>
      {/* Amount */}
      <td style={{ padding: "5px 8px", textAlign: "right", width: 130 }}>
        {item.calcType === "calc" ? (
          <span style={{
            fontFamily: "'DM Mono',monospace", fontSize: 11,
            color: "#c47a3a", fontStyle: "italic",
          }} title="Amount computed by calculation engine">
            {item.amount ? fmt$(item.amount) : "— pending"}
          </span>
        ) : editAmt ? (
          <input
            type="number"
            value={amt}
            autoFocus
            onChange={e => setAmt(Number(e.target.value))}
            onBlur={() => { onUpdate("amount", amt); setEditAmt(false); }}
            onKeyDown={e => { if (e.key === "Enter") { onUpdate("amount", amt); setEditAmt(false); } }}
            style={{
              width: 120, padding: "2px 6px", border: "1px solid #1a3a6b", borderRadius: 2,
              fontSize: 11, fontFamily: "'DM Mono',monospace", textAlign: "right", outline: "none",
            }}
          />
        ) : (
          <span
            onClick={() => { setAmt(item.amount); setEditAmt(true); }}
            style={{
              cursor: "text", fontFamily: "'DM Mono',monospace", fontSize: 11,
              color: item.amount ? "#111" : "#ccc",
              borderBottom: "1px dashed #e0e0e0", paddingBottom: 1,
            }}>
            {item.amount ? fmt$(item.amount) : "—"}
          </span>
        )}
      </td>
      {/* Note */}
      {showNotes && (
        <td style={{ padding: "5px 8px", width: 180 }}>
          <input
            value={item.note || ""}
            onChange={e => onUpdate("note", e.target.value)}
            placeholder="note..."
            style={{
              width: "100%", background: "transparent", border: "none",
              fontSize: 10, fontFamily: "'DM Mono',monospace", color: "#aaa",
              outline: "none", padding: 0, fontStyle: "italic",
            }}
          />
        </td>
      )}
      {/* Remove */}
      <td style={{ padding: "5px 8px", textAlign: "center", width: 24 }}>
        <button onClick={onRemove}
          style={{ background: "none", border: "none", cursor: "pointer", color: "#ddd", fontSize: 12 }}>
          ✕
        </button>
      </td>
    </tr>
  );
}

// ─── CATEGORY SECTION ─────────────────────────────────────────────────────────
function CategorySection({ cat, onUpdateItem, onRemoveItem, onAddItem, showNotes, collapsed, onToggle }) {
  const total = cat.items.reduce((s, i) => s + (i.amount || 0), 0);
  const basisTotal = cat.items.filter(i => i.basis).reduce((s, i) => s + (i.amount || 0), 0);
  const nonBasisTotal = total - basisTotal;
  const nextId = () => cat.id + "_" + Date.now();

  return (
    <div style={{ marginBottom: 2 }}>
      {/* Category header */}
      <div
        onClick={onToggle}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "8px 12px", cursor: "pointer", userSelect: "none",
          background: cat.color + "10",
          borderLeft: `4px solid ${cat.color}`,
          borderBottom: "1px solid #e8e8e8",
        }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 9, color: "#aaa" }}>{collapsed ? "▶" : "▼"}</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: cat.color, fontFamily: "'DM Mono',monospace",
            textTransform: "uppercase", letterSpacing: "0.07em" }}>{cat.label}</span>
          <span style={{ fontSize: 9, color: "#bbb" }}>{cat.items.length} items</span>
        </div>
        <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 9, color: "#aaa", textTransform: "uppercase", letterSpacing: "0.05em" }}>In Basis</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#1a6b3c", fontFamily: "'DM Mono',monospace" }}>
              {fmt$(basisTotal)}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 9, color: "#aaa", textTransform: "uppercase", letterSpacing: "0.05em" }}>Not Basis</div>
            <div style={{ fontSize: 11, fontWeight: 500, color: "#888", fontFamily: "'DM Mono',monospace" }}>
              {fmt$(nonBasisTotal)}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 9, color: "#aaa", textTransform: "uppercase", letterSpacing: "0.05em" }}>Total</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: cat.color, fontFamily: "'DM Mono',monospace" }}>
              {fmtM(total)}
            </div>
          </div>
        </div>
      </div>

      {/* Line items */}
      {!collapsed && (
        <div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              {cat.items.map(item => (
                <LineItemRow
                  key={item.id}
                  item={item}
                  catColor={cat.color}
                  showNotes={showNotes}
                  onUpdate={(field, val) => onUpdateItem(cat.id, item.id, field, val)}
                  onRemove={() => onRemoveItem(cat.id, item.id)}
                />
              ))}
            </tbody>
          </table>
          <div style={{ padding: "5px 10px", borderBottom: "1px solid #f0f0f0" }}>
            <button
              onClick={() => onAddItem(cat.id, { id: nextId(), label: "New Line Item", amount: 0, basis: true, note: "" })}
              style={{
                background: "none", border: "none", cursor: "pointer",
                fontSize: 9, color: "#bbb", letterSpacing: "0.07em", textTransform: "uppercase",
                fontFamily: "'DM Mono',monospace",
              }}>
              + Add Line Item
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ASSUMPTIONS PANEL ────────────────────────────────────────────────────────
function AssumptionsPanel({ assumptions, onChange }) {
  const fmtVal = (f, v) => {
    if (f.type === "bool") return v ? "ON" : "OFF";
    if (f.type === "pct")  return (Number(v) * 100).toFixed(f.step < 0.001 ? 3 : f.step < 0.01 ? 2 : 1) + "%";
    return String(v);
  };

  return (
    <div style={{ background: "white", border: "1px solid #e0e0e0", borderRadius: 6, padding: "14px 16px" }}>
      <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase",
        color: "#888", marginBottom: 12 }}>Calc Assumptions</div>
      {ASSUMP_GROUPS.map(group => (
        <div key={group.key} style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 8, color: group.color, fontWeight: 700, letterSpacing: "0.08em",
            textTransform: "uppercase", marginBottom: 6, borderBottom: `1px solid ${group.color}22`,
            paddingBottom: 3 }}>{group.label}</div>
          {ASSUMP_FIELDS.filter(f => f.group === group.key).map(f => {
            const v = assumptions[f.key] ?? (f.type === "bool" ? false : f.min ?? 0);
            return (
              <div key={f.key} style={{ display: "flex", justifyContent: "space-between",
                alignItems: "center", marginBottom: 5 }}>
                <span style={{ fontSize: 10, color: "#666" }}>{f.label}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  {f.type === "bool" ? (
                    <button onClick={() => onChange(f.key, !v)}
                      style={{ padding: "1px 8px", borderRadius: 2, border: "none", cursor: "pointer",
                        fontSize: 9, fontWeight: 700, background: v ? "#e8f4ee" : "#f5f5f5",
                        color: v ? "#1a6b3c" : "#bbb" }}>
                      {v ? "ON" : "OFF"}
                    </button>
                  ) : (
                    <>
                      <button onClick={() => onChange(f.key, Math.max(f.min ?? -Infinity, Number((Number(v) - f.step).toFixed(6))))}
                        style={{ width: 18, height: 18, borderRadius: 2, border: "1px solid #e0e0e0",
                          background: "white", cursor: "pointer", fontSize: 11, color: "#555",
                          padding: 0, fontFamily: "inherit" }}>−</button>
                      <span style={{ fontSize: 11, fontWeight: 600, color: "#111", minWidth: 52,
                        textAlign: "right", fontFamily: "'DM Mono',monospace" }}>
                        {fmtVal(f, v)}
                      </span>
                      <button onClick={() => onChange(f.key, Math.min(f.max ?? Infinity, Number((Number(v) + f.step).toFixed(6))))}
                        style={{ width: 18, height: 18, borderRadius: 2, border: "1px solid #e0e0e0",
                          background: "white", cursor: "pointer", fontSize: 11, color: "#555",
                          padding: 0, fontFamily: "inherit" }}>+</button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function DevBudgetPanel({ baseFA, onBudgetUpdate, scenarioId, dbBudgetItems, dbBudgetAssump, onBudgetItemsChange, onBudgetAssumpChange }) {
  // Convert DB rows → grouped budget format, or fall back to DEFAULT_BUDGET
  const initBudget = () => {
    if (!dbBudgetItems || dbBudgetItems.length === 0) return DEFAULT_BUDGET;
    // Group DB rows by category
    const catOrder = ["acquisition","hard_costs","soft_costs","financing_legal","org_carrying","developer_fee"];
    const catMeta  = {
      acquisition:    { label: "Acquisition",                      color: "#5a3a00" },
      hard_costs:     { label: "Hard Costs",                       color: "#1a3a6b" },
      soft_costs:     { label: "Soft Costs",                       color: "#1a6b3c" },
      financing_legal:{ label: "Financing & Legal",                color: "#8B2500" },
      org_carrying:   { label: "Organizational & Carrying Costs",  color: "#555"    },
      developer_fee:  { label: "Developer Fee",                    color: "#1a3a6b" },
    };
    const grouped = {};
    for (const row of dbBudgetItems) {
      if (!grouped[row.category]) grouped[row.category] = [];
      grouped[row.category].push({
        id:       row.id,         // use DB uuid as id
        _dbId:    row.id,
        label:    row.label,
        amount:   Number(row.amount),
        basis:    row.in_basis,
        calcType: row.calc_type,  // 'input' | 'calc'
        calcKey:  row.calc_key,
        note:     row.notes || "",
      });
    }
    return catOrder.map(catId => ({
      id: catId,
      label: catMeta[catId]?.label || catId,
      color: catMeta[catId]?.color || "#666",
      items: grouped[catId] || [],
    }));
  };

  const [budget, setBudget] = useState(initBudget);
  const [collapsed, setCollapsed] = useState({});
  const [showNotes, setShowNotes] = useState(true);
  const [showSummary, setShowSummary] = useState(true);
  const [saving, setSaving] = useState(false);

  // Assumptions state — seeded from DB, falls back to engine defaults
  const initAssump = () => {
    if (!dbBudgetAssump) return {};
    return { ...dbBudgetAssump };
  };
  const [assumptions, setAssumptions] = useState(initAssump);

  // Re-seed assumptions when DB data arrives
  useEffect(() => {
    if (dbBudgetAssump) setAssumptions({ ...dbBudgetAssump });
  }, [dbBudgetAssump?.scenario_id]);

  // Update a single assumption and persist to Supabase
  const updateAssumption = useCallback(async (key, val) => {
    setAssumptions(prev => ({ ...prev, [key]: val }));
    if (scenarioId) {
      try {
        await upsertBudgetAssumptions(scenarioId, { [key]: val });
      } catch (e) {
        console.warn("Assumption save failed:", e.message);
      }
    }
  }, [scenarioId]);

  // ── RUN THE CALC ENGINE on every budget or assumption change ──────────────
  const engineResult = useMemo(() => {
    // Flatten budget items for the engine
    const flatItems = budget.flatMap(cat =>
      cat.items.map(i => ({
        ...i,
        in_basis: i.basis !== false && i.in_basis !== false,
        calc_type: i.calcType || i.calc_type || "input",
        calc_key:  i.calcKey  || i.calc_key  || null,
        category: cat.id,
      }))
    );
    return runCalcEngine(flatItems, assumptions, baseFA,
      baseFA?.total_units || 175);
  }, [budget, assumptions, baseFA?.loan_amount]);

  // Apply engine results back to CALC items in budget display
  const budgetWithCalc = useMemo(() => {
    if (!engineResult) return budget;
    return budget.map(cat => ({
      ...cat,
      items: cat.items.map(item => {
        const key = item.calcKey || item.calc_key;
        if ((item.calcType || item.calc_type) === "calc" && key && engineResult.calcValues[key] != null) {
          return { ...item, amount: Math.round(engineResult.calcValues[key]) };
        }
        return item;
      }),
    }));
  }, [budget, engineResult]);

  // Persist CALC results back to Supabase (debounced — only when engine converges)
  useEffect(() => {
    if (!engineResult?.converged || !scenarioId) return;
    const { calcValues } = engineResult;
    // Fire-and-forget: update each CALC item in DB
    budget.forEach(cat => cat.items.forEach(item => {
      const key = item.calcKey || item.calc_key;
      if ((item.calcType || item.calc_type) === "calc" && key && calcValues[key] != null && item._dbId) {
        const newAmt = Math.round(calcValues[key]);
        if (Math.abs(newAmt - (item.amount || 0)) > 0.5) {
          updateBudgetItem(item._dbId, { amount: newAmt }).catch(() => {});
        }
      }
    }));
  }, [engineResult?.tdc]);  // only fire when TDC changes

  // Re-init if DB data arrives after mount
  const prevDbRef = useState(dbBudgetItems)[0];
  useEffect(() => {
    if (dbBudgetItems && dbBudgetItems.length > 0) {
      setBudget(initBudget());
    }
  }, [dbBudgetItems?.length]);

  // Persist item change to Supabase
  const persistItem = async (item, field, val) => {
    if (!scenarioId || !item._dbId) return;
    const fieldMap = { label: "label", amount: "amount", basis: "in_basis", note: "notes" };
    const dbField  = fieldMap[field];
    if (!dbField) return;
    try {
      await updateBudgetItem(item._dbId, { [dbField]: val });
    } catch (e) {
      console.warn("Budget item save failed:", e.message);
    }
  };

  const updateItem  = (catId, itemId, field, val) => {
    setBudget(b => {
      const next = b.map(c => c.id !== catId ? c : {
        ...c, items: c.items.map(i => {
          if (i.id !== itemId) return i;
          const updated = { ...i, [field]: val };
          persistItem(updated, field, val);
          return updated;
        })
      });
      return next;
    });
  };

  const removeItem  = (catId, itemId) =>
    setBudget(b => b.map(c => c.id !== catId ? c : { ...c, items: c.items.filter(i => i.id !== itemId) }));
  const addItem     = (catId, item) =>
    setBudget(b => b.map(c => c.id !== catId ? c : { ...c, items: [...c.items, item] }));
  const toggleCat   = (catId) =>
    setCollapsed(s => ({ ...s, [catId]: !s[catId] }));

  // Totals — always computed from budgetWithCalc (includes engine CALC values)
  const totals = useMemo(() => {
    let basisTotal = 0, nonBasisTotal = 0;
    const byCategory = budgetWithCalc.map(cat => {
      const catBasis    = cat.items.filter(i => i.basis).reduce((s, i) => s + (i.amount || 0), 0);
      const catNonBasis = cat.items.filter(i => !i.basis).reduce((s, i) => s + (i.amount || 0), 0);
      basisTotal    += catBasis;
      nonBasisTotal += catNonBasis;
      return { id: cat.id, label: cat.label, color: cat.color, basis: catBasis, nonBasis: catNonBasis, total: catBasis + catNonBasis };
    });
    return { basisTotal, nonBasisTotal, tdc: basisTotal + nonBasisTotal, byCategory };
  }, [budgetWithCalc]);

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <h2 style={{ fontFamily: "'Playfair Display',serif", fontSize: 20, fontWeight: 400, color: "#111" }}>
            Development Budget
          </h2>
          <span style={{ fontSize: 9, color: "#aaa", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            LINE ITEMS · BASIS ELIGIBLE · TDC
          </span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={() => setShowNotes(v => !v)}
            style={{ background: "white", border: "1px solid #e0e0e0", color: "#666", padding: "5px 11px",
              borderRadius: 3, cursor: "pointer", fontSize: 9, letterSpacing: "0.08em",
              textTransform: "uppercase", fontFamily: "'DM Mono',monospace" }}>
            {showNotes ? "Hide Notes" : "Show Notes"}
          </button>
          <button
            onClick={() => setCollapsed(c => {
              const allCollapsed = budget.every(cat => c[cat.id]);
              return allCollapsed ? {} : Object.fromEntries(budget.map(cat => [cat.id, true]));
            })}
            style={{ background: "white", border: "1px solid #e0e0e0", color: "#666", padding: "5px 11px",
              borderRadius: 3, cursor: "pointer", fontSize: 9, letterSpacing: "0.08em",
              textTransform: "uppercase", fontFamily: "'DM Mono',monospace" }}>
            {budget.every(cat => collapsed[cat.id]) ? "Expand All" : "Collapse All"}
          </button>
          {onBudgetUpdate && (
            <button
              onClick={() => onBudgetUpdate(totals.basisTotal, totals.tdc, budgetWithCalc)}
              style={{ background: "#1a3a6b", color: "white", border: "none", padding: "5px 14px",
                borderRadius: 3, cursor: "pointer", fontSize: 9, letterSpacing: "0.08em",
                textTransform: "uppercase", fontFamily: "'DM Mono',monospace", fontWeight: 700 }}>
              Push to Tax Credit →
            </button>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: showSummary ? "1fr 260px" : "1fr", gap: 14, alignItems: "start" }}>

        {/* LEFT — Detail budget */}
        <div style={{ background: "white", border: "1px solid #e0e0e0", borderRadius: 6, overflow: "hidden" }}>
          {/* Column headers */}
          <div style={{
            display: "grid",
            gridTemplateColumns: showNotes ? "64px 1fr 130px 180px 24px" : "64px 1fr 130px 24px",
            background: "#111", padding: "6px 8px",
          }}>
            {["Basis?", "Line Item", "Amount", showNotes && "Notes", ""].filter(Boolean).map(h => (
              <div key={h} style={{ fontSize: 8, fontWeight: 700, color: "#888", textTransform: "uppercase",
                letterSpacing: "0.07em", textAlign: h === "Amount" ? "right" : "left" }}>
                {h}
              </div>
            ))}
          </div>

          {/* Engine status banner */}
          {engineResult && (
            <div style={{
              padding: "6px 12px", background: engineResult.converged ? "#f0f7f4" : "#fff8f0",
              borderBottom: "1px solid #e0e0e0", display: "flex", alignItems: "center",
              gap: 8, flexWrap: "wrap",
            }}>
              <span style={{
                fontSize: 8, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase",
                color: engineResult.converged ? "#1a6b3c" : "#c47a3a",
                padding: "1px 6px", border: `1px solid ${engineResult.converged ? "#b8dfc8" : "#e8c07a"}`,
                borderRadius: 2, background: engineResult.converged ? "#e8f4ee" : "#fdf8f0",
              }}>
                {engineResult.converged ? `✓ CONVERGED (${engineResult.iterations} iters)` : "⚠ NOT CONVERGED"}
              </span>
              <span style={{ fontSize: 9, color: "#888" }}>
                Const Loan: <strong style={{ color: "#111" }}>{fmtM(engineResult.constLoanAmount)}</strong>
                {" · "}Total Dev Fee: <strong style={{ color: "#111" }}>{fmtM(engineResult.totalDevFee)}</strong>
                {assumptions.escalation_enabled && ` · ${((assumptions.escalation_rate||0.02)*100).toFixed(1)}% escalation ×${((engineResult.calcValues?._escalMult||1)).toFixed(3)}`}
              </span>
            </div>
          )}

          {budgetWithCalc.map(cat => (
            <CategorySection
              key={cat.id}
              cat={cat}
              showNotes={showNotes}
              collapsed={collapsed[cat.id]}
              onToggle={() => toggleCat(cat.id)}
              onUpdateItem={updateItem}
              onRemoveItem={removeItem}
              onAddItem={addItem}
            />
          ))}

          {/* Grand total row */}
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "10px 16px", background: "#111", marginTop: 2,
          }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: "white", textTransform: "uppercase",
              letterSpacing: "0.07em", fontFamily: "'DM Mono',monospace" }}>
              TOTAL DEVELOPMENT COST
            </span>
            <div style={{ display: "flex", gap: 24 }}>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 8, color: "#888", textTransform: "uppercase" }}>In Basis</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#6dba8a", fontFamily: "'DM Mono',monospace" }}>
                  {fmtM(totals.basisTotal)}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 8, color: "#888", textTransform: "uppercase" }}>Not Basis</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#aaa", fontFamily: "'DM Mono',monospace" }}>
                  {fmtM(totals.nonBasisTotal)}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 8, color: "#888", textTransform: "uppercase" }}>TDC</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "white", fontFamily: "'DM Mono',monospace" }}>
                  {fmtM(totals.tdc)}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT — Basis Summary */}
        {showSummary && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>

            {/* TDC summary card */}
            <div style={{ background: "white", border: "1px solid #e0e0e0", borderRadius: 6, padding: "14px 16px" }}>
              <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase",
                color: "#888", marginBottom: 12 }}>TDC Summary</div>
              <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 28, fontWeight: 400, color: "#111",
                marginBottom: 4 }}>{fmtM(totals.tdc)}</div>
              <div style={{ fontSize: 10, color: "#aaa", marginBottom: 16 }}>Total Development Cost</div>

              <div style={{ display: "flex", gap: 0, marginBottom: 12 }}>
                <div style={{ flex: totals.basisTotal / totals.tdc, background: "#1a6b3c",
                  height: 6, borderRadius: "3px 0 0 3px" }} />
                <div style={{ flex: totals.nonBasisTotal / totals.tdc, background: "#e8e8e8",
                  height: 6, borderRadius: "0 3px 3px 0" }} />
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <div>
                  <div style={{ fontSize: 9, color: "#1a6b3c", fontWeight: 700, textTransform: "uppercase",
                    letterSpacing: "0.05em" }}>Eligible Basis</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#1a6b3c",
                    fontFamily: "'DM Mono',monospace" }}>{fmtM(totals.basisTotal)}</div>
                  <div style={{ fontSize: 9, color: "#aaa" }}>{fmtPct(totals.basisTotal / totals.tdc)} of TDC</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 9, color: "#888", fontWeight: 700, textTransform: "uppercase",
                    letterSpacing: "0.05em" }}>Not in Basis</div>
                  <div style={{ fontSize: 14, fontWeight: 500, color: "#888",
                    fontFamily: "'DM Mono',monospace" }}>{fmtM(totals.nonBasisTotal)}</div>
                  <div style={{ fontSize: 9, color: "#aaa" }}>{fmtPct(totals.nonBasisTotal / totals.tdc)} of TDC</div>
                </div>
              </div>
            </div>

            {/* By category */}
            <div style={{ background: "white", border: "1px solid #e0e0e0", borderRadius: 6, padding: "14px 16px" }}>
              <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase",
                color: "#888", marginBottom: 12 }}>Basis by Category</div>
              {totals.byCategory.map(cat => (
                <div key={cat.id} style={{ marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                    <span style={{ fontSize: 9, fontWeight: 700, color: cat.color, textTransform: "uppercase",
                      letterSpacing: "0.04em" }}>{cat.label}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, fontFamily: "'DM Mono',monospace",
                      color: "#111" }}>{fmtM(cat.total)}</span>
                  </div>
                  {/* Mini bar: basis / non-basis */}
                  <div style={{ display: "flex", gap: 0, marginBottom: 3, height: 4 }}>
                    {cat.basis > 0 && <div style={{
                      flex: cat.basis / cat.total, background: cat.color, opacity: 0.8,
                      borderRadius: cat.nonBasis > 0 ? "2px 0 0 2px" : "2px",
                    }} />}
                    {cat.nonBasis > 0 && <div style={{
                      flex: cat.nonBasis / cat.total, background: "#e8e8e8",
                      borderRadius: cat.basis > 0 ? "0 2px 2px 0" : "2px",
                    }} />}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 9, color: "#1a6b3c" }}>
                      {cat.basis > 0 ? fmt$(cat.basis) + " basis" : ""}
                    </span>
                    <span style={{ fontSize: 9, color: "#bbb" }}>
                      {cat.nonBasis > 0 ? fmt$(cat.nonBasis) + " not" : ""}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* Push callout */}
            {onBudgetUpdate && (
              <div style={{ background: "#f0f3f9", border: "1px solid #b8c8e0", borderRadius: 5,
                padding: "10px 14px" }}>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em",
                  textTransform: "uppercase", color: "#1a3a6b", marginBottom: 4 }}>
                  Push to Tax Credit Basis
                </div>
                <div style={{ fontSize: 10, color: "#888", marginBottom: 8 }}>
                  Eligible basis {fmtM(totals.basisTotal)} will populate the Tax Credit tab.
                </div>
                <button
                  onClick={() => onBudgetUpdate(totals.basisTotal, totals.tdc, budgetWithCalc)}
                  style={{ background: "#1a3a6b", color: "white", border: "none",
                    padding: "7px 14px", borderRadius: 3, cursor: "pointer",
                    fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase",
                    fontFamily: "'DM Mono',monospace", fontWeight: 700, width: "100%" }}>
                  Push to Tax Credit →
                </button>
              </div>
            )}

            {/* Assumptions Panel */}
            <AssumptionsPanel assumptions={assumptions} onChange={updateAssumption} />
          </div>
        )}
      </div>
    </div>
  );
}
