/**
 * LihtcContext.jsx
 * 
 * Central state manager for the LIHTC Engine.
 * 
 * RESPONSIBILITIES:
 *   - Holds all module input states in memory (React state)
 *   - Auto-saves working state to Supabase when user navigates between tabs
 *   - Loads working state from Supabase on initial app load
 *   - Exposes updateModule() for any component to write input changes
 *   - Exposes saveNamedVersion() to snapshot the current state
 *   - Exposes compareVersions() to diff two locked versions
 * 
 * AUTO-SAVE TRIGGER:
 *   The consumer (App.jsx) calls notifyTabChange(newTab) whenever the
 *   active tab changes. This is the single trigger for all saves.
 *   No timers, no blur handlers — just tab navigation.
 * 
 * DATA FLOW:
 *   User edits input
 *     → updateModule('budget', { ...newBudgetInputs })
 *     → stored in moduleStates (React state, in memory only)
 *   
 *   User clicks a different tab
 *     → App.jsx calls notifyTabChange('lihtc')
 *     → context calls lihtc_save_working_state() in Supabase
 *     → module states persisted to lihtc_module_states table
 *     → setSaveStatus('saved') → UI shows "Saved"
 */

import { createContext, useContext, useReducer, useCallback, useRef, useEffect } from 'react'
import { supabase } from '../lib/supabase'

// ─────────────────────────────────────────────────────────────
// DEFAULT INPUT SHAPES
// These are the empty/default states for each module.
// Populated with Apollo SL seed values where known.
// ─────────────────────────────────────────────────────────────

