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

function parse(file) {
  const text = fs.readFileSync(file, "utf8");
  return {
    file,
    routingChanged: field(text, "Routing changed"),
    mcpStatus: field(text, "MCP status"),
    assessment: field(text, "Assessment"),
    verifiedOutcomeCount: field(text, "Verified outcome count"),
    mutationToolsCalled: field(text, "Mutation MCP tools called"),
  };
}

function report(root) {
  const observations = shadowFiles(root).map(parse);
  const counts = {
    observations: observations.length, available: 0, unavailable: 0, errors: 0,
    assessed: 0, abstained: 0, routing_changed: 0,
    mutation_tool_violations: 0, verified_outcomes: 0, verified_outcomes_known: 0,
  };
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
  }
  return { root: path.resolve(root), counts, observations };
}

if (require.main === module) {
  process.stdout.write(`${JSON.stringify(report(process.argv[2] ?? "roster"), null, 2)}\n`);
}

module.exports = { parse, report, shadowFiles };
