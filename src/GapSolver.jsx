/**
 * GapSolver.jsx — Deterministic Gap Analysis & Optimization Engine
 * Analyzes the funding gap (Sources - Uses) and suggests specific,
 * actionable moves to close it. Not AI — pure math.
 */
import { useMemo } from "react";
import { useLihtc } from "./context/LihtcContext.jsx";
import { computeBudgetCalcs, computeLIHTC } from "./lihtcCalcs.js";

/* ── formatting helpers ──────────────────────────────────────────── */
const fmt$ = v => v == null ? "—" : (v < 0 ? "(" : "") + "$" + Math.round(Math.abs(v)).toLocaleString() + (v < 0 ? ")" : "");
const fmtPct = v => v == null ? "—" : (v * 100).toFixed(1) + "%";

/* ── LIHTC defaults (mirrors Debt/SU) ────────────────────────────── */
const LIHTC_DEFAULTS = {
  credit_type: "4pct", applicable_pct: 0.04, basis_boost: true, boost_factor: 1.30,
  applicable_fraction: 1.0, credit_period: 10, investor_price: 0.82,
  non_basis_costs: 6527411, commercial_costs: 0, federal_grants: 0, historic_reduction: 0,
  state_credit_applies: false, state_credit_annual: 0, state_credit_period: 10, state_credit_price: 0,
};
const DEFAULT_SUBDEBT = [
  { id: 400, label: "Deferred Developer Fee", priority: 1, loan_type: "deferred_fee", amount: 0 },
  { id: 401, label: "Seller Note", priority: 2, loan_type: "seller", amount: 1000000 },
  { id: 402, label: "CHIP", priority: 3, loan_type: "soft", amount: 900000 },
  { id: 403, label: "Sponsor Note", priority: 4, loan_type: "sponsor", amount: 346031 },
];

/* ── debt constant helper ────────────────────────────────────────── */
function debtConstant(rate, amortYears) {
  if (!rate || !amortYears || amortYears <= 0) return 0;
  const r = rate / 12;
  const n = amortYears * 12;
  return (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1) * 12;
}

/* ══════════════════════════════════════════════════════════════════
   GAP SOLVER ENGINE
   ══════════════════════════════════════════════════════════════════ */

