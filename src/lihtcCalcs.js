/**
 * lihtcCalcs.js
 *
 * Shared calculation functions for budget-derived figures and LIHTC credit math.
 * Used by TaxCredit (Module 3) and Debt (Module 4) to ensure a single source
 * of truth for TDC, eligible basis, aggregate basis, and equity raised.
 */

// ─────────────────────────────────────────────────────────────────────────────
// BUDGET CALCS
// Derives TDC, eligible basis, aggregate basis, and dev fee from the budget
// module's sections and assumptions. Replaces inline copies in TaxCredit
// and Debt modules.
// ─────────────────────────────────────────────────────────────────────────────

export function computeBudgetCalcs(budget, totalUnits = 175) {
  // Fallback defaults when budget module is not yet populated
  if (!budget?.sections || !budget?.assumptions) {
    return {
      tdc: 67824621,
      acqTotal: 4488000,
      eligibleBasis: null,
      aggregateBasis: null,
      deferredDevFee: 5927282,
      devFee: 8846690,
      subtotal: 58977931,
    };
  }

  const a = budget.assumptions;
  const s = budget.sections;

  // Acquisition
  const acqTotal = s.acquisition?.reduce((sum, l) => sum + (l.amount || 0), 0) || 4488000;

  // Hard costs — P&P Bond excluded from contingency/tax base
  const hcAllInputs = s.hard_costs?.filter(l => l.type === "input")
    .reduce((sum, l) => sum + (l.amount || 0), 0) || 0;
  const ppBond = s.hard_costs?.find(l =>
    l.label?.toLowerCase().includes("p&p") || l.label?.toLowerCase().includes("bond premium"));
  const ppBondAmt = ppBond?.type === "input" ? (ppBond?.amount || 0) : 0;
  const hcContBase = hcAllInputs - ppBondAmt;
  const hcCont = hcContBase * (a.hc_contingency_pct || 0);
  const hcTax = (hcContBase + hcCont) * (a.sales_tax_pct || 0);
  const hcTotal = hcAllInputs + hcCont + hcTax;

  // Soft costs
  const scInputs = s.soft_costs?.filter(l => l.type === "input")
    .reduce((sum, l) => sum + (l.amount || 0), 0) || 0;
  const scCont = scInputs * (a.sc_contingency_pct || 0);
  const scTotal = scInputs + scCont;

  // Financing
  const finInputs = s.financing?.filter(l => l.type === "input")
    .reduce((sum, l) => sum + (l.amount || 0), 0) || 0;
  const combinedCL = (a.const_loan_amount || 0) + (a.taxable_loan_amount || 0);
  const constOrig = combinedCL * (a.const_origination_pct || 0);
  const permOrig = (a.perm_loan_amount || 0) * (a.perm_origination_pct || 0);
  const constInt = a.const_interest_est || 0;
  const leaseupInt = a.leaseup_interest_est || 0;
  const finTotal = finInputs + constOrig + permOrig + constInt + leaseupInt;

  // Org / reserves
  const orgInputs = s.org_reserves?.filter(l => l.type === "input")
    .reduce((sum, l) => sum + (l.amount || 0), 0) || 0;
  const repRes = totalUnits * (a.rep_reserve_per_unit ?? 350);
  const opRes = a.op_reserve_fallback ?? 637500;
  const adsRes = a.ads_reserve_fallback ?? 1110159;
  const orgTotal = orgInputs + repRes + opRes + adsRes;

  // Subtotal and dev fee — dev fee is % of costs, NOT % of TDC
  const subtotal = acqTotal + hcTotal + scTotal + finTotal + orgTotal;
  const devFee = subtotal * (a.dev_fee_pct || 0.15);
  const tdc = subtotal + devFee;
  const deferredDevFee = devFee * (1 - (a.cash_fee_pct || 0.33));

  // ── Eligible Basis ──────────────────────────────────────────
  // Sum of in_basis lines + dev fee (dev fee 100% in eligible basis)
  const eligibleBasis = devFee + Object.values(s).flat().reduce((sum, l) => {
    if (!l.in_basis) return sum;
    let amt = l.amount || 0;
    if (l.type === 'pct_hc') amt = l.label?.toLowerCase().includes('tax') ? hcTax : hcCont;
    else if (l.type === 'pct_sc') amt = scCont;
    else if (l.type === 'pct_loan_const') amt = constOrig;
    else if (l.type === 'pct_loan_perm') amt = 0;
    else if (l.type === 'est_2b') amt = l.label?.toLowerCase().includes('lease') ? 0 : constInt;
    else if (['calc_opres', 'calc_repres', 'calc_adsres'].includes(l.type)) amt = 0;
    return sum + (isNaN(amt) ? 0 : amt);
  }, 0);

  // ── Aggregate Basis (Bond Test Denominator) ─────────────────
  // Sum of bond_basis lines + dev fee (dev fee 100% in bond basis)
  const aggregateBasis = devFee + Object.values(s).flat().reduce((sum, l) => {
    if (!l.bond_basis) return sum;
    let amt = l.amount || 0;
    if (l.type === 'pct_loan_const') amt = constOrig;
    else if (l.type === 'pct_loan_perm') amt = 0;
    else if (l.type === 'est_2b') amt = l.label?.toLowerCase().includes('lease') ? 0 : constInt;
    else if (l.type === 'pct_hc') amt = l.label?.toLowerCase().includes('tax') ? hcTax : hcCont;
    else if (l.type === 'pct_sc') amt = scCont;
    return sum + (isNaN(amt) ? 0 : amt);
  }, 0);

  // Section totals for Construction CF alignment
  const finLessInterest = finInputs + constOrig + permOrig; // financing without interest
  const cashDevFee = devFee * (a.cash_fee_pct || 0.33);

  return {
    tdc, acqTotal, eligibleBasis, aggregateBasis, deferredDevFee, devFee, subtotal,
    // Section totals (so Const CF matches TDC exactly)
    hcTotal, scTotal, finTotal, finLessInterest, orgTotal, cashDevFee,
    constInt, leaseupInt,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// LIHTC CREDIT WATERFALL
// Computes the full credit calculation from eligible basis through equity raised.
// ─────────────────────────────────────────────────────────────────────────────

export function computeLIHTC(inputs, budgetCalcs, totalUnits, teBondAmount) {
  const i = inputs;

  const tdc      = budgetCalcs?.tdc       ?? 67824621;
  const landCost = budgetCalcs?.acqTotal  ?? 4488000;

  // STEP 1 — Eligible Basis
  // If budget module has computed eligibleBasis from in_basis flags, use it directly.
  // Otherwise fall back to: TDC - land - non_basis_costs deductions (manual inputs).
  const _baseBasis = budgetCalcs?.eligibleBasis != null
    ? budgetCalcs.eligibleBasis
    : (tdc - landCost - (i.non_basis_costs || 0));
  const adjustedEligibleBasis = _baseBasis
    - (i.commercial_costs   || 0)
    - (i.federal_grants     || 0)
    - (i.historic_reduction || 0);

  // STEP 2 — Basis Boost
  const boostAmount  = i.basis_boost
    ? adjustedEligibleBasis * (i.boost_factor - 1)
    : 0;
  const boostedBasis = adjustedEligibleBasis + boostAmount;

  // STEP 3 — Qualified Basis
  const qualifiedBasis = boostedBasis * (i.applicable_fraction || 1);

  // STEP 4 — Annual Credit
  // 4% floor per CAA 2021 (IRC §42(b)(3)); 9% fixed per HERA 2008
  const effectiveRate = i.credit_type === "9pct"
    ? 0.09
    : Math.max(0.04, i.applicable_pct || 0.04);
  const annualCredit = qualifiedBasis * effectiveRate;

  // STEP 5 — 10-Year Credit
  const totalCredit = annualCredit * (i.credit_period || 10);

  // STEP 6 — Equity Raised
  const equityRaised = totalCredit * (i.investor_price || 0);

  // Bond test — use explicit teBondAmount if provided, else fall back to input
  const _teBond       = teBondAmount ?? i.te_bond_amount ?? 0;
  const aggregateBasis = budgetCalcs?.aggregateBasis || (tdc - landCost);
  const bondPct        = aggregateBasis > 0 ? _teBond / aggregateBasis : 0;
  const testThreshold  = (i.placed_in_service_year || 2028) > 2025 ? 0.25 : 0.50;
  const bondTestPass   = bondPct >= testThreshold;

  // Per unit
  const creditPerUnit = totalUnits > 0 ? annualCredit / totalUnits : 0;
  const equityPerUnit = totalUnits > 0 ? equityRaised / totalUnits : 0;

  // State credits
  const stateCreditTotal = i.state_credit_applies
    ? (i.state_credit_annual || 0) * (i.state_credit_period || 10)
    : 0;
  const stateEquity = stateCreditTotal * (i.state_credit_price || 0);

  return {
    tdc, landCost,
    adjustedEligibleBasis, boostAmount, boostedBasis,
    qualifiedBasis,
    effectiveRate, annualCredit,
    totalCredit, equityRaised,
    aggregateBasis, bondPct, testThreshold, bondTestPass,
    teBondAmount: _teBond,
    creditPerUnit, equityPerUnit,
    stateCreditTotal, stateEquity,
    totalEquity: equityRaised + stateEquity,
  };
}