const DEFAULT_MODULE_STATES = {
  unit_mix: {
    county: 'Snohomish',
    ami_year: 2025,
    vacancy_rate: 0.05,
    units: [
      { unit_type: 'Studio', count: 12, avg_sf: null, ami_level: 50, modeled_ua: 17, subsidy: null },
      { unit_type: '1 BR',   count: 112, avg_sf: null, ami_level: 60, modeled_ua: 20, subsidy: null },
      { unit_type: '2 BR',   count: 51,  avg_sf: null, ami_level: 60, modeled_ua: 24, subsidy: null },
    ],
    ami_limits: {
      studio: { 30: 825,  40: 1100, 50: 1375, 60: 1650 },
      '1br':  { 30: 884,  40: 1178, 50: 1473, 60: 1767 },
      '2br':  { 30: 1061, 40: 1414, 50: 1767, 60: 2121 },
      '3br':  { 30: 1226, 40: 1634, 50: 2042, 60: 2451 },
    },
    other_income: [
      { name: 'Laundry', annual_amount: 0 },
    ],
    opex: {
      management_fee_pct: 0.06,
      payroll: 394000,
      admin: 76940,
      utilities: 337604,
      maintenance: 146274,
      insurance: 0,
      real_estate_taxes: 0,
      replacement_reserve_per_unit: 300,
      operating_reserve_months: 6,
    },
  },

  budget: {
    acquisition: {
      land_purchase: 4400000,
      closing_costs: 88000,
      other: 0,
    },
    hard_costs: {
      residential: 31200000,
      parking: 1500000,
      site_work: 0,
      environmental: 0,
      ffe: 300000,
      demolition: 50000,
      contingency_pct: 0.05,
      sales_tax_pct: 0.106,
      bond_premium: 300000,
      other_lines: [],
    },
    soft_costs: {
      architect: 1175000,
      engineering: 600000,
      appraisal: 5000,
      market_study: 4500,
      environmental_assessment: 5000,
      geotech: 30000,
      survey: 12000,
      legal_real_estate: 50000,
      project_mgmt: 300000,
      other_consultants: 277500,
      contingency_pct: 0.10,
      permits_fees_hookups: 1011715,
      impact_fees: 1300000,
      other_lines: [],
    },
    financing: {
      construction_origination_pct: 0.01,
      perm_origination_pct: 0.01,
      // These two are overwritten by construction_cf module after convergence:
      construction_interest_estimate: 3164218,
      leaseup_interest_estimate: 1987588,
      wshfc_bond_costs: 432191,
      bond_legal: 85000,
      lihtc_issuance_fee: 145825,
      construction_lender_expenses: 65000,
      construction_loan_legal: 75000,
      equity_dd_fees: 50000,
      other_lines: [],
    },
    org_costs: {
      total: 2794506,
    },
    developer_fee: {
      total_fee: 8846690,
      cash_fee: 2919408,
      deferred_fee: 5927282,
    },
  },

  lihtc: {
    credit_type: '4%',
    allocation_year: null,
    placed_in_service_year: null,
    applicable_percentage_fixed: null,
    applicable_percentage_floating: 1.0,
    lock_rate: false,
    lock_date: null,
    basis_boost_pct: 1.30,
    basis_boost_applies: true,
    applicable_fraction_units: 1.0,
    applicable_fraction_sf: 1.0,
    non_basis_costs: 6527411,
    historic_credit_reduction: 0,
    federal_grants: 0,
    excess_costs_over_hfa_limits: 0,
    investor_price_per_credit: 0.92,
    credit_period_years: 10,
    compliance_period_years: 15,
    extended_use_years: 30,
    state_credit: { applies: false, amount: 0, price: 0 },
  },

  debt: {
    construction_loan: {
      lender: 'TBD',
      te_loan_amount: 32941402,
      taxable_loan_amount: 17814416,
      rate_type: 'fixed',
      te_rate: 0.0585,
      taxable_rate: 0.0585,
      floor_rate: null,
      term_months: 36,
      origination_fee_pct: 0.01,
      commitment_fee: null,
      exit_fee: null,
      max_ltc_pct: 0.82,
      extension_options: null,
      extension_fee: null,
    },
    permanent_loan: {
      lender: null,
      lender_type: null,
      program: null,
      loan_amount: 34049115,
      rate: 0.0585,
      amortization_years: 40,
      term_years: 15,
      origination_fee_pct: 0.01,
      min_dscr: 1.15,
      max_ltv_pct: null,
      mip_annual: null,
      prepayment_terms: null,
      recourse: null,
      assumable: null,
    },
    soft_debt: [
      { name: 'Seller Note',  amount: 1000000, rate: 0, payment_type: 'deferred', term_years: null, amortization_years: null, origination_fee: 0 },
      { name: 'CHIP',         amount: 900000,  rate: 0, payment_type: 'deferred', term_years: null, amortization_years: null, origination_fee: 0 },
      { name: 'Sponsor Note', amount: 346031,  rate: 0, payment_type: 'deferred', term_years: null, amortization_years: null, origination_fee: 0 },
    ],
  },

  construction_cf: {
    construction_period_months: 24,
    leaseup_period_months:      7,
    stabilized_months:          4,
    construction_start_date:    '2026-11-21',
    draw_curve_hard_costs:      'medium',
    draw_curve_soft_costs:      'flat',
    custom_draw_schedule:       null,
    te_rate:                    0.0585,
    taxable_rate:               0.0585,
    te_loan_override:           null,
    taxable_loan_override:      null,
    closing_soft_pct:           0.27,
    closing_org_pct:            0.30,
    closing_dev_fee_pct:        0.25,
    sources: [
      { name: 'Tax Exempt Construction Loan',  mode: 'loan',      priority: null, amount: 32941402, schedule: null },
      { name: 'Taxable Construction Loan',      mode: 'loan',      priority: null, amount: 17814416, schedule: null },
      { name: 'LIHTC Equity – M0 (Closing)',    mode: 'flex',      priority: 1,    amount: 2420213,  schedule: null },
      { name: 'LIHTC Equity – Later Tranches',  mode: 'scheduled', priority: null, amount: 21781914, schedule: [{ month: 12, amount: 10890957 }, { month: 24, amount: 10890957 }] },
      { name: 'CHIP',                           mode: 'flex',      priority: 2,    amount: 900000,   schedule: null },
      { name: 'Sponsor Note',                   mode: 'flex',      priority: 3,    amount: 346031,   schedule: null },
      { name: 'Seller Note',                    mode: 'scheduled', priority: null, amount: 1000000,  schedule: [{ month: 0, amount: 1000000 }] },
      { name: 'Deferred Developer Fee',         mode: 'scheduled', priority: null, amount: 5927282,  schedule: [{ month: 36, amount: 5927282 }] },
      { name: 'Permanent Amortizing Loan',      mode: 'scheduled', priority: null, amount: 34049115, schedule: [{ month: 36, amount: 34049115 }] },
    ],
    convergence: {
      max_iterations: 50,
      tolerance_dollars: 1.00,
      last_run_iterations: null,
      last_run_delta: null,
      converged: false,
    },
    fifty_pct_test: {
      track: true,
      qualified_basis: 61247210,
    },
    wshfc_fee_rate: 0.00175,
  },
}

