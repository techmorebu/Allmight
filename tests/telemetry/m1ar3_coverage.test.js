'use strict';
/* M1A-R3 — coverage-aware certification + redis_ttl. Offline, injected everything. */
const assert=require('assert'), path=require('path');
const FB=require('./fixture_builder.js');

const S=path.resolve(__dirname,'..','staging','supervisor');
const L=require(path.join(S,'registry_loader.js')), P=require(path.join(S,'providers.js'));
const St=require(path.join(S,'state.js')), observe=require(path.join(S,'observe.js'));
const REG=path.join(S,'components.json'), CON=path.join(S,'health_contracts.json');
let pass=0,fail=0;
const t=(n,f)=>{try{f();console.log('  OK   '+n);pass++;}catch(e){console.log('  FAIL '+n+'\n         '+e.message);fail++;}};
console.log('M1A-R3 — coverage-aware health'); console.log('='.repeat(62));
const NOW=Date.parse('2026-09-03T09:00:00Z'), SS=Date.parse('2026-09-03T08:15:00Z');
const iso=(a)=>new Date(NOW-a).toISOString();
const mkfs=(f)=>({statSync:(p)=>{if(!(p in f))throw new Error('E');return{mtimeMs:f[p].mtimeMs};},
                  readFileSync:(p)=>{if(!(p in f))throw new Error('E');return f[p].data;}});
const mkprobe=(m)=>({pidOf:(id)=>(id in m?m[id].pid:null),
  isAlive:(pid)=>{for(const k of Object.keys(m))if(m[k].pid===pid)return m[k].alive;return false;}});
const loaded=()=>L.load(REG,{contracts:CON,strict:true});
const byId=(r,id)=>r.components.find(c=>c.id===id);
const run=(c,files,pids,extra)=>observe.observeComponent(c,
  Object.assign({now:NOW,sessionStartMs:SS,fs:mkfs(files),probe:mkprobe(pids),previous:{}},extra||{}));

