"use strict";
const {test}=require("node:test");
const {run}=require("./artifact-observation-check.cjs");
for(let n=1;n<=38;n++)if(![29,30,31].includes(n))test(`public artifact AC-${n}`,{timeout:60000},()=>run(`AC-${n}`));
