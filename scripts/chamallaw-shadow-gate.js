#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const { report, summarize } = require("./chamallaw-shadow-report.js");

function validTimestamp(value) {
  const time = Date.parse(value ?? "");
  return Number.isFinite(time) ? time : null;
}

function configErrors(config) {
  const errors = [];
  const period = config.comparison_period;
  if (config.schema_version !== 1) errors.push("schema_version must be 1");
  if (!period || typeof period !== "object") errors.push("comparison_period is required");
  const startsAt = validTimestamp(period?.starts_at);
  const endsAt = validTimestamp(period?.ends_at);
  const createdAt = validTimestamp(config.created_at);
  if (startsAt === null || endsAt === null || createdAt === null) {
    errors.push("created_at and comparison-period timestamps must be valid");
  } else if (!(createdAt <= startsAt && startsAt < endsAt)) {
    errors.push("created_at must precede the comparison period");
  }
  for (const name of ["minimum_observations", "minimum_calibration_observations"]) {
    if (!Number.isInteger(config[name]) || config[name] < 1) errors.push(`${name} must be >= 1`);
  }
  for (const name of ["maximum_brier_score", "maximum_mean_human_review_minutes"]) {
    if (typeof config[name] !== "number" || !Number.isFinite(config[name]) || config[name] < 0) {
      errors.push(`${name} must be a non-negative number`);
    }
  }
  for (const name of ["require_zero_routing_changes", "require_zero_mutation_tool_violations"]) {
    if (typeof config[name] !== "boolean") errors.push(`${name} must be boolean`);
  }
  return errors;
}

function evaluate(root, config, now = new Date()) {
  const errors = configErrors(config);
  if (errors.length > 0) return { eligible_for_human_review: false, errors };
  const startsAt = Date.parse(config.comparison_period.starts_at);
  const endsAt = Date.parse(config.comparison_period.ends_at);
  const all = report(root);
  const observations = all.observations.filter((observation) => {
    const at = validTimestamp(observation.observedAt);
    return at !== null && startsAt <= at && at <= endsAt;
  });
  const counts = summarize(observations);
  const reasons = [];
  if (now.getTime() < endsAt) reasons.push("comparison period has not ended");
  if (counts.observations < config.minimum_observations) reasons.push("insufficient observations");
  if (counts.calibration_observations < config.minimum_calibration_observations) {
    reasons.push("insufficient independently verified calibration labels");
  }
  if (counts.brier_score === null || counts.brier_score > config.maximum_brier_score) {
    reasons.push("Brier score is absent or above threshold");
  }
  const meanCost = counts.human_review_minutes_known === 0
    ? null : counts.human_review_minutes / counts.human_review_minutes_known;
  if (meanCost === null || counts.human_review_minutes_known !== counts.observations ||
      meanCost > config.maximum_mean_human_review_minutes) {
    reasons.push("human-review cost is incomplete or above threshold");
  }
  if (config.require_zero_routing_changes && counts.routing_changed !== 0) {
    reasons.push("shadow changed routing");
  }
  if (config.require_zero_mutation_tool_violations && counts.mutation_tool_violations !== 0) {
    reasons.push("shadow called a mutation tool");
  }
  return {
    eligible_for_human_review: reasons.length === 0,
    promotion: "not-automated",
    counts,
    mean_human_review_minutes: meanCost,
    period_observations: observations.length,
    excluded_observations: all.observations.length - observations.length,
    reasons,
  };
}

if (require.main === module) {
  const [root = "roster", configPath] = process.argv.slice(2);
  if (!configPath) throw new Error("usage: chamallaw-shadow-gate <roster-root> <evaluation.json>");
  const result = evaluate(root, JSON.parse(fs.readFileSync(configPath, "utf8")));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.eligible_for_human_review ? 0 : 1;
}

module.exports = { configErrors, evaluate, validTimestamp };