function solveGap(moduleStates) {
  const budget = moduleStates.budget;
  const unitMix = moduleStates.unit_mix;
  const totalUnits = (unitMix?.rows ?? []).reduce((s, r) => s + (r.count || 0), 0) || 175;
  const bc = computeBudgetCalcs(budget, totalUnits);

  const lihtcInputs = { ...LIHTC_DEFAULTS, ...moduleStates.lihtc };
  const debtConst = moduleStates.debt?.construction ?? {};
  const teBondAmt = bc.tdc * (debtConst.bond_test_target_pct || 0.35);
  const lihtc = computeLIHTC(lihtcInputs, bc, totalUnits, teBondAmt);

  const permanent = moduleStates.debt?.permanent ?? {};
  const rawSubdebt = moduleStates.debt?.subdebt ?? DEFAULT_SUBDEBT;
  const otherSources = moduleStates.debt?.other_sources ?? [];

  // Current sources
  const permLoan = permanent.loan_amount || 0;
  const fedEquity = lihtc.equityRaised || 0;
  const stateEquity = lihtc.stateEquity || 0;
  const ddf = bc.deferredDevFee || 0;
  const sellerNote = rawSubdebt.find(l => l.loan_type === "seller")?.amount || 0;
  const chipLoan = rawSubdebt.find(l => l.loan_type === "soft")?.amount || 0;
  const sponsorNote = rawSubdebt.find(l => l.loan_type === "sponsor")?.amount || 0;
  const otherSourcesTotal = otherSources.reduce((s, x) => s + (x.amount || 0), 0);

  const totalSources = permLoan + fedEquity + stateEquity + ddf + sellerNote + chipLoan + sponsorNote + otherSourcesTotal;
  const totalUses = bc.tdc;
  const gap = totalSources - totalUses;

  // Current budget assumptions
  const budgetAssumptions = budget?.assumptions || {};
  const cashFeePct = budgetAssumptions.cash_fee_pct || 0.33;
  const devFeePct = budgetAssumptions.dev_fee_pct || 0.15;

  // Current debt sizing parameters
  const rate = permanent.rate || 0.0585;
  const amort = permanent.amort_years || 40;
  const noi = permanent.noi_override || 0;
  const dscr = permanent.dscr_requirement || 1.15;
  const dc = debtConstant(rate, amort);
  const maxLoanFromDSCR = dc > 0 ? (noi / dscr) / dc : 0;
  const loanHeadroom = Math.floor(maxLoanFromDSCR) - permLoan;

  // Dev fee math
  const devFee = bc.devFee || 0;
  const cashDevFee = bc.cashDevFee || 0;

  // Generate suggestions
  const suggestions = [];
  const absGap = Math.abs(gap);

  if (gap >= -500 && gap <= 500) {
    // Balanced — no suggestions needed
    return { gap, totalSources, totalUses, suggestions: [], balanced: true, bc, permLoan, fedEquity, ddf, sellerNote, chipLoan, sponsorNote, devFee, cashDevFee, cashFeePct, maxLoanFromDSCR, loanHeadroom, noi, dscr, rate, amort, lihtcInputs, lihtc };
  }

  const isShortfall = gap < -500;

  if (isShortfall) {
    // ── CLOSING A SHORTFALL ──────────────────────────────────────

    // 1. Increase perm loan (if DSCR headroom)
    if (loanHeadroom > 10000) {
      const loanIncrease = Math.min(loanHeadroom, absGap);
      suggestions.push({
        id: "increase_perm_loan",
        category: "debt",
        icon: "🏦",
        label: "Increase permanent loan",
        description: `DSCR headroom allows up to ${fmt$(loanHeadroom)} more debt. Increase loan from ${fmt$(permLoan)} to ${fmt$(permLoan + loanIncrease)}.`,
        impact: loanIncrease,
        closesGap: loanIncrease >= absGap,
        action: `Set perm loan to ${fmt$(permLoan + loanIncrease)}`,
        details: [
          { label: "Current Loan", value: fmt$(permLoan) },
          { label: "Max from DSCR", value: fmt$(Math.floor(maxLoanFromDSCR)) },
          { label: "Headroom", value: fmt$(loanHeadroom) },
          { label: "New DSCR", value: ((noi / ((permLoan + loanIncrease) * dc)) || 0).toFixed(2) + "x" },
        ],
      });
    }

    // 2. Increase seller note
    const maxSellerIncrease = 2000000; // reasonable ceiling
    if (sellerNote < maxSellerIncrease) {
      const increase = Math.min(maxSellerIncrease - sellerNote, absGap);
      suggestions.push({
        id: "increase_seller_note",
        category: "sub_debt",
        icon: "📝",
        label: "Increase seller note",
        description: `Increase from ${fmt$(sellerNote)} to ${fmt$(sellerNote + increase)}. Requires seller cooperation.`,
        impact: increase,
        closesGap: increase >= absGap,
        action: `Set seller note to ${fmt$(sellerNote + increase)}`,
        details: [
          { label: "Current", value: fmt$(sellerNote) },
          { label: "Proposed", value: fmt$(sellerNote + increase) },
          { label: "Increase", value: fmt$(increase) },
        ],
      });
    }

    // 3. Shift cash fee → DDF (increase DDF, reduce cash draws)
    if (cashFeePct > 0.05) {
      // Reducing cash fee % increases DDF as a source
      const minCashPct = 0.10; // floor at 10% cash
      const shiftPct = cashFeePct - minCashPct;
      const additionalDDF = devFee * shiftPct;
      if (additionalDDF > 10000) {
        suggestions.push({
          id: "shift_cash_to_ddf",
          category: "dev_fee",
          icon: "🔄",
          label: "Reduce cash dev fee, increase DDF",
          description: `Shift cash fee from ${fmtPct(cashFeePct)} to ${fmtPct(minCashPct)}, adding ${fmt$(additionalDDF)} to DDF sources.`,
          impact: Math.min(additionalDDF, absGap),
          closesGap: additionalDDF >= absGap,
          action: `Set cash fee to ${fmtPct(minCashPct)} (DDF = ${fmtPct(1 - minCashPct)})`,
          details: [
            { label: "Current Cash Fee", value: `${fmtPct(cashFeePct)} = ${fmt$(cashDevFee)}` },
            { label: "Proposed Cash Fee", value: `${fmtPct(minCashPct)} = ${fmt$(devFee * minCashPct)}` },
            { label: "Additional DDF", value: fmt$(additionalDDF) },
            { label: "Total DDF", value: fmt$(ddf + additionalDDF) },
          ],
        });
      }
    }

    // 4. Increase investor pricing
    const currentPrice = lihtcInputs.investor_price || 0.82;
    if (currentPrice < 0.92) {
      const newPrice = Math.min(currentPrice + 0.05, 0.92);
      const creditIncrease = (newPrice - currentPrice) * (lihtc.annualCredit || 0) * (lihtcInputs.credit_period || 10);
      if (creditIncrease > 10000) {
        suggestions.push({
          id: "increase_investor_price",
          category: "equity",
          icon: "📈",
          label: "Negotiate higher investor pricing",
          description: `Increase from $${currentPrice.toFixed(2)} to $${newPrice.toFixed(2)} per credit dollar, adding ${fmt$(creditIncrease)} equity.`,
          impact: creditIncrease,
          closesGap: creditIncrease >= absGap,
          action: `Negotiate pricing to $${newPrice.toFixed(2)}`,
          details: [
            { label: "Current Price", value: `$${currentPrice.toFixed(2)}` },
            { label: "Proposed Price", value: `$${newPrice.toFixed(2)}` },
            { label: "Additional Equity", value: fmt$(creditIncrease) },
          ],
        });
      }
    }

    // 5. Increase sponsor note
    const maxSponsorIncrease = 1000000;
    if (sponsorNote < maxSponsorIncrease) {
      const increase = Math.min(maxSponsorIncrease - sponsorNote, absGap);
      suggestions.push({
        id: "increase_sponsor_note",
        category: "sub_debt",
        icon: "🤝",
        label: "Increase sponsor note",
        description: `Increase from ${fmt$(sponsorNote)} to ${fmt$(sponsorNote + increase)}. Requires sponsor capacity.`,
        impact: increase,
        closesGap: increase >= absGap,
        action: `Set sponsor note to ${fmt$(sponsorNote + increase)}`,
        details: [
          { label: "Current", value: fmt$(sponsorNote) },
          { label: "Proposed", value: fmt$(sponsorNote + increase) },
        ],
      });
    }

    // 6. Reduce hard cost contingency
    const hcContPct = budgetAssumptions.hc_contingency_pct || 0.05;
    if (hcContPct > 0.03) {
      const hcInputs = budget?.sections?.hard_costs?.filter(l => l.type === "input")
        .reduce((s, l) => s + (l.amount || 0), 0) || 0;
      const reduction = hcInputs * (hcContPct - 0.03);
      if (reduction > 10000) {
        suggestions.push({
          id: "reduce_hc_contingency",
          category: "cost_reduction",
          icon: "📐",
          label: "Reduce hard cost contingency",
          description: `Lower from ${fmtPct(hcContPct)} to 3.0%, saving ${fmt$(reduction)}. Risk: less construction buffer.`,
          impact: reduction,
          closesGap: reduction >= absGap,
          action: `Set HC contingency to 3.0%`,
          details: [
            { label: "Current", value: fmtPct(hcContPct) },
            { label: "Proposed", value: "3.0%" },
            { label: "Savings", value: fmt$(reduction) },
          ],
        });
      }
    }

    // 7. Reduce dev fee percentage
    if (devFeePct > 0.12) {
      const subtotal = bc.subtotal || 0;
      const newPct = Math.max(0.12, devFeePct - 0.02);
      const feeReduction = subtotal * (devFeePct - newPct);
      if (feeReduction > 10000) {
        suggestions.push({
          id: "reduce_dev_fee",
          category: "cost_reduction",
          icon: "✂️",
          label: "Reduce developer fee %",
          description: `Lower from ${fmtPct(devFeePct)} to ${fmtPct(newPct)}, reducing TDC by ${fmt$(feeReduction)}.`,
          impact: feeReduction,
          closesGap: feeReduction >= absGap,
          action: `Set dev fee to ${fmtPct(newPct)}`,
          details: [
            { label: "Current Fee", value: `${fmtPct(devFeePct)} = ${fmt$(devFee)}` },
            { label: "Proposed Fee", value: `${fmtPct(newPct)} = ${fmt$(subtotal * newPct)}` },
            { label: "TDC Reduction", value: fmt$(feeReduction) },
          ],
        });
      }
    }

    // 8. DSCR stretch (lower DSCR = more loan)
    if (dscr > 1.10 && noi > 0 && dc > 0) {
      const newDSCR = 1.10;
      const newMax = Math.floor((noi / newDSCR) / dc);
      const increase = newMax - permLoan;
      if (increase > 50000) {
        suggestions.push({
          id: "lower_dscr",
          category: "debt",
          icon: "⚡",
          label: "Lower DSCR requirement to 1.10x",
          description: `Stretching coverage from ${dscr.toFixed(2)}x to 1.10x adds ${fmt$(increase)} loan capacity. Requires lender approval.`,
          impact: increase,
          closesGap: increase >= absGap,
          action: `Negotiate DSCR to 1.10x`,
          details: [
            { label: "Current DSCR", value: dscr.toFixed(2) + "x" },
            { label: "Proposed", value: "1.10x" },
            { label: "Current Max Loan", value: fmt$(Math.floor(maxLoanFromDSCR)) },
            { label: "New Max Loan", value: fmt$(newMax) },
          ],
        });
      }
    }

  } else {
    // ── SURPLUS — show how to use it ────────────────────────────────

    suggestions.push({
      id: "surplus_reduce_seller_note",
      category: "sub_debt",
      icon: "📝",
      label: "Reduce seller note",
      description: `Reduce from ${fmt$(sellerNote)} by ${fmt$(Math.min(sellerNote, absGap))} to lower subordinate debt.`,
      impact: Math.min(sellerNote, absGap),
      closesGap: sellerNote >= absGap,
      action: `Reduce seller note to ${fmt$(Math.max(0, sellerNote - absGap))}`,
      details: [],
    });

    if (cashFeePct < 0.50) {
      const maxShift = Math.min(absGap, devFee * (0.50 - cashFeePct));
      suggestions.push({
        id: "surplus_increase_cash_fee",
        category: "dev_fee",
        icon: "💰",
        label: "Increase cash developer fee",
        description: `Take more fee as cash (less deferred). Shift up to ${fmt$(maxShift)}.`,
        impact: maxShift,
        closesGap: maxShift >= absGap,
        action: `Increase cash fee %`,
        details: [],
      });
    }

    suggestions.push({
      id: "surplus_reduce_loan",
      category: "debt",
      icon: "🏦",
      label: "Reduce permanent loan",
      description: `Lower perm loan by ${fmt$(Math.min(permLoan, absGap))} to improve DSCR.`,
      impact: Math.min(permLoan, absGap),
      closesGap: true,
      action: `Reduce loan to ${fmt$(Math.max(0, permLoan - absGap))}`,
      details: [],
    });
  }

  // Sort by impact (highest first)
  suggestions.sort((a, b) => b.impact - a.impact);

  return {
    gap, totalSources, totalUses, suggestions, balanced: false,
    bc, permLoan, fedEquity, ddf, sellerNote, chipLoan, sponsorNote,
    devFee, cashDevFee, cashFeePct, maxLoanFromDSCR, loanHeadroom,
    noi, dscr, rate, amort, lihtcInputs, lihtc,
  };
}

