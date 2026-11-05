// Run from the repository root: node scripts/review/streetview/run.mjs
// Builds isolated #1163 trees plus the narrowly extracted Street View patches.
// Requires only Git and Node 24; no npm install and no network access needed.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, cpSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const base = 'b92e91c2618cf46814c77b9273e1e83011fdcb2b';
const temp = mkdtempSync(join(tmpdir(), 'gev-streetview-'));
const out = join(root,'streetview-review-results');
mkdirSync(out,{recursive:true});
let failed=false;
for(const policy of ['1588','666']){
  const target=join(temp,policy);
  try{
    execFileSync('git',['worktree','add','--detach',target,base],{cwd:root,stdio:'pipe'});
    execFileSync('git',['apply','--3way',join(root,`scripts/review/streetview/${policy}.patch`)],{cwd:target,stdio:'pipe'});
    const untouched=execFileSync('git',['diff','--cached',base,'--','server/providers/cctv/stream.js','server/providers/cctv/media.js','server/providers/cctv/normalize.js','config/cctv_sources.argentina.json'],{cwd:target,encoding:'utf8'});
    if(untouched)throw new Error('Integration unexpectedly changed catalog/relay/media/normalization');
    const harness=join(target,'scripts/review/streetview');
    mkdirSync(harness,{recursive:true});
    cpSync(join(root,'scripts/review/streetview/compatibility.test.mjs'),join(harness,'compatibility.test.mjs'));
    const tests=[
      'scripts/review/streetview/compatibility.test.mjs',
      'src/data/cctvArgentinaCatalog.test.mjs',
      'src/data/cctvFmp4.test.mjs',
      'src/data/cctvFmp4Recovery.test.mjs',
      'src/data/cctvFmp4Routes.test.mjs',
      'src/data/cctvHlsStream.test.mjs',
      'src/data/cctvHlsAdmission.test.mjs',
      'src/ui/cctvEmbed.test.mjs',
      ...(policy==='1588'?['server/providers/cctv/streetViewGuard.test.mjs']:[
        'src/data/cctvStreetViewQuota.test.mjs',
        'src/data/cctvStreetViewRoute.test.mjs',
        'src/data/cctvStreetViewGoogleBudget.test.mjs'
      ])
    ];
    const r=spawnSync(process.execPath,['--test',...tests],{
      cwd:target,env:{...process.env,STREETVIEW_REVIEW_POLICY:policy},encoding:'utf8',timeout:120_000,maxBuffer:8*1024*1024
    });
    const log=(r.stdout||'')+(r.stderr||'')+(r.error?String(r.error):'');
    writeFileSync(join(out,`${policy}.tap`),log);
    console.log(`Policy ${policy}: exit ${r.status}\n${log.slice(-650)}`);
    if(r.status!==0)failed=true;
  }finally{
    execFileSync('git',['worktree','remove','--force',target],{cwd:root,stdio:'pipe'});
  }
}
rmSync(temp,{recursive:true,force:true});
process.exitCode=failed?1:0;