// ─────────────────────────────────────────────────────────────
// REDUCER
// Handles state transitions cleanly and predictably.
// ─────────────────────────────────────────────────────────────

const ACTIONS = {
  LOAD_FROM_DB:       'LOAD_FROM_DB',
  UPDATE_MODULE:      'UPDATE_MODULE',
  SET_SCENARIO:       'SET_SCENARIO',
  SET_SAVE_STATUS:    'SET_SAVE_STATUS',
  SET_VERSIONS:       'SET_VERSIONS',
  SET_DIRTY:          'SET_DIRTY',
}

function reducer(state, action) {
  switch (action.type) {

    case ACTIONS.LOAD_FROM_DB:
      // Merge DB-loaded states over defaults (DB wins for any key present)
      return {
        ...state,
        moduleStates: {
          ...DEFAULT_MODULE_STATES,
          ...action.payload.moduleStates,
        },
        workingVersionId: action.payload.workingVersionId,
        isLoaded: true,
        isDirty: false,
      }

    case ACTIONS.UPDATE_MODULE:
      // Deep merge the patch into the named module's state
      return {
        ...state,
        moduleStates: {
          ...state.moduleStates,
          [action.payload.module]: {
            ...state.moduleStates[action.payload.module],
            ...action.payload.patch,
          },
        },
        isDirty: true,
      }

    case ACTIONS.SET_SCENARIO:
      return {
        ...state,
        scenarioId: action.payload.scenarioId,
        scenarioName: action.payload.scenarioName,
        dealName: action.payload.dealName,
        isLoaded: false,
      }

    case ACTIONS.SET_SAVE_STATUS:
      return { ...state, saveStatus: action.payload }

    case ACTIONS.SET_VERSIONS:
      return { ...state, versions: action.payload }

    case ACTIONS.SET_DIRTY:
      return { ...state, isDirty: action.payload }

    default:
      return state
  }
}

const initialState = {
  // Identity
  scenarioId:      'a1000000-0000-0000-0000-000000000001', // Apollo SL Base Case
  scenarioName:    'Base Case',
  dealName:        'Apollo Scriber Lake',
  workingVersionId: null,

  // All module inputs — lives in memory, persisted on tab change
  moduleStates: DEFAULT_MODULE_STATES,

  // UI state
  isLoaded:    false,   // true after initial DB load completes
  isDirty:     false,   // true if any module changed since last save
  saveStatus:  'idle',  // 'idle' | 'saving' | 'saved' | 'error'

  // Version history (loaded on demand)
  versions: [],
}

// ─────────────────────────────────────────────────────────────
// CONTEXT
// ─────────────────────────────────────────────────────────────

const LihtcContext = createContext(null)

