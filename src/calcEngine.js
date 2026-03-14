/**
 * calcEngine.js — LIHTC Iterative Calculation Engine
 *
 * Resolves circular dependencies in the development budget by iterating
 * until all computed values converge. The circulars are:
 *
 *   1. Construction Interest — depends on total monthly spend, which includes
 *      construction interest itself.
 *   2. Developer Fee — capped at 15% of TDC excluding DDF, but dev fee is
 *      part of TDC.
 *   3. Construction Loan Origination Fee — % of const loan, const loan depends
 *      on TDC (LTC).
 *   4. Perm Loan Origination Fee — % of perm loan, perm loan depends on NOI
 *      which is fixed, so this one doesn't iterate, just calculates.
 *   5. WSHFC Fees — % of const loan or bond amount.
 *
 * Algorithm:
 *   - Start with input-only items summed as a "seed TDC"
 *   - Compute CALC items from that seed
 *   - Re-sum TDC with CALC items included
 *   - Repeat until TDC delta < $1 (typically 3-6 iterations)
 *
 * Returns: { calcValues, tdc, eligibleBasis, converged, iterations }
 *   calcValues: { [calc_key]: number } — final computed amounts
 */

/**
 * Main entry point.
 *
 * @param {Array}  budgetItems  - dev_budget_items rows (or equivalent objects)
 *                               Each item: { calc_type, calc_key, amount, in_basis, category }
 * @param {Object} assumptions  - dev_budget_assumptions row
 * @param {Object} permDebtFA   - financial assumptions for perm debt (loan_amount, interest_rate, amort_years)
 * @param {number} totalUnits   - total residential units (for per-unit checks)
 */
