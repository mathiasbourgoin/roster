"use strict";
const {test}=require("node:test");
const {run}=require("./artifact-observation-check.cjs");
for(const n of [29,30,31])test(`public artifact installed closure AC-${n}`,{timeout:120000},()=>run(`AC-${n}`));