export function LihtcProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState)

  // Track the previous tab so we know what was left when navigating away
  const previousTabRef = useRef(null)

  // ── LOAD WORKING STATE FROM DB ────────────────────────────
  // Called once on mount (and again if scenarioId changes).
  // Fetches the working version's module states from Supabase
  // and merges them over defaults.
  const loadWorkingState = useCallback(async (scenarioId) => {
    try {
      // Find the working version for this scenario
      const { data: versionRows, error: vErr } = await supabase
        .from('lihtc_versions')
        .select('id')
        .eq('scenario_id', scenarioId)
        .eq('is_working', true)
        .limit(1)

      if (vErr) throw vErr

      if (!versionRows || versionRows.length === 0) {
        // No working version yet — start fresh from defaults
        dispatch({ type: ACTIONS.LOAD_FROM_DB, payload: { moduleStates: {}, workingVersionId: null } })
        return
      }

      const workingVersionId = versionRows[0].id

      // Fetch all module states for this working version
      const { data: moduleRows, error: mErr } = await supabase
        .from('lihtc_module_states')
        .select('module, inputs')
        .eq('version_id', workingVersionId)

      if (mErr) throw mErr

      // Convert array of rows into { module_name: inputs } map
      const moduleStates = {}
      for (const row of (moduleRows || [])) {
        moduleStates[row.module] = row.inputs
      }

      dispatch({
        type: ACTIONS.LOAD_FROM_DB,
        payload: { moduleStates, workingVersionId },
      })
    } catch (err) {
      console.error('[LihtcContext] Failed to load working state:', err)
      // Fall back to defaults so the app still renders
      dispatch({ type: ACTIONS.LOAD_FROM_DB, payload: { moduleStates: {}, workingVersionId: null } })
    }
  }, [])

  // Load on mount
  useEffect(() => {
    loadWorkingState(state.scenarioId)
  }, [state.scenarioId, loadWorkingState])

  // ── AUTO-SAVE WORKING STATE ───────────────────────────────
  // Called by App.jsx via notifyTabChange().
  // Serializes all module states and calls the DB function.
  const saveWorkingState = useCallback(async () => {
    if (!state.isDirty) return   // nothing changed, skip the round-trip

    dispatch({ type: ACTIONS.SET_SAVE_STATUS, payload: 'saving' })

    try {
      const { error } = await supabase.rpc('lihtc_save_working_state', {
        p_scenario_id: state.scenarioId,
        p_modules: state.moduleStates,
      })

      if (error) throw error

      dispatch({ type: ACTIONS.SET_SAVE_STATUS, payload: 'saved' })
      dispatch({ type: ACTIONS.SET_DIRTY, payload: false })

      // Reset status back to idle after 2 seconds
      setTimeout(() => {
        dispatch({ type: ACTIONS.SET_SAVE_STATUS, payload: 'idle' })
      }, 2000)

    } catch (err) {
      console.error('[LihtcContext] Auto-save failed:', err)
      dispatch({ type: ACTIONS.SET_SAVE_STATUS, payload: 'error' })
    }
  }, [state.isDirty, state.scenarioId, state.moduleStates])

  // ── UPDATE A MODULE ───────────────────────────────────────
  // Components call this to write any input change into state.
  // Accepts a partial patch — only the keys you pass get merged.
  //
  // Usage:
  //   updateModule('budget', { hard_costs: { residential: 33000000 } })
  //   updateModule('debt', { permanent_loan: { rate: 0.0625 } })
  const updateModule = useCallback((module, patch) => {
    dispatch({ type: ACTIONS.UPDATE_MODULE, payload: { module, patch } })
  }, [])

  // ── TAB CHANGE NOTIFICATION ───────────────────────────────
  // App.jsx calls this when the active tab changes.
  // This is the ONLY auto-save trigger in the system.
  //
  // Usage in App.jsx:
  //   const { notifyTabChange } = useLihtc()
  //   const handleTabChange = (newTab) => {
  //     notifyTabChange(newTab)
  //     setActiveTab(newTab)
  //   }
  const notifyTabChange = useCallback((newTab) => {
    previousTabRef.current = newTab
    saveWorkingState()
  }, [saveWorkingState])

  // ── SAVE NAMED VERSION ────────────────────────────────────
  // Creates an immutable snapshot of the current working state.
  // Called explicitly by the user via a "Save Version" button.
  //
  // Usage:
  //   saveNamedVersion('v1.2 - GC hard cost revision', 'Updated after GC pricing call')
  const saveNamedVersion = useCallback(async (label, notes = '') => {
    // First flush the latest working state to DB
    await saveWorkingState()

    // Build the summary object from current computed values
    // (caller can pass in computed outputs, or we derive from inputs)
    const summary = {
      tdc: computeTDC(state.moduleStates.budget),
      saved_at: new Date().toISOString(),
    }

    const { data, error } = await supabase.rpc('lihtc_create_named_version', {
      p_scenario_id: state.scenarioId,
      p_label:       label,
      p_notes:       notes,
      p_saved_by:    'Jamie',
      p_summary:     summary,
    })

    if (error) {
      console.error('[LihtcContext] Failed to create named version:', error)
      return { success: false, error }
    }

    // Refresh the version list
    await loadVersions()

    return { success: true, versionId: data }
  }, [state.scenarioId, state.moduleStates, saveWorkingState])

  // ── LOAD VERSION LIST ─────────────────────────────────────
  // Fetches all named (locked) versions for the current scenario.
  const loadVersions = useCallback(async () => {
    const { data, error } = await supabase
      .from('lihtc_versions')
      .select('id, version_number, label, notes, saved_at, saved_by, summary, is_working, is_locked')
      .eq('scenario_id', state.scenarioId)
      .order('version_number', { ascending: false })

    if (error) {
      console.error('[LihtcContext] Failed to load versions:', error)
      return
    }

    dispatch({ type: ACTIONS.SET_VERSIONS, payload: data || [] })
  }, [state.scenarioId])

  // ── RESTORE A VERSION ─────────────────────────────────────
  // Loads a named version's inputs into the working state.
  // Does NOT overwrite the named version — creates a copy in working.
  const restoreVersion = useCallback(async (versionId) => {
    const { data: moduleRows, error } = await supabase
      .from('lihtc_module_states')
      .select('module, inputs')
      .eq('version_id', versionId)

    if (error) {
      console.error('[LihtcContext] Failed to restore version:', error)
      return
    }

    const moduleStates = {}
    for (const row of (moduleRows || [])) {
      moduleStates[row.module] = row.inputs
    }

    dispatch({
      type: ACTIONS.LOAD_FROM_DB,
      payload: { moduleStates, workingVersionId: state.workingVersionId },
    })

    // Mark dirty so the restored state gets saved to working slot
    dispatch({ type: ACTIONS.SET_DIRTY, payload: true })
    await saveWorkingState()

  }, [state.workingVersionId, saveWorkingState])

  // ── COMPARE TWO VERSIONS ──────────────────────────────────
  // Returns a structured diff between two version IDs.
  // Checks cache first (lihtc_version_diffs), computes if missing.
  const compareVersions = useCallback(async (fromVersionId, toVersionId) => {
    // Check diff cache
    const { data: cached } = await supabase
      .from('lihtc_version_diffs')
      .select('diff, impact_chain')
      .eq('from_version', fromVersionId)
      .eq('to_version', toVersionId)
      .limit(1)

    if (cached && cached.length > 0) {
      return cached[0]
    }

    // Not cached — load both versions and compute diff
    const [fromRes, toRes] = await Promise.all([
      supabase.from('lihtc_module_states').select('module, inputs').eq('version_id', fromVersionId),
      supabase.from('lihtc_module_states').select('module, inputs').eq('version_id', toVersionId),
    ])

    if (fromRes.error || toRes.error) {
      console.error('[LihtcContext] Failed to load versions for diff')
      return null
    }

    const fromMap = Object.fromEntries((fromRes.data || []).map(r => [r.module, r.inputs]))
    const toMap   = Object.fromEntries((toRes.data  || []).map(r => [r.module, r.inputs]))

    const diff = computeDiff(fromMap, toMap)

    // Cache the diff
    await supabase.from('lihtc_version_diffs').upsert({
      scenario_id:  state.scenarioId,
      from_version: fromVersionId,
      to_version:   toVersionId,
      diff,
      impact_chain: null, // impact chain computed in a future iteration
    })

    return { diff, impact_chain: null }
  }, [state.scenarioId])

  // ─────────────────────────────────────────────────────────
  // EXPOSE
  // ─────────────────────────────────────────────────────────
  const value = {
    // State
    scenarioId:      state.scenarioId,
    scenarioName:    state.scenarioName,
    dealName:        state.dealName,
    moduleStates:    state.moduleStates,
    isLoaded:        state.isLoaded,
    isDirty:         state.isDirty,
    saveStatus:      state.saveStatus,
    versions:        state.versions,

    // Actions
    updateModule,
    notifyTabChange,
    saveNamedVersion,
    loadVersions,
    restoreVersion,
    compareVersions,
  }

  return (
    <LihtcContext.Provider value={value}>
      {children}
    </LihtcContext.Provider>
  )
}