export function runCalcEngine(budgetItems, assumptions, permDebtFA, totalUnits = 175) {
  if (!budgetItems || budgetItems.length === 0) return null;
  if (!assumptions) return null;

  const assump = { ...DEFAULT_ASSUMP, ...assumptions };

  // ── Unpack assumptions ──────────────────────────────────────────────────────
  const constLoanLTC        = Number(assump.const_loan_ltc)      || 0.65;
  const constLoanRate       = Number(assump.const_loan_rate)     || 0.065;
  const constLoanMonths     = Number(assump.const_loan_months)   || 24;
  const constOrigPct        = Number(assump.const_loan_orig_pct) || 0.01;
  const permOrigPct         = Number(assump.perm_orig_fee_pct)   || 0.01;
  const wshfcFeePct         = Number(assump.wshfc_fee_pct)       || 0.0025;
  const totalDevFeePct      = Number(assump.total_dev_fee_pct)   || 0.15;
  const cashFeePct          = Number(assump.cash_fee_pct)        || 0.50;
  const deferredFeePct      = Number(assump.deferred_fee_pct)    || 0.50;
  const escalationEnabled   = Boolean(assump.escalation_enabled);
  const escalationRate      = Number(assump.escalation_rate)     || 0.02;
  const baseYear            = Number(assump.base_year)           || 2026;
  const targetYear          = Number(assump.target_year)         || 2026;
  const leaseUpMonths       = Number(assump.leaseup_months) || 6;

  // Perm loan from financial assumptions
  const permLoanAmount = Number(permDebtFA?.loan_amount) || 0;

  // Escalation multiplier
  const escalMult = escalationEnabled && targetYear > baseYear
    ? Math.pow(1 + escalationRate, targetYear - baseYear)
    : 1.0;

  // ── Separate INPUT items from CALC items ───────────────────────────────────
  const inputItems = budgetItems.filter(i => (i.calc_type || i.calcType || "input") === "input");
  const calcItems  = budgetItems.filter(i => (i.calc_type || i.calcType || "input") === "calc");

  // Sum of all fixed (input) costs, optionally escalated
  // Dev fee items are CALC and excluded from input sum
  const inputTotal = inputItems.reduce((s, i) => {
    const amt = Number(i.amount) || 0;
    const isHardCost = (i.category || "") === "hard_costs";
    return s + (escalationEnabled && isHardCost ? amt * escalMult : amt);
  }, 0);

  // ── Iterative solver ────────────────────────────────────────────────────────
  const MAX_ITERS  = 25;
  const TOLERANCE  = 1.0; // converge when TDC delta < $1

  let tdc      = inputTotal; // seed
  let calcVals = {};
  let iters    = 0;
  let converged = false;

  for (let iter = 0; iter < MAX_ITERS; iter++) {
    iters = iter + 1;
    const prevTdc = tdc;

    // ─── Step 1: Construction loan ──────────────────────────────────────────
    // Const loan = TDC × LTC (excluding dev fee and reserves from collateral base,
    // but for simplicity use total TDC × LTC as the standard approach)
    const constLoanAmount = tdc * constLoanLTC;

    // ─── Step 2: Construction loan origination fee ──────────────────────────
    const constOrigFee = constLoanAmount * constOrigPct;

    // ─── Step 3: WSHFC fee (% of const loan) ────────────────────────────────
    const wshfcFee = constLoanAmount * wshfcFeePct;

    // ─── Step 4: Perm loan origination fee ──────────────────────────────────
    const permOrigFee = permLoanAmount * permOrigPct;

    // ─── Step 5: Construction interest (the big circular) ───────────────────
    // Standard S-curve approximation: average outstanding balance ≈ 50% of
    // max loan over the construction period. Max loan ≈ constLoanAmount.
    // Interest = constLoanAmount × 0.50 × (rate/12) × months
    // This matches the macro-paste approach: seed → compute → paste back.
    const constInterest = constLoanAmount * 0.50 * (constLoanRate / 12) * constLoanMonths;

    // ─── Step 6: Lease-up interest ──────────────────────────────────────────
    // Interest on the construction loan during the lease-up period before
    // perm conversion. Outstanding balance ≈ full loan amount (draws complete).
    const leaseUpInterest = constLoanAmount * (constLoanRate / 12) * leaseUpMonths;

    // ─── Step 7: Developer fee ──────────────────────────────────────────────
    // Rule: totalDevFee = totalDevFeePct × (TDC - deferredDevFee)
    // But deferredDevFee is part of TDC, so this is circular.
    // Solve algebraically:
    //   Let T  = TDC_ex_fee (TDC excluding all dev fee items)
    //   Let p  = totalDevFeePct (e.g. 0.15)
    //   Let dp = deferredFeePct (e.g. 0.50 of total fee)
    //   totalFee = p × (T + totalFee - deferredFee)   ... wait
    //
    // Actually the standard LIHTC convention:
    //   totalDevFee = p × TDC_ex_ddf
    //   where TDC_ex_ddf = TDC - deferredDevFee
    // Which means:
    //   TDC_ex_ddf = inputTotal + constOrigFee + wshfcFee + permOrigFee +
    //                constInterest + leaseUpInterest + cashDevFee
    //   totalFee = p × (TDC_ex_ddf)
    //   cashFee = totalFee × cashFeePct
    //   deferredFee = totalFee × deferredFeePct
    //   TDC = TDC_ex_ddf + deferredFee
    //
    // Closed-form solution:
    //   Let base = inputTotal + constOrigFee + wshfcFee + permOrigFee +
    //              constInterest + leaseUpInterest
    //   totalFee = p × (base + cashFee) = p × (base + totalFee × cashFeePct)
    //   totalFee × (1 - p × cashFeePct) = p × base
    //   totalFee = p × base / (1 - p × cashFeePct)
    const base = inputTotal + constOrigFee + wshfcFee + permOrigFee
                 + constInterest + leaseUpInterest;
    const totalDevFee   = (totalDevFeePct * base) / (1 - totalDevFeePct * cashFeePct);
    const cashDevFee    = totalDevFee * cashFeePct;
    const deferredDevFee = totalDevFee * deferredFeePct;

    // ─── Step 8: Recompute TDC ───────────────────────────────────────────────
    const newTdc = base + cashDevFee + deferredDevFee;

    // ─── Step 9: Check convergence ───────────────────────────────────────────
    calcVals = {
      const_orig_fee:   constOrigFee,
      perm_orig_fee:    permOrigFee,
      const_interest:   constInterest,
      leaseup_interest: leaseUpInterest,
      wshfc_fee:        wshfcFee,
      dev_fee_cash:     cashDevFee,
      dev_fee_deferred: deferredDevFee,
      // Derived totals (not line items, but useful for display)
      _constLoanAmount: constLoanAmount,
      _totalDevFee:     totalDevFee,
      _cashFeePct:      cashFeePct,
      _deferredFeePct:  deferredFeePct,
      _escalMult:       escalMult,
    };

    tdc = newTdc;

    if (Math.abs(newTdc - prevTdc) < TOLERANCE) {
      converged = true;
      break;
    }
  }

  // ── Final TDC and basis totals ───────────────────────────────────────────
  // Recompute with final calcVals applied to budget items
  const finalItems = budgetItems.map(item => {
    const key = item.calc_key || item.calcKey;
    if ((item.calc_type || item.calcType) === "calc" && key && calcVals[key] != null) {
      return { ...item, amount: calcVals[key] };
    }
    return item;
  });

  const eligibleBasis = finalItems
    .filter(i => i.in_basis !== false && i.basis !== false)
    .reduce((s, i) => s + (Number(i.amount) || 0), 0);

  const finalTdc = finalItems.reduce((s, i) => s + (Number(i.amount) || 0), 0);

  return {
    calcValues: calcVals,
    tdc: finalTdc,
    eligibleBasis,
    converged,
    iterations: iters,
    constLoanAmount: calcVals._constLoanAmount,
    totalDevFee: calcVals._totalDevFee,
  };
}

