"use strict";
// Mirrors roster-run's LEDGER_SCHEMA; display usability is deliberately separate.
const SEQUENCES = {
  "express-lite": ["implement", "review", "ship"],
  express: ["implement", "review", "ship"],
  fast: ["implement", "review", "qa", "ship"],
  full: ["question", "research", "intake", "spec", "plan", "implement", "review", "qa", "ship"],
};
const VOCABULARY = {
  intake: ["VALIDATED"], spec: ["VALIDATED", "SKIPPED", "BOUNCED"],
  review: ["GO", "NO-GO"], qa: ["GO", "NO-GO"], ship: ["COMPLETED", "BLOCKED"],
  question: ["COMPLETED"], research: ["COMPLETED"], plan: ["COMPLETED"], implement: ["COMPLETED", "PARTIAL"],
};
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
function validateLedger(value, expectedTask) {
  return Boolean(object(value) && value.task === expectedTask && typeof value.mode === "string" &&
    Object.hasOwn(SEQUENCES, value.mode) && typeof value.current_phase === "string" &&
    Array.isArray(value.events) && value.events.length > 0 &&
    value.events.every(event => object(event) && typeof event.phase === "string" &&
      Object.hasOwn(VOCABULARY, event.phase) && VOCABULARY[event.phase].includes(event.outcome) &&
      (!Object.hasOwn(event, "reason") || typeof event.reason === "string")) &&
    value.events.at(-1).phase === value.current_phase && SEQUENCES[value.mode].includes(value.current_phase));
}
module.exports = { validateLedger };
