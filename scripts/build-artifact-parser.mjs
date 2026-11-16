#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {fileURLToPath} from "node:url";
import {build} from "esbuild";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const sha=x=>crypto.createHash("sha256").update(x).digest("hex");
const read=p=>fs.readFileSync(path.join(root,p));
const check=process.argv.includes("--check");
if(JSON.parse(read("node_modules/yaml/package.json")).version!=="2.9.1" || JSON.parse(read("node_modules/esbuild/package.json")).version!=="0.25.6")throw Error("pinned local builder inputs required");
const settings={bundle:true,platform:"node",format:"cjs",target:"node18",minify:true,legalComments:"inline"};
const result=await build({...settings,absWorkingDir:root,entryPoints:["scripts/lib/artifact-yaml-entry.cjs"],write:false,metafile:true});
const bundle=result.outputFiles[0].contents,license=read("node_modules/yaml/LICENSE");
if(sha(license)!=="5bba27375d93e9119f76c1015f7672cf9ad5f70952296e0842fb2243d6376869")throw Error("license mismatch");
const provenance={schema_version:1,package:"yaml",version:"2.9.1",archive:"https://registry.npmjs.org/yaml/-/yaml-2.9.1.tgz",archive_sha256:"4ef6c54cf559b8a207b7b518378230805a1c84af239b14960e8c67c7d59de5d3",integrity:"sha512-3NxN8+78OdzbT7C/WjGsyfPAtJaN3FNDsWxv7Y7mcDsT/oOmgW8BpyQQFFBnvZE3j9Y2Sdz1ULFLezL7Eb2yFw==",license:{name:"ISC",sha256:sha(license),bytes:license.length},builder:{name:"esbuild",version:"0.25.6",settings},entry:{path:"scripts/lib/artifact-yaml-entry.cjs",sha256:sha(read("scripts/lib/artifact-yaml-entry.cjs"))},bundle:{sha256:sha(bundle),bytes:bundle.length},inputs:Object.fromEntries(Object.keys(result.metafile.inputs).sort().map(p=>[p,{sha256:sha(read(p)),bytes:read(p).length}]))};
function output(p,data){const b=Buffer.from(data);if(check){if(!fs.existsSync(path.join(root,p))||!read(p).equals(b))throw Error(`stale generated resource: ${p}`);}else fs.writeFileSync(path.join(root,p),b);}
output("scripts/vendor/yaml-2.9.1.cjs",bundle);
output("scripts/vendor/yaml-2.9.1.LICENSE",license);
output("scripts/vendor/yaml-2.9.1.provenance.json",JSON.stringify(provenance,null,2)+"\n");
const mappings={"bin/roster-pipeline.cjs":"scripts/roster-pipeline.cjs","bin/roster-pipeline-ledger.cjs":"scripts/roster-pipeline-ledger.cjs","bin/roster-artifacts.cjs":"scripts/roster-artifacts.cjs","bin/lib/review/finding-schema.cjs":"scripts/lib/review/finding-schema.cjs","roadmap/pipeline-observation.schema.json":"schema/pipeline-observation.schema.json","roadmap/pipeline-coverage.json":"schema/pipeline-coverage.json","roadmap/qa-state.schema.json":"schema/qa-state.schema.json","bin/roster-artifact-observation.cjs":"scripts/roster-artifact-observation.cjs","bin/roster-artifact-metadata.cjs":"scripts/roster-artifact-metadata.cjs","bin/vendor/yaml-2.9.1.cjs":"scripts/vendor/yaml-2.9.1.cjs","bin/vendor/yaml-2.9.1.LICENSE":"scripts/vendor/yaml-2.9.1.LICENSE","bin/vendor/yaml-2.9.1.provenance.json":"scripts/vendor/yaml-2.9.1.provenance.json","roadmap/artifact-observation.schema.json":"schema/artifact-observation.schema.json","roadmap/artifact-coverage.json":"schema/artifact-coverage.json"};
const manifest={manifest_version:1,members:Object.keys(mappings).sort().map(logical=>{const b=read(mappings[logical]);return {logical,source:mappings[logical],sha256:sha(b),bytes:b.length};})};
output("scripts/artifact-observation.manifest.json",JSON.stringify(manifest,null,2)+"\n");
console.log(`artifact parser ${check?"reproducible":"generated"}: ${bundle.length} bytes ${sha(bundle)}`);
