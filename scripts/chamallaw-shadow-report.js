#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

function shadowFiles(root) {
  if (!fs.existsSync(root)) return [];
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const child = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...shadowFiles(child));
    else if (entry.isFile() && entry.name === "chamallaw-shadow.md") files.push(child);
  }
  return files.sort();
}

function field(text, label) {
  const match = text.match(new RegExp(`^- ${label}:\\s*\\x60?([^\\n\\x60]+)\\x60?\\s*$`, "m"));
  return match ? match[1].trim() : null;
}

function posteriorMean(value) {
  const match = (value ?? "").match(/^Beta\(([^,]+),\s*([^)]+)\)$/);
  if (!match) return null;
  const alpha = Number(match[1]);
  const beta = Number(match[2]);
  if (!Number.isFinite(alpha) || !Number.isFinite(beta) || alpha <= 0 || beta <= 0) {
    return null;
  }
  return alpha / (alpha + beta);
}

function nonNegativeInteger(value) {
  return /^\d+$/.test(value ?? "") ? Number(value) : null;
}

function parse(file) {
  const text = fs.readFileSync(file, "utf8");
  return {
    file,
    observedAt: field(text, "Observed at"),
    routeRetained: field(text, "Route retained"),
    routingChanged: field(text, "Routing changed"),
    mcpStatus: field(text, "MCP status"),
    assessment: field(text, "Assessment"),
    posterior: field(text, "Posterior"),
    verifiedOutcomeCount: field(text, "Verified outcome count"),
    humanReviewMinutes: field(text, "Human review minutes"),
    comparisonLabel: field(text, "Comparison label"),
    mutationToolsCalled: field(text, "Mutation MCP tools called"),
  };
}

function summarize(observations) {
  const counts = {
    observations: observations.length, available: 0, unavailable: 0, errors: 0,
    assessed: 0, abstained: 0, routing_changed: 0,
    mutation_tool_violations: 0, verified_outcomes: 0, verified_outcomes_known: 0,
    comparison_labels_positive: 0, comparison_labels_negative: 0,
    comparison_labels_unknown: 0, calibration_observations: 0,
    brier_score: null, human_review_minutes: 0, human_review_minutes_known: 0,
  };
  let brierSum = 0;
  for (const observation of observations) {
    if (observation.mcpStatus === "available") counts.available += 1;
    else if (observation.mcpStatus === "unavailable") counts.unavailable += 1;
    else if (observation.mcpStatus === "error") counts.errors += 1;
    if (observation.assessment === "assessed") counts.assessed += 1;
    else if (observation.assessment === "abstained") counts.abstained += 1;
    if (observation.routingChanged !== "no") counts.routing_changed += 1;
    if (observation.mutationToolsCalled !== "no") counts.mutation_tool_violations += 1;
    if (/^\d+$/.test(observation.verifiedOutcomeCount ?? "")) {
      counts.verified_outcomes += Number(observation.verifiedOutcomeCount);
      counts.verified_outcomes_known += 1;
    }
    const minutes = nonNegativeInteger(observation.humanReviewMinutes);
    if (minutes !== null) {
      counts.human_review_minutes += minutes;
      counts.human_review_minutes_known += 1;
    }
    const label = observation.comparisonLabel;
    if (label === "positive") counts.comparison_labels_positive += 1;
    else if (label === "negative") counts.comparison_labels_negative += 1;
    else counts.comparison_labels_unknown += 1;
    const probability = posteriorMean(observation.posterior);
    if (probability !== null && (label === "positive" || label === "negative")) {
      const target = label === "positive" ? 1 : 0;
      brierSum += (probability - target) ** 2;
      counts.calibration_observations += 1;
    }
  }
  if (counts.calibration_observations > 0) {
    counts.brier_score = brierSum / counts.calibration_observations;
  }
  return counts;
}

function report(root) {
  const observations = shadowFiles(root).map(parse);
  return { root: path.resolve(root), counts: summarize(observations), observations };
}

if (require.main === module) {
  process.stdout.write(`${JSON.stringify(report(process.argv[2] ?? "roster"), null, 2)}\n`);
}

module.exports = { parse, posteriorMean, report, shadowFiles, summarize };