/* ══════════════════════════════════════════════════════════════════
   COMPONENT
   ══════════════════════════════════════════════════════════════════ */

export default function GapSolverPanel() {
  const { moduleStates } = useLihtc();

  const result = useMemo(() => solveGap(moduleStates), [moduleStates]);
  const { gap, totalSources, totalUses, suggestions, balanced } = result;
  const isShortfall = gap < -500;
  const isSurplus = gap > 500;

  const gapColor = balanced ? "#1a6b3c" : isShortfall ? "#8B2500" : "#1a6b3c";
  const gapBg = balanced ? "#f0f9f4" : isShortfall ? "#fce8e3" : "#f0f9f4";
  const gapBorder = balanced ? "#b8dfc8" : isShortfall ? "#f5c2b0" : "#b8dfc8";

  return (
    <div style={{ fontFamily: "Inter, sans-serif", maxWidth: 900 }}>

      {/* ── HEADER ── */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 20 }}>
        <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 20, fontWeight: 400, color: "#111", margin: 0 }}>
          Gap Solver
        </h2>
        <span style={{ fontSize: 9, color: "#aaa", letterSpacing: "0.08em", textTransform: "uppercase" }}>
          FUNDING ANALYSIS & OPTIMIZATION
        </span>
      </div>

      {/* ── GAP STATUS BANNER ── */}
      <div style={{
        background: gapBg, border: `1px solid ${gapBorder}`, borderRadius: 8,
        padding: "16px 20px", marginBottom: 24,
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <div>
          <div style={{ fontSize: 11, color: gapColor, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
            {balanced ? "✓ Sources & Uses Balanced" : isShortfall ? "⚠ Funding Shortfall" : "✓ Funding Surplus"}
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, color: gapColor, fontFamily: "Inter, sans-serif" }}>
            {isShortfall ? `(${fmt$(Math.abs(gap))})` : fmt$(gap)}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 10, color: "#888", marginBottom: 2 }}>Sources: {fmt$(totalSources)}</div>
          <div style={{ fontSize: 10, color: "#888", marginBottom: 2 }}>Uses: {fmt$(totalUses)}</div>
          <div style={{ fontSize: 10, color: "#888" }}>
            {totalUses > 0 ? `${fmtPct(Math.abs(gap) / totalUses)} of TDC` : ""}
          </div>
        </div>
      </div>

      {/* ── CURRENT STRUCTURE SNAPSHOT ── */}
      <div style={{
        background: "white", border: "1px solid #e0e0e0", borderRadius: 6,
        marginBottom: 24, overflow: "hidden",
      }}>
        <div style={{
          padding: "10px 16px", borderBottom: "2px solid #333",
          fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#888",
        }}>
          Current Capital Structure
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 0 }}>
          {[
            { label: "Perm Loan", value: fmt$(result.permLoan), sub: `DSCR: ${result.dscr.toFixed(2)}x` },
            { label: "Tax Credit Equity", value: fmt$(result.fedEquity), sub: `@ $${(result.lihtcInputs.investor_price || 0).toFixed(2)}` },
            { label: "Deferred Dev Fee", value: fmt$(result.ddf), sub: `${fmtPct(1 - result.cashFeePct)} deferred` },
            { label: "Sub Debt", value: fmt$(result.sellerNote + result.chipLoan + result.sponsorNote), sub: `${[result.sellerNote > 0 ? "Seller" : "", result.chipLoan > 0 ? "CHIP" : "", result.sponsorNote > 0 ? "Sponsor" : ""].filter(Boolean).join(" + ")}` },
          ].map((item, i) => (
            <div key={i} style={{
              padding: "12px 16px",
              borderRight: i < 3 ? "1px solid #f0f0f0" : "none",
            }}>
              <div style={{ fontSize: 8, color: "#888", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>{item.label}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#111" }}>{item.value}</div>
              <div style={{ fontSize: 9, color: "#aaa", marginTop: 2 }}>{item.sub}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── SUGGESTIONS ── */}
      {balanced ? (
        <div style={{
          background: "#f0f9f4", border: "1px solid #b8dfc8", borderRadius: 8,
          padding: "20px", textAlign: "center",
        }}>
          <div style={{ fontSize: 14, color: "#1a6b3c", fontWeight: 600, marginBottom: 4 }}>
            Sources and Uses are balanced
          </div>
          <div style={{ fontSize: 11, color: "#666" }}>
            No adjustments needed. Gap is within $500 tolerance.
          </div>
        </div>
      ) : (
        <>
          <div style={{
            fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase",
            color: "#888", marginBottom: 12, paddingLeft: 2,
          }}>
            {isShortfall ? `${suggestions.length} Options to Close the Gap` : `${suggestions.length} Ways to Deploy Surplus`}
          </div>

          {suggestions.map((s, i) => (
            <div key={s.id} style={{
              background: "white", border: "1px solid #e0e0e0", borderRadius: 6,
              marginBottom: 10, overflow: "hidden",
              borderLeft: `3px solid ${s.closesGap ? "#1a6b3c" : "#e0a030"}`,
            }}>
              {/* Suggestion header */}
              <div style={{
                padding: "12px 16px",
                display: "flex", justifyContent: "space-between", alignItems: "flex-start",
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 16 }}>{s.icon}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#111" }}>
                      Option {i + 1}: {s.label}
                    </span>
                    {s.closesGap && (
                      <span style={{
                        fontSize: 8, fontWeight: 700, color: "#1a6b3c",
                        background: "#f0f9f4", border: "1px solid #b8dfc8",
                        padding: "2px 6px", borderRadius: 3, textTransform: "uppercase",
                        letterSpacing: "0.06em",
                      }}>
                        Closes Gap
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: "#555", lineHeight: 1.4, paddingLeft: 24 }}>
                    {s.description}
                  </div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0, paddingLeft: 16 }}>
                  <div style={{ fontSize: 8, color: "#888", textTransform: "uppercase", marginBottom: 2 }}>Impact</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#1a6b3c" }}>
                    {fmt$(s.impact)}
                  </div>
                </div>
              </div>

              {/* Detail rows */}
              {s.details.length > 0 && (
                <div style={{
                  borderTop: "1px solid #f0f0f0", padding: "8px 16px 10px",
                  display: "flex", gap: 20, flexWrap: "wrap", paddingLeft: 40,
                }}>
                  {s.details.map((d, j) => (
                    <div key={j} style={{ minWidth: 100 }}>
                      <div style={{ fontSize: 8, color: "#aaa", textTransform: "uppercase", letterSpacing: "0.04em" }}>{d.label}</div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "#333" }}>{d.value}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}

          {/* ── COMBINATION SUGGESTION ── */}
          {isShortfall && suggestions.length >= 2 && !suggestions[0]?.closesGap && (
            <div style={{
              background: "#fffbf0", border: "1px solid #e0d0a0", borderRadius: 6,
              padding: "14px 16px", marginTop: 16,
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#5a3a00", marginBottom: 6 }}>
                💡 Combination Strategy
              </div>
              <div style={{ fontSize: 11, color: "#666", lineHeight: 1.5 }}>
                {(() => {
                  let remaining = Math.abs(gap);
                  const combo = [];
                  for (const s of suggestions) {
                    if (remaining <= 0) break;
                    const use = Math.min(s.impact, remaining);
                    combo.push({ label: s.label, amount: use });
                    remaining -= use;
                  }
                  return (
                    <>
                      No single option closes the {fmt$(Math.abs(gap))} gap, but combining moves can:
                      <div style={{ marginTop: 8 }}>
                        {combo.map((c, i) => (
                          <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", maxWidth: 400 }}>
                            <span>• {c.label}</span>
                            <span style={{ fontWeight: 600, color: "#5a3a00" }}>{fmt$(c.amount)}</span>
                          </div>
                        ))}
                        <div style={{
                          display: "flex", justifyContent: "space-between", padding: "6px 0 0",
                          borderTop: "1px solid #e0d0a0", marginTop: 4, maxWidth: 400,
                          fontWeight: 700, color: remaining <= 0 ? "#1a6b3c" : "#8B2500",
                        }}>
                          <span>{remaining <= 0 ? "✓ Gap Closed" : "Remaining Gap"}</span>
                          <span>{remaining <= 0 ? fmt$(Math.abs(gap)) : fmt$(remaining)}</span>
                        </div>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── KEY CONSTRAINTS ── */}
      <div style={{
        background: "#fafaf8", border: "1px solid #e8e8e8", borderRadius: 6,
        padding: "14px 16px", marginTop: 24,
      }}>
        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#888", marginBottom: 10 }}>
          Key Constraints & Limits
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          {[
            { label: "Max Loan (DSCR)", value: fmt$(Math.floor(result.maxLoanFromDSCR)), note: `@ ${result.dscr.toFixed(2)}x / ${fmtPct(result.rate)} / ${result.amort}yr` },
            { label: "Loan Headroom", value: fmt$(Math.max(0, result.loanHeadroom)), note: result.loanHeadroom > 0 ? "Available" : "Maxed out" },
            { label: "Dev Fee", value: fmt$(result.devFee), note: `Cash: ${fmtPct(result.cashFeePct)} / DDF: ${fmtPct(1 - result.cashFeePct)}` },
            { label: "Total Credits", value: fmt$((result.lihtc.annualCredit || 0) * 10), note: `${fmt$(result.lihtc.annualCredit || 0)}/yr × 10` },
            { label: "Equity Raised", value: fmt$(result.fedEquity), note: `@ $${(result.lihtcInputs.investor_price || 0).toFixed(2)} pricing` },
            { label: "Bond Test", value: fmtPct(result.lihtc.bondPct), note: result.lihtc.bondTestPass ? "✓ Passing" : "✗ Failing" },
          ].map((m, i) => (
            <div key={i} style={{ padding: "6px 0" }}>
              <div style={{ fontSize: 8, color: "#aaa", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 2 }}>{m.label}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#111" }}>{m.value}</div>
              <div style={{ fontSize: 9, color: "#888", marginTop: 1 }}>{m.note}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
