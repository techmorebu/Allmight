'use strict';
/* M2E-008A — fetcher worker-owned cycle heartbeat. OFFLINE.
   No live process signalled, no Redis touched. */
const assert=require('assert'), fs=require('fs'), path=require('path'), os=require('os');
const { spawnSync }=require('child_process');
const HB=path.resolve(__dirname,'..','..','scripts','fetcher_heartbeat.js');
const { emitCycleHeartbeat, readSessionId, HEARTBEAT_SCHEMA_VERSION, PRODUCER_BUILD }=require(HB);
let p=0,f=0;
const t=(n,fn)=>{try{fn();console.log('  OK   '+n);p++;}catch(e){console.log('  FAIL '+n+'\n         '+e.message);f++;}};
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'m2e8-'));
console.log('M2E-008A — fetcher cycle heartbeat');console.log('='.repeat(60));

t('G1 KNOWN POSITIVE: a completed cycle writes the full contract', () => {
  const d=tmp(); const hb=path.join(d,'fetcher.hb'); const sf=path.join(d,'allmight.session');
  fs.writeFileSync(sf,'20260904_2239\n');
  const r=emitCycleHeartbeat({hbPath:hb,sessionFilePath:sf,intervalSec:60,
    fetchersAttempted:5,fetchersOk:5,fetchersFailed:0,anyPartial:false});
  assert.strictEqual(r.ok,true);
  const rec=JSON.parse(fs.readFileSync(hb,'utf8'));
  assert.strictEqual(rec.heartbeatSchemaVersion,1);
  assert.strictEqual(Object.keys(rec)[0],'heartbeatSchemaVersion','schema identity leads');
  assert.strictEqual(rec.component,'fetcher');
  assert.strictEqual(rec.cycle,'complete');
  assert.strictEqual(rec.workerPid,process.pid);
  assert.strictEqual(rec.sessionId,'20260904_2239');
  assert.strictEqual(rec.producerBuild,'fetcher-hb-build-928a76e6');
  assert(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(rec.ts),'TIME-001 UTC');
  fs.rmSync(d,{recursive:true,force:true});
});
t('G2 PARTIAL SUCCESS still emits cycle=complete (Boss Q1)', () => {
  const d=tmp(); const hb=path.join(d,'f.hb');
  emitCycleHeartbeat({hbPath:hb,fetchersAttempted:5,fetchersOk:2,fetchersFailed:3,anyPartial:true});
  const rec=JSON.parse(fs.readFileSync(hb,'utf8'));
  assert.strictEqual(rec.cycle,'complete','3 of 5 failing is still a COMPLETED cycle');
  assert.strictEqual(rec.fetchersFailed,3);
  assert.strictEqual(rec.anyPartial,true);
  fs.rmSync(d,{recursive:true,force:true});
});
t('G3 counts are DIAGNOSTIC: no count changes the cycle assertion (Boss Q2)', () => {
  const d=tmp();
  for (const c of [[5,5,0,false],[5,0,5,true],[1,0,1,false],[0,0,0,false]]) {
    const hb=path.join(d,`f${c[1]}${c[2]}.hb`);
    emitCycleHeartbeat({hbPath:hb,fetchersAttempted:c[0],fetchersOk:c[1],fetchersFailed:c[2],anyPartial:c[3]});
    assert.strictEqual(JSON.parse(fs.readFileSync(hb,'utf8')).cycle,'complete',
      'counts '+JSON.stringify(c)+' must not alter the assertion');
  }
  fs.rmSync(d,{recursive:true,force:true});
});
t('G4 ABSENT counts are null, never a plausible zero', () => {
  const d=tmp(); const hb=path.join(d,'f.hb');
  emitCycleHeartbeat({hbPath:hb});
  const rec=JSON.parse(fs.readFileSync(hb,'utf8'));
  for (const k of ['fetchersAttempted','fetchersOk','fetchersFailed','anyPartial'])
    assert.strictEqual(rec[k],null,k+' must be null — 0 would read as "none failed"');
  fs.rmSync(d,{recursive:true,force:true});
});
t('G5 SESSION: read fresh per emit, never cached', () => {
  const d=tmp(); const sf=path.join(d,'s'); const hb=path.join(d,'f.hb');
  fs.writeFileSync(sf,'A\n'); emitCycleHeartbeat({hbPath:hb,sessionFilePath:sf});
  const a=JSON.parse(fs.readFileSync(hb,'utf8')).sessionId;
  fs.writeFileSync(sf,'B\n'); emitCycleHeartbeat({hbPath:hb,sessionFilePath:sf});
  const b=JSON.parse(fs.readFileSync(hb,'utf8')).sessionId;
  assert.strictEqual(a,'A'); assert.strictEqual(b,'B');
  fs.rmSync(d,{recursive:true,force:true});
});
t('G6 MISSING session file -> null, heartbeat still written', () => {
  const d=tmp(); const hb=path.join(d,'f.hb');
  const r=emitCycleHeartbeat({hbPath:hb,sessionFilePath:path.join(d,'nope')});
  assert.strictEqual(r.ok,true);
  assert.strictEqual(JSON.parse(fs.readFileSync(hb,'utf8')).sessionId,null);
  fs.rmSync(d,{recursive:true,force:true});
});
t('G7 NEVER FATAL: unwritable sink -> ok:false, no throw', () => {
  const d=tmp(); const hb=path.join(d,'f.hb'); fs.mkdirSync(hb);
  let threw=false; try{fs.writeFileSync(hb,'x');}catch{threw=true;}
  assert(threw,'PRECONDITION: sink must be genuinely unwritable');
  const r=emitCycleHeartbeat({hbPath:hb});
  assert.strictEqual(r.ok,false); assert(r.error);
  fs.rmSync(d,{recursive:true,force:true});
});

