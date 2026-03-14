/**
 * db.js — LIHTC Engine data access layer v10
 */
import { supabase } from "./supabase.js";

export async function fetchProjects() {
  const { data, error } = await supabase
    .from("projects")
    .select("id, name, client_name, project_type, status, city, state, total_units, total_dev_cost, next_deadline, next_deadline_label")
    .eq("status", "active").order("name");
  if (error) throw error;
  return data;
}

export async function fetchScenarios(projectId) {
  const { data, error } = await supabase.from("lihtc_scenarios").select("*")
    .eq("project_id", projectId).order("is_base", { ascending: false }).order("created_at");
  if (error) throw error;
  return data;
}

export async function createScenario(projectId, name, description = "") {
  const { data, error } = await supabase.from("lihtc_scenarios")
    .insert({ project_id: projectId, name, description, created_by: "Jamie" }).select().single();
  if (error) throw error;
  return data;
}

export async function fetchFinancialAssumptions(projectId) {
  const { data, error } = await supabase.from("financial_assumptions").select("*")
    .eq("project_id", projectId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function upsertFinancialAssumptions(projectId, fields) {
  const { data, error } = await supabase.from("financial_assumptions")
    .upsert({ project_id: projectId, ...fields, updated_at: new Date().toISOString() }, { onConflict: "project_id" })
    .select().single();
  if (error) throw error;
  return data;
}

export async function fetchBudgetAssumptions(scenarioId) {
  const { data, error } = await supabase.from("dev_budget_assumptions").select("*")
    .eq("scenario_id", scenarioId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function upsertBudgetAssumptions(scenarioId, fields) {
  const { data, error } = await supabase.from("dev_budget_assumptions")
    .upsert({ scenario_id: scenarioId, ...fields, updated_at: new Date().toISOString() }, { onConflict: "scenario_id" })
    .select().single();
  if (error) throw error;
  return data;
}

export async function fetchBudgetItems(scenarioId) {
  const { data, error } = await supabase.from("dev_budget_items").select("*")
    .eq("scenario_id", scenarioId).order("category").order("sort_order");
  if (error) throw error;
  return data;
}

export async function updateBudgetItem(itemId, fields) {
  const { data, error } = await supabase.from("dev_budget_items")
    .update({ ...fields, updated_at: new Date().toISOString() }).eq("id", itemId).select().single();
  if (error) throw error;
  return data;
}

export async function insertBudgetItem(scenarioId, item) {
  const { data, error } = await supabase.from("dev_budget_items")
    .insert({ scenario_id: scenarioId, ...item }).select().single();
  if (error) throw error;
  return data;
}

export async function deleteBudgetItem(itemId) {
  const { error } = await supabase.from("dev_budget_items").delete().eq("id", itemId);
  if (error) throw error;
}

export async function replaceBudgetItems(scenarioId, items) {
  await supabase.from("dev_budget_items").delete().eq("scenario_id", scenarioId);
  if (items.length === 0) return [];
  const { data, error } = await supabase.from("dev_budget_items")
    .insert(items.map(it => ({ ...it, scenario_id: scenarioId }))).select();
  if (error) throw error;
  return data;
}

export async function fetchUnitMix(scenarioId) {
  const { data, error } = await supabase.from("unit_mix_rows").select("*")
    .eq("scenario_id", scenarioId).order("sort_order");
  if (error) throw error;
  return data;
}

export async function updateUnitMixRow(rowId, fields) {
  const { data, error } = await supabase.from("unit_mix_rows")
    .update({ ...fields, updated_at: new Date().toISOString() }).eq("id", rowId).select().single();
  if (error) throw error;
  return data;
}

export async function insertUnitMixRow(scenarioId, row) {
  const { data, error } = await supabase.from("unit_mix_rows")
    .insert({ scenario_id: scenarioId, ...row }).select().single();
  if (error) throw error;
  return data;
}

export async function deleteUnitMixRow(rowId) {
  const { error } = await supabase.from("unit_mix_rows").delete().eq("id", rowId);
  if (error) throw error;
}

// ── SCENARIO SOURCES ──────────────────────────────────────────────────────────

export async function fetchScenarioSources(scenarioId) {
  const { data, error } = await supabase.from("scenario_sources").select("*")
    .eq("scenario_id", scenarioId).order("sort_order");
  if (error) throw error;
  return data || [];
}

export async function upsertScenarioSource(scenarioId, source) {
  if (source.id) {
    const { data, error } = await supabase.from("scenario_sources")
      .update({ ...source, updated_at: new Date().toISOString() }).eq("id", source.id).select().single();
    if (error) throw error;
    return data;
  } else {
    const { data, error } = await supabase.from("scenario_sources")
      .insert({ scenario_id: scenarioId, ...source }).select().single();
    if (error) throw error;
    return data;
  }
}

export async function deleteScenarioSource(sourceId) {
  const { error } = await supabase.from("scenario_sources").delete().eq("id", sourceId);
  if (error) throw error;
}

// ── EQUITY TRANCHES ───────────────────────────────────────────────────────────

export async function fetchEquityTranches(scenarioId) {
  const { data, error } = await supabase.from("lihtc_equity_tranches").select("*")
    .eq("scenario_id", scenarioId).order("sort_order");
  if (error) throw error;
  return data || [];
}

export async function updateEquityTranche(trancheId, fields) {
  const { data, error } = await supabase.from("lihtc_equity_tranches")
    .update({ ...fields, updated_at: new Date().toISOString() }).eq("id", trancheId).select().single();
  if (error) throw error;
  return data;
}

// ── DEV FEE SCHEDULE ──────────────────────────────────────────────────────────

export async function fetchDevFeeSchedule(scenarioId) {
  const { data, error } = await supabase.from("dev_fee_schedule").select("*")
    .eq("scenario_id", scenarioId).order("sort_order");
  if (error) throw error;
  return data || [];
}

export async function updateDevFeeScheduleRow(rowId, fields) {
  const { data, error } = await supabase.from("dev_fee_schedule")
    .update({ ...fields, updated_at: new Date().toISOString() }).eq("id", rowId).select().single();
  if (error) throw error;
  return data;
}

// ── FULL SCENARIO LOAD ────────────────────────────────────────────────────────

export async function loadScenario(scenarioId) {
  const [
    { data: budgetItems,  error: e1 },
    { data: budgetAssump, error: e2 },
    { data: unitMix,      error: e3 },
    { data: tranches,     error: e4 },
    { data: sources,      error: e5 },
    { data: devFeeRows,   error: e6 },
  ] = await Promise.all([
    supabase.from("dev_budget_items").select("*").eq("scenario_id", scenarioId).order("category").order("sort_order"),
    supabase.from("dev_budget_assumptions").select("*").eq("scenario_id", scenarioId).maybeSingle(),
    supabase.from("unit_mix_rows").select("*").eq("scenario_id", scenarioId).order("sort_order"),
    supabase.from("lihtc_equity_tranches").select("*").eq("scenario_id", scenarioId).order("sort_order"),
    supabase.from("scenario_sources").select("*").eq("scenario_id", scenarioId).order("sort_order"),
    supabase.from("dev_fee_schedule").select("*").eq("scenario_id", scenarioId).order("sort_order"),
  ]);
  const err = e1 || e2 || e3 || e4 || e5 || e6;
  if (err) throw err;
  return {
    budgetItems:  budgetItems  || [],
    budgetAssump: budgetAssump || null,
    unitMix:      unitMix      || [],
    tranches:     tranches     || [],
    sources:      sources      || [],
    devFeeRows:   devFeeRows   || [],
  };
}

// ── Edge Function ─────────────────────────────────────────────────────────────
const EDGE_FN_URL = "https://kxgvdtzzupxnwzugurqv.supabase.co/functions/v1/lihtc-calc-engine";

export async function callCalcEngine(budgetItems, assumptions, permLoanAmount) {
  try {
    const res = await fetch(EDGE_FN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ budgetItems, assumptions, permLoanAmount }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    console.warn("Edge function unavailable, using client-side engine:", e.message);
    return null;
  }
}