// ─────────────────────────────────────────────────────────────
// HOOK
// ─────────────────────────────────────────────────────────────

export function useLihtc() {
  const ctx = useContext(LihtcContext)
  if (!ctx) throw new Error('useLihtc must be used within a LihtcProvider')
  return ctx
}

// ─────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────

/** Quick TDC calculation for version summaries */
function computeTDC(budget) {
  if (!budget) return null
  try {
    const { acquisition, hard_costs, soft_costs, financing, org_costs, developer_fee } = budget
    const acq  = (acquisition?.land_purchase ?? 0) + (acquisition?.closing_costs ?? 0) + (acquisition?.other ?? 0)
    const hc   = (hard_costs?.residential ?? 0) + (hard_costs?.parking ?? 0) + (hard_costs?.ffe ?? 0) + (hard_costs?.demolition ?? 0)
    const sc   = Object.values(soft_costs ?? {}).reduce((s, v) => s + (typeof v === 'number' ? v : 0), 0)
    const fin  = (financing?.construction_interest_estimate ?? 0) + (financing?.leaseup_interest_estimate ?? 0) + (financing?.wshfc_bond_costs ?? 0) + (financing?.bond_legal ?? 0)
    const org  = org_costs?.total ?? 0
    const dev  = developer_fee?.total_fee ?? 0
    return acq + hc + sc + fin + org + dev
  } catch {
    return null
  }
}