// Default assumption values (mirrors dev_budget_assumptions table defaults)
const DEFAULT_ASSUMP = {
  const_loan_ltc:       0.65,
  const_loan_rate:      0.065,
  const_loan_months:    24,
  leaseup_months:       6,
  const_loan_orig_pct:  0.01,
  perm_orig_fee_pct:    0.01,
  wshfc_fee_pct:        0.0025,
  total_dev_fee_pct:    0.15,
  cash_fee_pct:         0.50,
  deferred_fee_pct:     0.50,
  escalation_enabled:   false,
  escalation_rate:      0.02,
  base_year:            2026,
  target_year:          2026,
};

/**
 * Format helpers for assumption display
 */
export const ASSUMP_FIELDS = [
  // Construction loan
  { key: "const_loan_ltc",       label: "Const Loan LTC",         group: "const",  type: "pct",    step: 0.01,  min: 0.40, max: 0.90 },
  { key: "const_loan_rate",      label: "Const Loan Rate",         group: "const",  type: "pct",    step: 0.0025,min: 0.03, max: 0.12 },
  { key: "const_loan_months",    label: "Construction Period (mo)",group: "const",  type: "int",    step: 1,     min: 12,   max: 48   },
  { key: "const_loan_orig_pct",  label: "Const Orig Fee",          group: "const",  type: "pct",    step: 0.0025,min: 0,    max: 0.03 },
  // Perm loan
  { key: "perm_orig_fee_pct",    label: "Perm Orig Fee",           group: "perm",   type: "pct",    step: 0.0025,min: 0,    max: 0.03 },
  // WSHFC
  { key: "wshfc_fee_pct",        label: "WSHFC Fee",               group: "agency", type: "pct",    step: 0.0005,min: 0,    max: 0.02 },
  // Developer fee
  { key: "total_dev_fee_pct",    label: "Total Dev Fee Cap",        group: "devfee", type: "pct",    step: 0.005, min: 0.05, max: 0.15 },
  { key: "cash_fee_pct",         label: "Cash Portion",             group: "devfee", type: "pct",    step: 0.01,  min: 0.10, max: 0.90 },
  // Construction loan timing
  { key: "leaseup_months",       label: "Lease-Up Period (mo)",    group: "const",  type: "int",    step: 1,     min: 3,    max: 18   },
  // Cost escalation
  { key: "escalation_enabled",   label: "Cost Escalation",         group: "escal",  type: "bool"                                      },
  { key: "escalation_rate",      label: "Annual Escalation Rate",   group: "escal",  type: "pct",    step: 0.005, min: 0,    max: 0.08 },
  { key: "base_year",            label: "Base Year",               group: "escal",  type: "int",    step: 1,     min: 2020, max: 2035 },
  { key: "target_year",          label: "Target Year (Build)",     group: "escal",  type: "int",    step: 1,     min: 2020, max: 2040 },
];

export const ASSUMP_GROUPS = [
  { key: "const",   label: "Construction Loan",  color: "#1a3a6b" },
  { key: "perm",    label: "Perm Loan",           color: "#1a6b3c" },
  { key: "agency",  label: "Agency Fees",         color: "#8B2500" },
  { key: "devfee",  label: "Developer Fee",       color: "#5a3a00" },
  { key: "escal",   label: "Cost Escalation",     color: "#555"    },
];
