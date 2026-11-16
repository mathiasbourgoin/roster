"use strict";
const {test}=require("node:test");
const {run}=require("./artifact-observation-check.cjs");
for(let n=1;n<=38;n++)if(![29,30,31].includes(n))test(`public artifact AC-${n}`,{timeout:60000},()=>run(`AC-${n}`));

const assert=require("node:assert/strict");
const path=require("node:path");
const {spawnSync}=require("node:child_process");
for(const check of ["check-artifact-semver-regression.cjs","check-artifact-token-types-regression.cjs","check-artifact-packaging-regression.cjs"]) {
  test(`permanent artifact ratchet ${check}`,{timeout:30000},()=>{
    const env={...process.env};
    delete env.ROSTER_ARTIFACT_TEST_SOURCE_ROOT;
    delete env.ROSTER_ARTIFACT_PACKAGING_SOURCE_ROOT;
    const result=spawnSync(process.execPath,[path.join(__dirname,check)],{cwd:path.resolve(__dirname,".."),env,encoding:"utf8",timeout:15000});
    assert.ifError(result.error);
    assert.equal(result.signal,null);
    assert.equal(result.status,0,result.stderr);
  });
}
