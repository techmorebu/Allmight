'use strict';
/* M2E-004 — volatility evaluator contract. OFFLINE. health.js is NOT deployed. */
const assert=require('assert'), fs=require('fs'), path=require('path'), os=require('os');
const S=path.resolve(__dirname,'..','..','scripts','telemetry');
const L=require(path.join(S,'registry_loader.js')), health=require(path.join(S,'health.js'));
const REG=path.join(S,'components.json'), CON=path.join(S,'health_contracts.json');
let p=0,f=0;
const t=(n,fn)=>{try{fn();console.log('  OK   '+n);p++;}catch(e){console.log('  FAIL '+n+'\n         '+e.message);f++;}};
console.log('M2E-004 — volatility activation contract');console.log('='.repeat(60));
const NOW=Date.parse('2026-09-05T18:00:00Z');
const SESSION='20260904_2239';
const BUILD='volatility-hb-build-0455a658';
const load=()=>L.load(REG,{contracts:CON,strict:true});
const comp=(id)=>load().components.find(c=>c.id===id);
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'m2e4-'));
function hbFile(over,ageSec){
  const d=tmp(); const fp=path.join(d,'volatility.hb');
  const body=over===null?'not json':JSON.stringify(Object.assign({
    heartbeatSchemaVersion:1,component:'volatility',cycle:'complete',
    workerPid:1807908,sessionId:SESSION,cycleNumber:1,producerBuild:BUILD,
    ts:new Date(NOW-10000).toISOString(),intervalSec:0},over||{}));
  fs.writeFileSync(fp,body+'\n');
  const m=NOW-((ageSec===undefined?10:ageSec)*1000);
  fs.utimesSync(fp,new Date(m),new Date(m));
  return {dir:d,path:fp};
}
// ACTIVE fixture — the canonical contract with activation flipped for testing only
const active=(over)=>{const c=comp('volatility');
  return {...c,target:{...c.target,heartbeatActivation:'ACTIVE',...(over||{})}};};
const ev=(c,hb,pid,session,startMs)=>health.evalHeartbeat(
  {...c,target:{...c.target,heartbeatPath:hb}},NOW,fs,
  pid===undefined?1668737:pid, session===undefined?SESSION:session,
  startMs===undefined?NOW-100000:startMs);

