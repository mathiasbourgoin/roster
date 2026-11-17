"use strict";
const { test } = require("node:test");
const { run } = require("./pipeline-observation-check.cjs");
for (const category of ["catalog", "detail", "contract"]) test(`pipeline observation ${category} acceptance`, () => run(category));