// ══ R3-T1..T4 — pending REQUIRED authority blocks certification ═══════════
t('R3-T1 process PASS + heartbeat PENDING + output PENDING → NOT certified', () => {
  // CLASS B — DECLARATION EPOCH: shadow now declares a PENDING output too, so
  // TWO authorities are pending instead of one. The invariant is unchanged:
  // pending authorities prove nothing wrong and certify nothing.
  const c=byId(loaded(),'shadow_engine');
  const r=run(c,{},{shadow_engine:{pid:1,alive:true}});
  assert.strictEqual(r.processState,'ALIVE');
  assert.strictEqual(r.controlState,'PASSING','deployed authorities prove nothing wrong');
  assert.notStrictEqual(r.healthCertification,'CERTIFIED','but full health is UNVERIFIABLE');
  assert.deepStrictEqual(r.pendingAuthorities.sort(),['heartbeat','output']);
});
t('R3-T2 an ACTIVE output does NOT waive a DECLARED heartbeat requirement', () => {
  // CLASS B — SUBJECT SUBSTITUTION. This used volatility ONLY because its
  // heartbeat was PENDING; M2E-006 activated it. The invariant is generic, so
  // it now runs against a SYNTHETIC component rather than silently borrowing
  // another real one — that keeps the test independent of any future
  // activation, and the assertion is unchanged.
  const synth={ id:'synthetic', current:{}, target:{ class:'RESTARTABLE',
    heartbeatPath:'/hb/synthetic.hb', heartbeatStaleSec:120,
    heartbeatActivation:'PENDING_MIGRATION', heartbeatRequired:true,
    outputRecord:{ path:'/logs/synthetic.jsonl', format:'jsonl_record', sourceKind:'filesystem',
                   recordType:'synthetic_scan', staleSec:300, failedSec:600 },
    outputActivation:'ACTIVE', outputRequired:true } };
  const r=run(synth,{'/logs/synthetic.jsonl':{data:JSON.stringify({type:'synthetic_scan',ts:iso(10e3)})+'\n',mtimeMs:NOW}},
    {synthetic:{pid:1,alive:true}});
  assert.strictEqual(r.controlState,'PASSING');
  assert.strictEqual(r.healthCertification,'PARTIAL','output must not silently certify');
  assert.strictEqual(r.healthCoverage,'2/3');
  assert(r.pendingAuthorities.includes('heartbeat'));
});
t('R3-T3 a pending authority contributes to COVERAGE, never to PASS/FAIL', () => {
  const c=byId(loaded(),'monitor');
  const r=run(c,{},{monitor:{pid:1,alive:true}});
  const hb=r.signals.find(s=>s.signal==='heartbeat');
  assert.strictEqual(hb.state,'NOT_APPLICABLE','must not FAIL');
  assert(r.requiredAuthorities.includes('heartbeat'),'but must still be REQUIRED');
  assert(r.pendingAuthorities.includes('heartbeat'));
  assert.strictEqual(r.healthCoverage,'1/2');
});
t('R3-T4 coverageNote states what is missing, in words', () => {
  const r=run(byId(loaded(),'monitor'),{},{monitor:{pid:1,alive:true}});
  assert(/declared but not deployed/.test(r.coverageNote),r.coverageNote);
});
// ══ R3-T5 — activation enables certification ══════════════════════════════
t('R3-T5 an ACTIVE fresh heartbeat certifies when all required are covered', () => {
  const c0=byId(loaded(),'shadow_engine');
  const c={...c0,target:{...c0.target,heartbeatActivation:'ACTIVE'}};
  const r=run(c,{[c.target.heartbeatPath]:{mtimeMs:NOW-60e3}},{shadow_engine:{pid:1,alive:true}});
  // CLASS B — DECLARATION EPOCH: activating ONLY the heartbeat now leaves the
  // declared output still pending, so the component is NOT certified. That is
  // the activation gate working: a declared authority must be covered before
  // CERTIFIED is available. The original 2/2 assumed shadow had no output.
  assert.notStrictEqual(r.healthCertification,'CERTIFIED','output is still PENDING');
  assert.strictEqual(r.controlState,'PASSING');
  assert.strictEqual(r.healthCoverage,'2/3');
  assert.deepStrictEqual(r.pendingAuthorities,['output']);
});
t('R3-T5-CONTROL the SAME component uncertified while pending', () => {
  const c=byId(loaded(),'shadow_engine');
  const r=run(c,{},{shadow_engine:{pid:1,alive:true}});
  assert.notStrictEqual(r.healthCertification,'CERTIFIED','activation is the ONLY difference');
});
// ══ R3-T6..T8 — lifecycle still drives policy ═════════════════════════════
t('R3-T6 lifecycle FAILED still yields RESTART regardless of certification', () => {
  const n=byId(loaded(),'notification_router');
  const r=run(n,{},{notification_router:{pid:1264694,alive:false}});
  assert.strictEqual(r.controlState,'FAILED');
  assert.strictEqual(r.wouldAction,'RESTART');
  assert.strictEqual(r.processState,'NOT_ALIVE');
});
t('R3-T7 lifecycle DEGRADED from an ACTIVE output while certification is PARTIAL', () => {
  // CLASS B — SUBJECT SUBSTITUTION via a SYNTHETIC component. This used
  // volatility ONLY because its heartbeat was PENDING; M2E-006 activated it.
  // A synthetic subject keeps the invariant independent of future activations.
  const synth={ id:'synthetic', current:{}, target:{ class:'RESTARTABLE',
    heartbeatPath:'/hb/synthetic.hb', heartbeatStaleSec:120,
    heartbeatActivation:'PENDING_MIGRATION', heartbeatRequired:true,
    outputRecord:{ path:'/logs/synthetic.jsonl', format:'jsonl_record', sourceKind:'filesystem',
                   recordType:'synthetic_scan', staleSec:300, failedSec:600 },
    outputActivation:'ACTIVE', outputRequired:true } };
  const r=run(synth,{'/logs/synthetic.jsonl':{data:JSON.stringify({type:'synthetic_scan',ts:iso(400e3)})+'\n',mtimeMs:NOW}},
    {synthetic:{pid:1,alive:true}});
  assert.strictEqual(r.controlState,'DEGRADED');
  assert.strictEqual(r.healthCertification,'PARTIAL');
  assert.strictEqual(r.wouldAction,'ALERT');
});
t('R3-T8 watchdog stays NOT_RECOVERABLE and UNVERIFIABLE', () => {
  const w=byId(loaded(),'watchdog');
  const r=run(w,{},{watchdog:{pid:1,alive:false}});
  assert.strictEqual(r.wouldAction,'NOT_RECOVERABLE');
  assert.strictEqual(r.healthCertification,'UNVERIFIABLE');
});
// ══ R3-T9..T11 — redis_ttl typed provider ═════════════════════════════════
t('R3-T9 fetcher declares a typed redis_ttl contract, PENDING (no probe deployed)', () => {
  const f=byId(loaded(),'fetcher');
  assert.strictEqual(f.target.outputRecord.format,'redis_ttl');
  assert.strictEqual(f.target.outputActivation,'PENDING_MIGRATION');
  assert(P.get('redis_ttl'),'the provider must be IMPLEMENTED even while pending');
});
t('R3-T10 redis_ttl computes write-age from remaining TTL, with injected evidence', () => {
  const r=P.PROVIDERS.redis_ttl('', {keyPattern:'fetcher:*', ttlSec:120},
    {now:NOW, redis:{ keys:()=>['fetcher:ramses','fetcher:uni'], ttl:(k)=>k==='fetcher:uni'?100:40 }});
  assert.strictEqual(r.ok,true);
  assert.strictEqual(r.evidence.writtenAgoSec,20,'120 configured - 100 remaining');
  assert.strictEqual(r.evidence.key,'fetcher:uni','freshest key wins');
});
t('R3-T10-CONTROL no live key → not ok, with a reason', () => {
  const a=P.PROVIDERS.redis_ttl('',{keyPattern:'fetcher:*',ttlSec:120},{now:NOW,redis:{keys:()=>[],ttl:()=>-2}});
  assert.strictEqual(a.ok,false); assert(/no keys match/.test(a.reason));
  const b=P.PROVIDERS.redis_ttl('',{keyPattern:'fetcher:*',ttlSec:120},{now:NOW,redis:{keys:()=>['k'],ttl:()=>-2}});
  assert.strictEqual(b.ok,false); assert(/live TTL/.test(b.reason));
});
t('R3-T11 redis_ttl without an injected probe fails LOUDLY, never assumes', () => {
  const r=P.PROVIDERS.redis_ttl('',{keyPattern:'f:*',ttlSec:120},{now:NOW});
  assert.strictEqual(r.ok,false); assert(/requires an injected redis probe/.test(r.reason));
});
// ══ R3-T12..T14 — text_append growth + aggregate ══════════════════════════
t('R3-T12 text_append REQUIRES growth, not just a fresh mtime', () => {
  const grew=P.PROVIDERS.text_append('a\nb\nc\n',{},{mtimeMs:NOW,previous:{bytes:2}});
  assert.strictEqual(grew.ok,true); assert.strictEqual(grew.evidence.grew,true);
  const same=P.PROVIDERS.text_append('a\nb\nc\n',{},{mtimeMs:NOW,previous:{bytes:6}});
  assert.strictEqual(same.ok,false); assert(/did not grow/.test(same.reason));
});
t('R3-T13 first observation states growthUnknown rather than assuming', () => {
  const r=P.PROVIDERS.text_append('x\n',{},{mtimeMs:NOW});
  assert.strictEqual(r.ok,true); assert.strictEqual(r.evidence.growthUnknown,true);
});
t('R3-T14 the aggregate reports certifiedHealthy separately from lifecycle', () => {
  // CLASS B: derive evidence from declared authority state.
  const reg=loaded(); const files={},pids={},prev={};
  FB.buildEvidence(reg,{now:NOW,files,pids,prev,sessionId:'FIXTURE_SESSION'});
  const a=observe.observeAll(reg,{now:NOW,sessionStartMs:SS,sessionId:'FIXTURE_SESSION',fs:FB.vfs(files),probe:FB.probe(pids),previous:prev});
  assert.strictEqual(a.control.PASSING,8,'lifecycle: nothing deployed is broken');
  // CLASS A, after rows verified: heat's heartbeat producer IS deployed, so it
  // certifies. The property guarded here — control and health are SEPARATE
  // tallies — is unchanged: 8 passing, 1 certified.
  assert.strictEqual((a.health.HEALTHY||0),2,'M2E-006: heat AND volatility certified');
  assert.strictEqual(a.executedAnything,false);
  assert.strictEqual((a.health.UNVERIFIABLE||0)+(a.health.PARTIAL||0)+(a.health.HEALTHY||0),8);
});
t('R3-T14-CONTROL "8/8 healthy" is NOT claimable while ANY authority is pending', () => {
  const reg=loaded();
  // deliberately supply NO evidence: every component then has pending or failing
  // authorities, so the headline must not equal the component count.
  const a=observe.observeAll(reg,{now:NOW,sessionStartMs:SS,sessionId:'FIXTURE_SESSION',fs:mkfs({}),
    probe:{pidOf:()=>1,isAlive:()=>true},previous:{}});
  assert.notStrictEqual((a.health.HEALTHY||0),a.components.length,
    'the headline number must not equal the component count while authorities are pending');
});
console.log(''); console.log(`passed ${pass}  failed ${fail}`);
process.exit(fail===0?0:1);
