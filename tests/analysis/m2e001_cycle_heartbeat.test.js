'use strict';
/* M2E-001 — worker-owned cycle heartbeat. OFFLINE.
   No live AllMight process is signalled or touched. */
const assert=require('assert'), fs=require('fs'), path=require('path'), os=require('os');
const { spawnSync }=require('child_process');
const HB=path.resolve(__dirname,'..','..','scripts','analysis','cycle_heartbeat.js');
const { emitCycleHeartbeat, readSessionId, HEARTBEAT_SCHEMA_VERSION, PRODUCER_BUILD }=require(HB);
let p=0,f=0;
const t=(n,fn)=>{try{fn();console.log('  OK   '+n);p++;}catch(e){console.log('  FAIL '+n+'\n         '+e.message);f++;}};
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'m2e1-'));
console.log('M2E-001 — volatility worker-owned cycle heartbeat');console.log('='.repeat(62));

t('E1 KNOWN POSITIVE: a completed cycle writes worker pid + build', () => {
  const d=tmp(); const hb=path.join(d,'volatility.hb');
  const r=emitCycleHeartbeat({hbPath:hb,cycleNumber:7,intervalSec:0});
  assert.strictEqual(r.ok,true);
  const rec=JSON.parse(fs.readFileSync(hb,'utf8'));
  assert.strictEqual(rec.component,'volatility');
  assert.strictEqual(rec.cycle,'complete');
  assert.strictEqual(rec.workerPid,process.pid);
  assert.strictEqual(rec.cycleNumber,7);
  assert.strictEqual(rec.producerBuild,PRODUCER_BUILD);
  fs.rmSync(d,{recursive:true,force:true});
});
t('E1b TIME-001: ts is UTC, and no local field exists', () => {
  const d=tmp(); const hb=path.join(d,'v.hb');
  emitCycleHeartbeat({hbPath:hb});
  const rec=JSON.parse(fs.readFileSync(hb,'utf8'));
  assert(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(rec.ts),rec.ts);
  assert(!Object.keys(rec).some(k=>/local|ct$|cdt|cst/i.test(k)),Object.keys(rec).join(','));
  fs.rmSync(d,{recursive:true,force:true});
});

/* ── THE CONSTITUTIONAL PAIR: E2 means nothing without E3 ────────────────── */
function workerOwnedRun(dir,hb,{stopWorker}={}){
  // A wrapper that re-runs a one-shot WORKER. The WORKER emits the heartbeat.
  const w=path.join(dir,'worker.js');
  fs.writeFileSync(w,`
    const { emitCycleHeartbeat }=require(${JSON.stringify(HB)});
    emitCycleHeartbeat({hbPath:${JSON.stringify(hb)},cycleNumber:1,intervalSec:0});
  `);
  const wrap=path.join(dir,'wrap.sh');
  fs.writeFileSync(wrap,`#!/bin/bash
    i=0
    while [ $i -lt 3 ]; do
      ${stopWorker ? 'true  # WORKER STOPPED: never runs' : `node "${w}"`}
      i=$((i+1)); sleep 0.05
    done`);
  spawnSync('bash',[wrap],{timeout:20000});
}
function wrapperTouchRun(dir,hb,{stopWorker}={}){
  // DELIBERATELY WRONG: the WRAPPER touches the heartbeat each loop.
  const w=path.join(dir,'worker.js'); fs.writeFileSync(w,'process.exit(0);');
  const wrap=path.join(dir,'wrap.sh');
  fs.writeFileSync(wrap,`#!/bin/bash
    i=0
    while [ $i -lt 3 ]; do
      echo '{"component":"volatility","cycle":"complete"}' > "${hb}"
      ${stopWorker ? 'true  # WORKER STOPPED' : `node "${w}"`}
      i=$((i+1)); sleep 0.05
    done`);
  spawnSync('bash',[wrap],{timeout:20000});
}
t('E2 WRAPPER ALIVE + WORKER STOPPED -> worker-owned heartbeat is NOT written', () => {
  const d=tmp(); const hb=path.join(d,'v.hb');
  workerOwnedRun(d,hb,{stopWorker:true});
  assert.strictEqual(fs.existsSync(hb),false,'nothing may be written when the worker never runs');
  fs.rmSync(d,{recursive:true,force:true});
});
t('E2b CONTROL: the same harness DOES write when the worker runs', () => {
  const d=tmp(); const hb=path.join(d,'v.hb');
  workerOwnedRun(d,hb,{stopWorker:false});
  assert.strictEqual(fs.existsSync(hb),true,'the harness must be able to produce a positive');
  fs.rmSync(d,{recursive:true,force:true});
});
t('E3 CONSTITUTIONAL: a WRAPPER-TOUCH implementation STAYS FRESH and FAILS', () => {
  const d=tmp(); const hb=path.join(d,'v.hb');
  wrapperTouchRun(d,hb,{stopWorker:true});
  assert.strictEqual(fs.existsSync(hb),true,
    'the wrong design keeps the heartbeat fresh with NO worker — this is what must be rejected');
  const rec=JSON.parse(fs.readFileSync(hb,'utf8'));
  // The point is NOT that these fields are unforgeable — a wrapper could write
  // anything. It is that no AUTHORIZED wrapper emitter exists, so the wrong
  // design produces a record lacking the worker-owned contract entirely.
  assert.strictEqual(rec.workerPid,undefined,'no authorized wrapper emitter supplies a worker pid');
  assert.strictEqual(rec.producerBuild,undefined,'no authorized wrapper emitter supplies the producer build');
  assert.strictEqual(rec.heartbeatSchemaVersion,undefined,'nor the schema identity');
  fs.rmSync(d,{recursive:true,force:true});
});
t('E3b DISCRIMINATION: the two designs DIFFER under the same condition', () => {
  const a=tmp(), b=tmp();
  const ha=path.join(a,'v.hb'), hbp=path.join(b,'v.hb');
  workerOwnedRun(a,ha,{stopWorker:true});
  wrapperTouchRun(b,hbp,{stopWorker:true});
  assert.notStrictEqual(fs.existsSync(ha),fs.existsSync(hbp),
    'if both behaved alike the counterfactual would prove nothing');
  fs.rmSync(a,{recursive:true,force:true}); fs.rmSync(b,{recursive:true,force:true});
});

