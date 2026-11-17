"use strict";
const { test } = require("node:test");
const { run } = require("./pipeline-observation-check.cjs");
test("pipeline observation complete installed ESM runtime closure", () => run("install"));