/* ── THE SKIP GUARD — the finding that changed the design ───────────────── */
function runCli(results){
  const d=tmp(); const hb=path.join(d,'fetcher.hb'); const sf=path.join(d,'s');
  fs.writeFileSync(sf,'SESSION_X\n');
  const script=path.join(d,'cli.js');
  fs.writeFileSync(script,`
    const { emitCycleHeartbeat }=require(${JSON.stringify(HB)});
    const results=${JSON.stringify(results)};
    // the EXACT logic the patcher installs
    try {
      const names = results && typeof results === "object" ? Object.keys(results) : [];
      if (names.length === 0) {
        process.stderr.write("[MASTER-FETCHER] cycle produced no fetcher results (lock held or no modules) — heartbeat NOT emitted\\n");
      } else {
        let ok=0, failed=0, anyPartial=false;
        for (const n of names) { const r=results[n];
          if (r && r.ok===true) ok++; else failed++;
          if (r && r.data && r.data.partial===true) anyPartial=true; }
        emitCycleHeartbeat({component:"fetcher",hbPath:${JSON.stringify(hb)},
          sessionFilePath:${JSON.stringify(sf)},intervalSec:60,
          fetchersAttempted:names.length,fetchersOk:ok,fetchersFailed:failed,anyPartial});
      }
    } catch(_) {}
  `);
  const r=spawnSync('node',[script],{encoding:'utf8',timeout:15000});
  return { dir:d, hb, exists:fs.existsSync(hb),
           rec: fs.existsSync(hb)?JSON.parse(fs.readFileSync(hb,'utf8')):null,
           stderr:r.stderr||'', status:r.status };
}
t('S1 LOCK-HELD SKIP: resolves {} -> NO heartbeat, and says so', () => {
  const r=runCli({});
  assert.strictEqual(r.exists,false,'a skipped run must NOT claim a completed cycle');
  assert(/heartbeat NOT emitted/.test(r.stderr),'silence would be indistinguishable from a crash');
  assert.strictEqual(r.status,0);
  fs.rmSync(r.dir,{recursive:true,force:true});
});
t('S1-CONTROL a REAL cycle with the same harness DOES emit', () => {
  const r=runCli({a:{ok:true,data:{partial:false}}});
  assert.strictEqual(r.exists,true,'the harness must be able to produce a positive');
  assert.strictEqual(r.rec.cycle,'complete');
  fs.rmSync(r.dir,{recursive:true,force:true});
});
t('S2 counts are derived from the REAL results shape', () => {
  const r=runCli({a:{ok:true,data:{partial:false}},b:{ok:false,error:'x'},
                  c:{ok:true,data:{partial:true}}});
  assert.strictEqual(r.rec.fetchersAttempted,3);
  assert.strictEqual(r.rec.fetchersOk,2);
  assert.strictEqual(r.rec.fetchersFailed,1);
  assert.strictEqual(r.rec.anyPartial,true);
  assert.strictEqual(r.rec.cycle,'complete','partial failure still completes');
  fs.rmSync(r.dir,{recursive:true,force:true});
});
t('S3 a null/undefined resolution is treated as a skip, not a crash', () => {
  for (const v of [null,undefined]) {
    const r=runCli(v===undefined?null:v);
    assert.strictEqual(r.exists,false); assert.strictEqual(r.status,0);
    fs.rmSync(r.dir,{recursive:true,force:true});
  }
});
t('S4 the FATAL path emits nothing — asserted from the patcher source', () => {
  const src=fs.readFileSync('/tmp/tmp.9YXX8ERnnm/m2e008/staging/apply_m2e008.py','utf8');
  const i=src.index?0:src.indexOf('.catch((err) => {\n        // NO heartbeat here');
  assert(i>0,'the catch block must carry the explicit no-emit comment');
  const tail=src.slice(i);
  assert(!/emitCycleHeartbeat/.test(tail.split('process.exitCode = 1;')[0]),
    'no emit may appear in the fatal path');
});
t('S5 the module is SEPARATE from volatility cycle_heartbeat.js', () => {
  const src=fs.readFileSync(HB,'utf8');
  assert.strictEqual(PRODUCER_BUILD,'fetcher-hb-build-928a76e6');
  assert(!/volatility/.test(src.replace(/\/\*[\s\S]*?\*\//g,'')),'no volatility coupling');
  assert(/A SEPARATE MODULE/.test(src),'the isolation rationale must be recorded');
});
t('S6 surface: built-ins only, no network, no spawn, no signal', () => {
  const src=fs.readFileSync(HB,'utf8').replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,'');
  for (const pat of [/require\('http/,/fetch\(/,/ioredis/,/child_process/,/spawn/,/\.kill\(/])
    assert(!pat.test(src),'found '+pat.source);
  const reqs=[...src.matchAll(/require\('([^']+)'\)/g)].map(m=>m[1]);
  assert.deepStrictEqual([...new Set(reqs)].sort(),['fs','path']);
});
t('S6-CONTROL the scan can fire', () => {
  assert(/child_process/.test("require('child_process')") && /fetch\(/.test("fetch('x')"));
});
t('S7 the patcher REFUSES a mismatched file', () => {
  const d=tmp(); const w=path.join(d,'x.js'); fs.writeFileSync(w,'// not the fetcher\n');
  const r=spawnSync('python3',['/tmp/tmp.9YXX8ERnnm/m2e008/staging/apply_m2e008.py',w],{encoding:'utf8'});
  assert.notStrictEqual(r.status,0); assert(/REFUSED/.test(r.stdout+r.stderr));
  fs.rmSync(d,{recursive:true,force:true});
});
console.log(''); console.log(`passed ${p}  failed ${f}`);
process.exit(f===0?0:1);