t('E4 IDLE IS NOT DEATH: a fresh record inside the window is not stale', () => {
  const d=tmp(); const hb=path.join(d,'v.hb');
  emitCycleHeartbeat({hbPath:hb});
  const age=Math.floor((Date.now()-fs.statSync(hb).mtimeMs)/1000);
  assert(age<=1,'just written');
  assert(age<180,'well inside the proposed 180s TTL for a 30s cadence');
  fs.rmSync(d,{recursive:true,force:true});
});
t('E6 IDENTITY: producerBuild derives from the pre-patch worker SHA', () => {
  assert.strictEqual(PRODUCER_BUILD,'volatility-hb-build-0455a658');
  assert(PRODUCER_BUILD.endsWith('0455a658'),'bound to the gated preimage');
});
t('E6b the build id appears exactly once in the module', () => {
  const src=fs.readFileSync(HB,'utf8');
  assert.strictEqual((src.match(/volatility-hb-build-0455a658/g)||[]).length,1);
});
t('E7 PID BINDING: workerPid is the emitting process, not the harness', () => {
  // R4: the child reports its pid as MACHINE-READABLE JSON on stdout.
  // console.log() passes through a formatter that can inject ANSI escapes in
  // some terminals, so Number(stdout.trim()) became NaN and E7 failed on a
  // correct implementation. process.stdout.write of raw JSON has no formatter.
  const d=tmp(); const hb=path.join(d,'v.hb');
  const script=path.join(d,'c.js');
  fs.writeFileSync(script,`
    const {emitCycleHeartbeat}=require(${JSON.stringify(HB)});
    emitCycleHeartbeat({hbPath:${JSON.stringify(hb)}});
    process.stdout.write(JSON.stringify({childPid: process.pid}));`);
  const r=spawnSync('node',[script],{encoding:'utf8',timeout:15000});
  assert.strictEqual(r.status,0,'child failed: '+r.stderr);
  let reported;
  try { reported = JSON.parse(r.stdout.trim()).childPid; }
  catch (e) { assert.fail('child stdout was not parsable JSON: '+JSON.stringify(r.stdout)); }
  assert(Number.isInteger(reported) && reported>0,'childPid must be a positive integer, got '+reported);
  const rec=JSON.parse(fs.readFileSync(hb,'utf8'));
  assert.strictEqual(rec.workerPid,reported,'the record must carry the CHILD pid');
  assert.notStrictEqual(rec.workerPid,process.pid,'and NOT the harness pid');
  fs.rmSync(d,{recursive:true,force:true});
});
t('E7b PARSER CONTROL: the harness rejects non-JSON stdout instead of coercing', () => {
  // Without this, a future formatter change would silently reintroduce the
  // NaN comparison that made E7 fail on correct code.
  let parsed=null, threw=false;
  try { parsed=JSON.parse('\u001b[32m12345\u001b[39m'); } catch { threw=true; }
  assert(threw,'ANSI-wrapped output must FAIL to parse, not coerce to a number');
  assert.strictEqual(Number.isNaN(Number('\u001b[32m12345\u001b[39m')),true,
    'this is exactly what the old Number(stdout) parser produced');
});
t('E7c INDEPENDENT SOURCE: the record pid is verifiable without stdout at all', () => {
  // Strongest form: derive the expectation from the artifact, not the terminal.
  const d=tmp(); const hb=path.join(d,'v.hb');
  const script=path.join(d,'c.js');
  fs.writeFileSync(script,`
    const {emitCycleHeartbeat}=require(${JSON.stringify(HB)});
    emitCycleHeartbeat({hbPath:${JSON.stringify(hb)}});`);
  const r=spawnSync('node',[script],{encoding:'utf8',timeout:15000});
  assert.strictEqual(r.status,0);
  const rec=JSON.parse(fs.readFileSync(hb,'utf8'));
  assert(Number.isInteger(rec.workerPid) && rec.workerPid>0);
  assert.notStrictEqual(rec.workerPid,process.pid,'a child pid, whatever the terminal does');
  fs.rmSync(d,{recursive:true,force:true});
});
t('E8 NEVER FATAL: an unwritable sink returns ok:false and does not throw', () => {
  const d=tmp(); const hb=path.join(d,'v.hb'); fs.mkdirSync(hb);   // EISDIR: fails for root too
  let threw=false; try{ fs.writeFileSync(hb,'x'); }catch{ threw=true; }
  assert(threw,'PRECONDITION: the sink must genuinely be unwritable');
  const r=emitCycleHeartbeat({hbPath:hb});
  assert.strictEqual(r.ok,false);
  assert(r.error,'the failure must be reported');
  fs.rmSync(d,{recursive:true,force:true});
});
t('E8b a failed emit does not kill the calling process', () => {
  const d=tmp(); const bad=path.join(d,'v.hb'); fs.mkdirSync(bad);
  const script=path.join(d,'c.js');
  fs.writeFileSync(script,`
    const {emitCycleHeartbeat}=require(${JSON.stringify(HB)});
    emitCycleHeartbeat({hbPath:${JSON.stringify(bad)}});
    console.log('SURVIVED'); process.exit(0);`);
  const r=spawnSync('node',[script],{encoding:'utf8',timeout:15000});
  assert.strictEqual(r.status,0,r.stderr);
  assert(/SURVIVED/.test(r.stdout));
  fs.rmSync(d,{recursive:true,force:true});
});
t('E10 SEPARATION: the heartbeat claims CYCLE COMPLETION, never useful work', () => {
  const d=tmp(); const hb=path.join(d,'v.hb');
  emitCycleHeartbeat({hbPath:hb});
  const rec=JSON.parse(fs.readFileSync(hb,'utf8'));
  assert.strictEqual(rec.cycle,'complete');
  for (const k of ['records','surfaces','scanned','output','findings'])
    assert.strictEqual(k in rec,false,'output authority must stay separate: '+k);
  fs.rmSync(d,{recursive:true,force:true});
});
t('E11 SESSION AUTHORITY: the record carries the canonical session id', () => {
  const d=tmp(); const sf=path.join(d,'allmight.session'); const hb=path.join(d,'v.hb');
  fs.writeFileSync(sf,'20260904_2239\n');
  emitCycleHeartbeat({hbPath:hb,sessionFilePath:sf});
  assert.strictEqual(JSON.parse(fs.readFileSync(hb,'utf8')).sessionId,'20260904_2239');
  fs.rmSync(d,{recursive:true,force:true});
});
t('E12 SESSION ISOLATION: a session-A record does NOT satisfy session B', () => {
  const d=tmp(); const sf=path.join(d,'allmight.session'); const hb=path.join(d,'v.hb');
  fs.writeFileSync(sf,'SESSION_A\n');
  emitCycleHeartbeat({hbPath:hb,sessionFilePath:sf});
  const recA=JSON.parse(fs.readFileSync(hb,'utf8'));
  // the evaluator's future check, applied here as the property under test
  const satisfies=(rec,session)=>rec.sessionId===session;
  assert.strictEqual(satisfies(recA,'SESSION_A'),true,'must satisfy its own session');
  assert.strictEqual(satisfies(recA,'SESSION_B'),false,'must NOT satisfy a different session');
  fs.rmSync(d,{recursive:true,force:true});
});
t('E13 SESSION ADVANCE: a new session yields a new record; the old is stale-by-session', () => {
  const d=tmp(); const sf=path.join(d,'allmight.session'); const hb=path.join(d,'v.hb');
  fs.writeFileSync(sf,'SESSION_A\n');
  emitCycleHeartbeat({hbPath:hb,sessionFilePath:sf});
  const a=JSON.parse(fs.readFileSync(hb,'utf8')).sessionId;
  fs.writeFileSync(sf,'SESSION_B\n');          // the session advanced under the process
  emitCycleHeartbeat({hbPath:hb,sessionFilePath:sf});
  const b=JSON.parse(fs.readFileSync(hb,'utf8')).sessionId;
  assert.strictEqual(a,'SESSION_A'); assert.strictEqual(b,'SESSION_B');
  assert.notStrictEqual(a,b,'the id must be read FRESH per emit, never cached');
  fs.rmSync(d,{recursive:true,force:true});
});
t('E14 CARRY-OVER CONTROL: a prior-session file left in place is detectable', () => {
  // the exact risk Boss named: old evidence floating into a new session
  const d=tmp(); const sf=path.join(d,'allmight.session'); const hb=path.join(d,'v.hb');
  fs.writeFileSync(sf,'OLD_SESSION\n');
  emitCycleHeartbeat({hbPath:hb,sessionFilePath:sf});
  fs.writeFileSync(sf,'NEW_SESSION\n');        // new session starts; NO new emit
  const stale=JSON.parse(fs.readFileSync(hb,'utf8'));
  assert.strictEqual(stale.sessionId,'OLD_SESSION');
  assert.notStrictEqual(stale.sessionId,readSessionId(sf),
    'the record and the current session DIFFER, so carry-over is detectable');
  fs.rmSync(d,{recursive:true,force:true});
});
t('E15 MISSING SESSION FILE: sessionId is null, and nothing throws', () => {
  const d=tmp(); const hb=path.join(d,'v.hb');
  const r=emitCycleHeartbeat({hbPath:hb,sessionFilePath:path.join(d,'nope')});
  assert.strictEqual(r.ok,true,'the heartbeat is still written');
  assert.strictEqual(JSON.parse(fs.readFileSync(hb,'utf8')).sessionId,null,
    'null is honest — better than omitting the field or inventing a value');
  fs.rmSync(d,{recursive:true,force:true});
});
t('E16 the worker-owned run carries the session; the wrapper-touch build does NOT', () => {
  const a=tmp(), b=tmp();
  const sf=path.join(a,'allmight.session'); fs.writeFileSync(sf,'SESSION_X\n');
  const ha=path.join(a,'v.hb');
  const w=path.join(a,'worker.js');
  fs.writeFileSync(w,`
    const {emitCycleHeartbeat}=require(${JSON.stringify(HB)});
    emitCycleHeartbeat({hbPath:${JSON.stringify(ha)},sessionFilePath:${JSON.stringify(sf)}});`);
  spawnSync('node',[w],{timeout:15000});
  const worker=JSON.parse(fs.readFileSync(ha,'utf8'));
  assert.strictEqual(worker.sessionId,'SESSION_X');
  const hbp=path.join(b,'v.hb');
  wrapperTouchRun(b,hbp,{stopWorker:true});
  const wrapper=JSON.parse(fs.readFileSync(hbp,'utf8'));
  assert.strictEqual(wrapper.sessionId,undefined,
    'no AUTHORIZED wrapper emitter exists — this is the point, not unforgeability');
  fs.rmSync(a,{recursive:true,force:true}); fs.rmSync(b,{recursive:true,force:true});
});
t('E17 SCHEMA IDENTITY: every record carries heartbeatSchemaVersion', () => {
  const d=tmp(); const hb=path.join(d,'v.hb');
  emitCycleHeartbeat({hbPath:hb});
  const rec=JSON.parse(fs.readFileSync(hb,'utf8'));
  assert.strictEqual(rec.heartbeatSchemaVersion,1);
  assert.strictEqual(HEARTBEAT_SCHEMA_VERSION,1);
  // it must be readable BEFORE interpreting anything else
  assert.strictEqual(Object.keys(rec)[0],'heartbeatSchemaVersion','schema identity leads the payload');
  fs.rmSync(d,{recursive:true,force:true});
});
t('E17b a consumer can reject an unknown schema without guessing', () => {
  const accepts=(rec)=>rec && rec.heartbeatSchemaVersion===1;
  const d=tmp(); const hb=path.join(d,'v.hb');
  emitCycleHeartbeat({hbPath:hb});
  assert.strictEqual(accepts(JSON.parse(fs.readFileSync(hb,'utf8'))),true);
  assert.strictEqual(accepts({heartbeatSchemaVersion:2,component:'volatility'}),false,'a future schema is REJECTED, not misread');
  assert.strictEqual(accepts({component:'volatility'}),false,'an unversioned record is REJECTED');
  fs.rmSync(d,{recursive:true,force:true});
});
t('E18 NULL SESSION cannot satisfy any valid current session', () => {
  const d=tmp(); const hb=path.join(d,'v.hb');
  const r=emitCycleHeartbeat({hbPath:hb,sessionFilePath:path.join(d,'absent')});
  assert.strictEqual(r.ok,true,'emission stays non-fatal');
  const rec=JSON.parse(fs.readFileSync(hb,'utf8'));
  assert.strictEqual(rec.sessionId,null);
  // the property under test: null must never match a real session
  const satisfies=(rc,session)=>rc.sessionId!==null && rc.sessionId===session;
  for (const s of ['20260904_2239','SESSION_A','']) 
    assert.strictEqual(satisfies(rec,s),false,'null must not satisfy session '+JSON.stringify(s));
  // and a NON-null record still does satisfy its own session — the control
  const sf=path.join(d,'allmight.session'); fs.writeFileSync(sf,'REAL\n');
  emitCycleHeartbeat({hbPath:hb,sessionFilePath:sf});
  assert.strictEqual(satisfies(JSON.parse(fs.readFileSync(hb,'utf8')),'REAL'),true,
    'the matcher must be able to return true, or E18 proves nothing');
  fs.rmSync(d,{recursive:true,force:true});
});
t('E18b null-vs-null does NOT match — absence is not identity', () => {
  const satisfies=(rc,session)=>rc.sessionId!==null && rc.sessionId===session;
  assert.strictEqual(satisfies({sessionId:null},null),false,
    'two unknowns must never be treated as the same session');
});
t('S1 module surface: built-ins only, no network, no spawn', () => {
  const src=fs.readFileSync(HB,'utf8').replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,'');
  for (const pat of [/require\('http/,/fetch\(/,/ioredis/,/axios/,/child_process/,/spawn/,/\.kill\(/])
    assert(!pat.test(src),'found '+pat.source);
  const reqs=[...src.matchAll(/require\('([^']+)'\)/g)].map(m=>m[1]);
  assert.deepStrictEqual([...new Set(reqs)].sort(),['fs','path']);
});
t('S1-CONTROL the scan can fire', () => {
  assert(/child_process/.test("require('child_process')") && /fetch\(/.test("fetch('x')"));
});
t('S2 the patcher REFUSES a file whose sha does not match', () => {
  const d=tmp(); const wrong=path.join(d,'x.js'); fs.writeFileSync(wrong,'// not the monitor\n');
  const r=spawnSync('python3',['/tmp/tmp.Jixo6zsSze/m2e001/staging/apply_m2e001.py',wrong],{encoding:'utf8'});
  assert.notStrictEqual(r.status,0);
  assert(/REFUSED/.test(r.stdout+r.stderr));
  fs.rmSync(d,{recursive:true,force:true});
});
console.log(''); console.log(`passed ${p}  failed ${f}`);
process.exit(f===0?0:1);