/**
 * Flat diff between two module state maps.
 * Returns { modules_changed: [...], [module]: { [key]: { from, to } } }
 */
function computeDiff(fromMap, toMap) {
  const allModules = new Set([...Object.keys(fromMap), ...Object.keys(toMap)])
  const diff = { modules_changed: [] }

  for (const module of allModules) {
    const from = fromMap[module] ?? {}
    const to   = toMap[module]   ?? {}
    const moduleDiff = flatDiffObjects(from, to, '')

    if (Object.keys(moduleDiff).length > 0) {
      diff.modules_changed.push(module)
      diff[module] = moduleDiff
    }
  }

  return diff
}

/** Recursively flatten and diff two objects, returning only changed paths */
function flatDiffObjects(from, to, prefix) {
  const changes = {}
  const allKeys = new Set([...Object.keys(from ?? {}), ...Object.keys(to ?? {})])

  for (const key of allKeys) {
    const path = prefix ? `${prefix}.${key}` : key
    const fVal = from?.[key]
    const tVal = to?.[key]

    if (typeof fVal === 'object' && fVal !== null && !Array.isArray(fVal)) {
      Object.assign(changes, flatDiffObjects(fVal, tVal, path))
    } else if (JSON.stringify(fVal) !== JSON.stringify(tVal)) {
      changes[path] = { from: fVal, to: tVal }
    }
  }

  return changes
}