t('C0 canonical contract: activation still PENDING, values ratified', () => {
  const v=comp('volatility').target;
  assert.strictEqual(v.heartbeatActivation,'PENDING_MIGRATION','activation NOT performed');
  assert.strictEqual(v.heartbeatStaleSec,180);
  assert.strictEqual(v.heartbeatStartupGraceSec,240);
  assert.strictEqual(v.heartbeatSessionBound,true);
  assert.strictEqual(v.heartbeatPidBound,false);
  assert.strictEqual(v.heartbeatSchemaVersion,1);
});
t('A1 correct record, right session, fresh -> PASS', () => {
  const h=hbFile({},10); const r=ev(active(),h.path);
  assert.strictEqual(r.state,'PASS',JSON.stringify(r));
  assert.strictEqual(r.evidence.sessionId,SESSION);
  assert.strictEqual(r.evidence.pidBound,false,'evidence must record WHY pid was not enforced');
  fs.rmSync(h.dir,{recursive:true,force:true});
});
t('A2 WRONG session -> FAIL', () => {
  const h=hbFile({sessionId:'20260101_0000'},10);
  const r=ev(active(),h.path);
  assert.strictEqual(r.state,'FAIL'); assert(/carry-over/.test(r.reason),r.reason);
  fs.rmSync(h.dir,{recursive:true,force:true});
});
t('A3 sessionId null -> FAIL (absence is not identity)', () => {
  const h=hbFile({sessionId:null},10); const r=ev(active(),h.path);
  assert.strictEqual(r.state,'FAIL'); assert(/absence is not identity/.test(r.reason),r.reason);
  fs.rmSync(h.dir,{recursive:true,force:true});
});
t('A3b sessionId ABSENT -> FAIL', () => {
  const h=hbFile({sessionId:undefined},10); const r=ev(active(),h.path);
  assert.strictEqual(r.state,'FAIL');
  fs.rmSync(h.dir,{recursive:true,force:true});
});
t('A4 PID MISMATCH -> PASS (pidBound false)', () => {
  const h=hbFile({workerPid:999999},10);
  const r=ev(active(),h.path,1668737);   // expectedPid = the WRAPPER, never matches
  assert.strictEqual(r.state,'PASS',JSON.stringify(r));
  fs.rmSync(h.dir,{recursive:true,force:true});
});
t('A4c CONSTITUTIONAL CONTROL: the SAME record FAILS under a pid-bound contract', () => {
  const h=hbFile({workerPid:999999,component:'heat',producerBuild:'heat-hb-build-5de9d400'},10);
  const heat=comp('heat');
  const bound={...heat,target:{...heat.target,heartbeatActivation:'ACTIVE',heartbeatPath:h.path}};
  const r=health.evalHeartbeat(bound,NOW,fs,1668739,SESSION,NOW-100000);
  assert.strictEqual(r.state,'FAIL','pid enforcement must still work where the contract binds it');
  assert(/pid 999999 != canonical/.test(r.reason),r.reason);
  fs.rmSync(h.dir,{recursive:true,force:true});
});
t('A4d COMPAT: heat uses `pid`, volatility uses `workerPid` — both understood', () => {
  const hp=hbFile({component:'heat',producerBuild:'heat-hb-build-5de9d400',
    workerPid:undefined,pid:1668739},10);
  const heat=comp('heat');
  const r=health.evalHeartbeat({...heat,target:{...heat.target,heartbeatActivation:'ACTIVE',heartbeatPath:hp.path}},
    NOW,fs,1668739,SESSION,NOW-100000);
  assert.strictEqual(r.state,'PASS','legacy `pid` must still satisfy a pid-bound contract');
  fs.rmSync(hp.dir,{recursive:true,force:true});
});
t('A5 wrong producerBuild -> FAIL', () => {
  const h=hbFile({producerBuild:'IMPOSTOR'},10); const r=ev(active(),h.path);
  assert.strictEqual(r.state,'FAIL'); assert(/not the deployed build/.test(r.reason));
  fs.rmSync(h.dir,{recursive:true,force:true});
});
t('A6 wrong schemaVersion -> FAIL', () => {
  const h=hbFile({heartbeatSchemaVersion:2},10); const r=ev(active(),h.path);
  assert.strictEqual(r.state,'FAIL'); assert(/refusing to interpret an unknown contract/.test(r.reason));
  fs.rmSync(h.dir,{recursive:true,force:true});
});
t('A7 stale beyond 180s -> FAIL; 180s exactly -> PASS', () => {
  const a=hbFile({},181); assert.strictEqual(ev(active(),a.path).state,'FAIL');
  const b=hbFile({},180); assert.strictEqual(ev(active(),b.path).state,'PASS','the boundary is inclusive');
  fs.rmSync(a.dir,{recursive:true,force:true}); fs.rmSync(b.dir,{recursive:true,force:true});
});
t('A8 absent WITHIN the 240s startup grace -> UNKNOWN', () => {
  const r=ev(active(),'/nonexistent/volatility.hb',1668737,SESSION,NOW-120000);
  assert.strictEqual(r.state,'UNKNOWN',JSON.stringify(r));
  assert(/NOT YET OBSERVED/.test(r.reason),r.reason);
});
t('A9 absent BEYOND the grace -> FAIL', () => {
  const r=ev(active(),'/nonexistent/volatility.hb',1668737,SESSION,NOW-300000);
  assert.strictEqual(r.state,'FAIL'); assert(/absent/.test(r.reason));
});
t('A9b the grace boundary is enforced on both sides', () => {
  assert.strictEqual(ev(active(),'/none.hb',1668737,SESSION,NOW-240000).state,'UNKNOWN');
  assert.strictEqual(ev(active(),'/none.hb',1668737,SESSION,NOW-241000).state,'FAIL');
});
t('A10 malformed JSON -> FAIL', () => {
  const h=hbFile(null,10); const r=ev(active(),h.path);
  assert.strictEqual(r.state,'FAIL'); assert(/MALFORMED/.test(r.reason));
  fs.rmSync(h.dir,{recursive:true,force:true});
});
t('A10b evaluator with NO current session -> UNKNOWN, not a false PASS', () => {
  const h=hbFile({},10); const r=ev(active(),h.path,1668737,null);
  assert.strictEqual(r.state,'UNKNOWN'); assert(/no current session/.test(r.reason));
  fs.rmSync(h.dir,{recursive:true,force:true});
});
t('A11 PENDING activation still short-circuits everything', () => {
  const h=hbFile({sessionId:'WRONG',producerBuild:'BAD'},9999);
  const r=ev(comp('volatility'),h.path);   // canonical = PENDING
  assert.strictEqual(r.state,'NOT_APPLICABLE','a pending contract consults nothing');
  fs.rmSync(h.dir,{recursive:true,force:true});
});
t('B1 CYCLE: payload.cycle != "complete" -> FAIL even when fresh', () => {
  for (const bad of ['started','partial','error','',null]) {
    const h=hbFile({cycle:bad},5);
    const r=ev(active(),h.path);
    assert.strictEqual(r.state,'FAIL','cycle='+JSON.stringify(bad)+' must not pass: '+r.reason);
    assert(/does not assert a completed cycle/.test(r.reason),r.reason);
    fs.rmSync(h.dir,{recursive:true,force:true});
  }
});
t('B1b CYCLE ABSENT -> FAIL', () => {
  const h=hbFile({cycle:undefined},5); const r=ev(active(),h.path);
  assert.strictEqual(r.state,'FAIL'); assert(/<absent>/.test(r.reason),r.reason);
  fs.rmSync(h.dir,{recursive:true,force:true});
});
t('B1c CONTROL: cycle="complete" with everything else valid -> PASS', () => {
  const h=hbFile({cycle:'complete'},5);
  assert.strictEqual(ev(active(),h.path).state,'PASS','the check must be able to pass');
  fs.rmSync(h.dir,{recursive:true,force:true});
});
t('B1d heat is NOT cycle-bound — its contract declares no heartbeatCycle', () => {
  const heat=comp('heat');
  assert.strictEqual(heat.target.heartbeatCycle,undefined,'heat must be unaffected');
  const h=hbFile({component:'heat',producerBuild:'heat-hb-build-5de9d400',cycle:undefined,
    workerPid:undefined,pid:1668739},5);
  const r=health.evalHeartbeat({...heat,target:{...heat.target,heartbeatActivation:'ACTIVE',heartbeatPath:h.path}},
    NOW,fs,1668739,SESSION,NOW-100000);
  assert.strictEqual(r.state,'PASS','a contract without heartbeatCycle must not require one');
  fs.rmSync(h.dir,{recursive:true,force:true});
});
t('B2 FUTURE MTIME -> FAIL, never "fresh"', () => {
  const h=hbFile({},-3600);            // mtime one hour AHEAD of now
  const r=ev(active(),h.path);
  assert.strictEqual(r.state,'FAIL',JSON.stringify(r));
  assert(/in the FUTURE/.test(r.reason),r.reason);
  assert.strictEqual(r.evidence.futureByMs,3600000);
  fs.rmSync(h.dir,{recursive:true,force:true});
});
t('B2b CONTROL: the OLD comparison would have PASSED that file', () => {
  // ageSec = -3600; -3600 <= 180 is true. This is why the guard is needed.
  const ageSec=-3600, stale=180;
  assert.strictEqual(ageSec <= stale,true,'the unguarded check accepts a future file');
});
t('B2c ZERO POSITIVE ALLOWANCE: any future mtime is rejected', () => {
  // The directive requires mtime > now => FAIL with no tolerance. An earlier
  // draft carried a 5s window over from the session-pointer guard; that was
  // never ratified here, and any window is a gap a touched file can pass in.
  for (const ahead of [1,2,5,6,60]) {
    const h=hbFile({},-ahead);
    assert.strictEqual(ev(active(),h.path).state,'FAIL',ahead+'s ahead must FAIL');
    fs.rmSync(h.dir,{recursive:true,force:true});
  }
  const now0=hbFile({},0);
  assert.strictEqual(ev(active(),now0.path).state,'PASS','mtime == now is NOT future');
  fs.rmSync(now0.dir,{recursive:true,force:true});
});
t('B3 PAYLOAD TS: missing or unparsable -> FAIL', () => {
  for (const bad of [undefined,'','not-a-date','2026-13-45T99:99:99Z']) {
    const h=hbFile({ts:bad},5); const r=ev(active(),h.path);
    assert.strictEqual(r.state,'FAIL','ts='+JSON.stringify(bad)+': '+r.reason);
    assert(/missing or unparsable/.test(r.reason),r.reason);
    fs.rmSync(h.dir,{recursive:true,force:true});
  }
});
t('B3b PAYLOAD TS in the future -> FAIL, with ZERO allowance', () => {
  for (const aheadMs of [1,1000,5000,3600000]) {
    const h=hbFile({ts:new Date(NOW+aheadMs).toISOString()},5);
    const r=ev(active(),h.path);
    assert.strictEqual(r.state,'FAIL',aheadMs+'ms ahead must FAIL: '+r.reason);
    assert(/ts > now is never valid/.test(r.reason),r.reason);
    fs.rmSync(h.dir,{recursive:true,force:true});
  }
  const eq=hbFile({ts:new Date(NOW).toISOString()},5);
  assert.strictEqual(ev(active(),eq.path).state,'PASS','ts == now is NOT future');
  fs.rmSync(eq.dir,{recursive:true,force:true});
});
t('B3c CONTROL: a valid ts passes and is recorded in evidence', () => {
  const h=hbFile({},5); const r=ev(active(),h.path);
  assert.strictEqual(r.state,'PASS');
  assert(r.evidence.payloadTs,'the verified ts must appear in evidence');
  fs.rmSync(h.dir,{recursive:true,force:true});
});
t('B3d heat does NOT require ts — its contract omits heartbeatRequireTs', () => {
  const heat=comp('heat');
  assert.strictEqual(heat.target.heartbeatRequireTs,undefined);
  const h=hbFile({component:'heat',producerBuild:'heat-hb-build-5de9d400',ts:undefined,
    workerPid:undefined,pid:1668739},5);
  const r=health.evalHeartbeat({...heat,target:{...heat.target,heartbeatActivation:'ACTIVE',heartbeatPath:h.path}},
    NOW,fs,1668739,SESSION,NOW-100000);
  assert.strictEqual(r.state,'PASS','an undeclared requirement must not be enforced');
  fs.rmSync(h.dir,{recursive:true,force:true});
});
t('A12 the other six heartbeat authorities remain PENDING', () => {
  for (const c of load().components)
    if (c.id!=='heat') assert.strictEqual(c.target.heartbeatActivation,'PENDING_MIGRATION',c.id);
});
t('A13 loader preserves every identity field (IDENTITY_LOST invariant)', () => {
  const v=comp('volatility').target;
  for (const k of ['heartbeatProducerBuild','heartbeatSchemaVersion','heartbeatSessionBound',
                   'heartbeatPidBound','heartbeatStartupGraceSec','heartbeatCycle',
                   'heartbeatRequireTs'])
    assert(k in v,'lost during normalization: '+k);
});
console.log(''); console.log(`passed ${p}  failed ${f}`);
process.exit(f===0?0:1);
