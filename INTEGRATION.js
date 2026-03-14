/**
 * ─────────────────────────────────────────────────────────────
 * LIHTC ENGINE — STATE MANAGER INTEGRATION GUIDE
 * How to wire LihtcContext into the existing App.jsx
 * ─────────────────────────────────────────────────────────────
 * 
 * FILES TO ADD:
 *   src/context/LihtcContext.jsx    ← the state manager
 *   src/components/SaveStatus.jsx   ← save indicator UI
 *   src/components/VersionPanel.jsx ← version history panel
 * 
 * FILES TO MODIFY:
 *   src/main.jsx  — wrap with <LihtcProvider>
 *   src/App.jsx   — wire notifyTabChange + add SaveStatus + VersionPanel
 *   (any module component) — call updateModule() instead of local state
 * ─────────────────────────────────────────────────────────────
 */


// ═════════════════════════════════════════════════════════════
// 1. src/main.jsx  — wrap the app with the provider
// ═════════════════════════════════════════════════════════════

/*
  BEFORE:
    import App from './App'
    createRoot(document.getElementById('root')).render(<App />)

  AFTER:
    import App from './App'
    import { LihtcProvider } from './context/LihtcContext'

    createRoot(document.getElementById('root')).render(
      <LihtcProvider>
        <App />
      </LihtcProvider>
    )
*/


// ═════════════════════════════════════════════════════════════
// 2. src/App.jsx  — wire tab change and add version panel
// ═════════════════════════════════════════════════════════════

/*
  ADD THESE IMPORTS:
    import { useLihtc } from './context/LihtcContext'
    import { SaveStatus } from './components/SaveStatus'
    import { VersionPanel } from './components/VersionPanel'

  ADD INSIDE THE App COMPONENT:
    const { notifyTabChange, isLoaded } = useLihtc()
    const [versionPanelOpen, setVersionPanelOpen] = useState(false)

  CHANGE THE TAB HANDLER:
    // BEFORE:
    const handleTabChange = (tab) => {
      setActiveTab(tab)
    }

    // AFTER:
    const handleTabChange = (tab) => {
      notifyTabChange(tab)   // ← triggers auto-save BEFORE switching tabs
      setActiveTab(tab)
    }

  ADD LOADING GUARD (optional but clean):
    if (!isLoaded) return <LoadingSpinner />

  ADD TO THE HEADER/NAV (wherever the tab bar lives):
    <SaveStatus />
    <button onClick={() => setVersionPanelOpen(true)}>
      Versions
    </button>

  ADD BEFORE THE CLOSING </div> OF THE APP:
    <VersionPanel
      isOpen={versionPanelOpen}
      onClose={() => setVersionPanelOpen(false)}
    />
*/


// ═════════════════════════════════════════════════════════════
// 3. Module components — reading and writing inputs
// ═════════════════════════════════════════════════════════════

/*
  HOW TO READ INPUTS IN A MODULE COMPONENT (e.g. UnitMix.jsx):

    import { useLihtc } from '../context/LihtcContext'

    export function UnitMix() {
      const { moduleStates, updateModule } = useLihtc()
      const inputs = moduleStates.unit_mix

      // All your existing computed values still work — just read from `inputs`
      const totalUnits = inputs.units.reduce((sum, u) => sum + u.count, 0)

      ...
    }

  HOW TO WRITE AN INPUT CHANGE:

    // Single field change
    const handleVacancyChange = (e) => {
      updateModule('unit_mix', { vacancy_rate: parseFloat(e.target.value) })
    }

    // Nested field change (spread the parent object)
    const handleHardCostChange = (e) => {
      updateModule('budget', {
        hard_costs: {
          ...moduleStates.budget.hard_costs,
          residential: parseFloat(e.target.value),
        }
      })
    }

    // Array update (e.g. changing one unit row)
    const handleUnitCountChange = (index, newCount) => {
      const updatedUnits = inputs.units.map((u, i) =>
        i === index ? { ...u, count: newCount } : u
      )
      updateModule('unit_mix', { units: updatedUnits })
    }

  WHAT NOT TO DO:
    // Don't use local useState for inputs that need to be versioned
    const [residential, setResidential] = useState(31200000)  // ❌

    // Do use moduleStates + updateModule instead
    const residential = moduleStates.budget.hard_costs.residential  // ✓
*/


// ═════════════════════════════════════════════════════════════
// 4. Construction CF convergence — writing results back
// ═════════════════════════════════════════════════════════════

/*
  After the convergence loop runs in your calculation engine,
  write the final interest values back to the budget module
  so TDC stays current:

    const { updateModule } = useLihtc()

    const handleConvergenceComplete = (result) => {
      // Update construction_cf with convergence metadata
      updateModule('construction_cf', {
        convergence: {
          ...moduleStates.construction_cf.convergence,
          last_run_iterations: result.iterations,
          last_run_delta: result.finalDelta,
          converged: result.converged,
        }
      })

      // Write the real interest figures back to the static budget
      updateModule('budget', {
        financing: {
          ...moduleStates.budget.financing,
          construction_interest_estimate: result.constructionInterest,
          leaseup_interest_estimate: result.leaseupInterest,
        }
      })
    }

  This is the one controlled feedback loop in the system —
  Module 2B writes its output into Module 2A's inputs.
  When the user saves a version, both modules are captured
  with the post-convergence values, so restoring a version
  restores the correct interest figures too.
*/


// ═════════════════════════════════════════════════════════════
// 5. Module name reference
// ═════════════════════════════════════════════════════════════

/*
  MODULE NAME       WHAT IT HOLDS
  ─────────────     ──────────────────────────────────────────
  unit_mix          Units, rents, AMI limits, OPEX
  budget            Acquisition, hard/soft/financing costs, dev fee
  lihtc             Credit type, basis, applicable %, investor price
  debt              Construction loan, perm loan, soft debt stack
  construction_cf   Monthly cash flow inputs, source waterfall, convergence
*/
