'use strict';
/* M1A-R4 — canonical health vocabulary. The word HEALTHY must be unrepresentable
   unless certified. Offline, injected everything. */
const assert=require('assert'), fs=require('fs'), path=require('path');
const FB=require('./fixture_builder.js');

const S=path.resolve(__dirname,'..','staging','supervisor');
const L=require(path.join(S,'registry_loader.js')), St=require(path.join(S,'state.js'));
const observe=require(path.join(S,'observe.js'));
const REG=path.join(S,'components.json'), CON=path.join(S,'health_contracts.json');
let pass=0,fail=0;
const t=(n,f)=>{try{f();console.log('  OK   '+n);pass++;}catch(e){console.log('  FAIL '+n+'\n         '+e.message);fail++;}};
console.log('M1A-R4 — canonical health vocabulary'); console.log('='.repeat(62));
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
const fullStack=(over)=>{ const reg=loaded(); const files={},pids={},prev={};
  // CLASS B: evidence now derives from DECLARED authority state (fixture_builder),
  // so a newly ACTIVE authority is supplied automatically instead of withheld.
  FB.buildEvidence(reg,{now:NOW,files,pids,prev,sessionId:'FIXTURE_SESSION'});
  return observe.observeAll(reg,Object.assign({now:NOW,sessionStartMs:SS,sessionId:'FIXTURE_SESSION',fs:FB.vfs(files),
    probe:FB.probe(pids),previous:prev},over||{})); };

// ══ THE GOVERNING INVARIANT ═══════════════════════════════════════════════
t('R4-I1 searching every envelope for healthState HEALTHY finds ONLY certified ones', () => {
  const a=fullStack();
  for (const c of a.components)
    if (c.healthState==='HEALTHY')
      assert.strictEqual(c.healthCertification,'CERTIFIED','HEALTHY without certification: '+c.componentId);
  // CLASS A, after rows verified: heat certified under M2-D.
  assert.strictEqual(a.healthHeadline,'2/8 HEALTHY','M2E-006: heat + volatility');
});
t('R4-I2 NO canonical field carries HEALTHY while authorities are pending', () => {
  const a=fullStack();
  // CLASS A: the precondition was "EVERY component has pending authorities",
  // true only pre-M2-D. The INVARIANT is unchanged: no field may say HEALTHY
  // while THAT component has pending authorities. Scope it per component.
  for (const c of a.components) {
    if (c.pendingAuthorities.length === 0) {
      assert.strictEqual(c.healthCertification,'CERTIFIED',c.componentId+' has no pending yet is not certified');
      continue;
    }
    for (const f of ['controlState','healthState','state','status','health','lifecycleState'])
      assert.notStrictEqual(c[f],'HEALTHY',`field '${f}' says HEALTHY on ${c.componentId} while pending`);
  }
});
t('R4-I3 the envelope has NO bare `state` field at all', () => {
  const c=fullStack().components[0];
  assert.strictEqual('state' in c,false,'a bare `state` invites being read as THE verdict');
  assert('controlState' in c && 'healthState' in c,'both must be named for what they assert');
});
t('R4-I4 the CONTROL vocabulary contains no HEALTHY, by construction', () => {
  const src=fs.readFileSync(path.join(S,'state.js'),'utf8');
  const reduceBody=src.slice(src.indexOf('function reduce('),src.indexOf('/** What the supervisor'));
  assert(!/mk\('HEALTHY'/.test(reduceBody),'reduce() must never emit HEALTHY');
  assert(/mk\('PASSING'/.test(reduceBody));
});
t('R4-I4-CONTROL the scan can detect an emitted HEALTHY', () => {
  assert(/mk\('HEALTHY'/.test("return mk('HEALTHY', 'x');"),'the pattern must be able to fire');
});
t('R4-I5 healthVerdict is the ONLY producer of HEALTHY', () => {
  const cert={certification:'CERTIFIED',pendingAuthorities:[]};
  assert.strictEqual(St.healthVerdict('PASSING',cert).healthState,'HEALTHY');
  for (const cs of ['FAILED','DEGRADED','UNKNOWN'])
    assert.notStrictEqual(St.healthVerdict(cs,cert).healthState,'HEALTHY','breakage outranks certification');
  for (const c of ['PARTIAL','UNVERIFIABLE'])
    assert.notStrictEqual(St.healthVerdict('PASSING',{certification:c,pendingAuthorities:['heartbeat']}).healthState,'HEALTHY');
});
t('R4-I6 one field is safe alone: healthState HEALTHY implies full coverage', () => {
  // CLASS B — DECLARATION EPOCH: shadow_engine can no longer reach HEALTHY by
  // activating its heartbeat alone, because it now DECLARES a pending output.
  // The invariant under test is generic — HEALTHY implies nothing pending — so
  // it runs against a component whose authorities can all be covered.
  const s0=byId(loaded(),'shadow_engine');
  const s={...s0,target:{...s0.target,heartbeatActivation:'ACTIVE',
           outputRecord:undefined,outputActivation:undefined}};
  const r=run(s,{[s.target.heartbeatPath]:{mtimeMs:NOW-60e3}},{shadow_engine:{pid:1,alive:true}});
  assert.strictEqual(r.healthState,'HEALTHY');
  assert.strictEqual(r.pendingAuthorities.length,0,'HEALTHY must imply nothing pending');
  assert.strictEqual(r.healthCoverage,'2/2');
});
t('R4-I6-EPOCH the REAL shadow contract cannot reach HEALTHY on heartbeat alone', () => {
  // the same activation against the ACTUAL declared contract: output pending
  const s0=byId(loaded(),'shadow_engine');
  const s={...s0,target:{...s0.target,heartbeatActivation:'ACTIVE'}};
  const r=run(s,{[s.target.heartbeatPath]:{mtimeMs:NOW-60e3}},{shadow_engine:{pid:1,alive:true}});
  assert.notStrictEqual(r.healthState,'HEALTHY','a declared pending output withholds HEALTHY');
  assert.deepStrictEqual(r.pendingAuthorities,['output']);
});

// ══ COMPARISON TAXONOMY ═══════════════════════════════════════════════════
t('R4-C1 legacy OK + new PARTIAL → EXPECTED_SEMANTIC_DIFFERENCE, not agreement', () => {
  // CLASS B — SUBJECT SUBSTITUTION via a SYNTHETIC component. This used
  // volatility ONLY because its heartbeat was PENDING; M2E-006 activated it.
  // A synthetic subject keeps the invariant independent of future activations.
  const synth={ id:'synthetic', current:{}, target:{ class:'RESTARTABLE',
    heartbeatPath:'/hb/synthetic.hb', heartbeatStaleSec:120,
    heartbeatActivation:'PENDING_MIGRATION', heartbeatRequired:true,
    outputRecord:{ path:'/logs/synthetic.jsonl', format:'jsonl_record', sourceKind:'filesystem',
                   recordType:'synthetic_scan', staleSec:300, failedSec:600 },
    outputActivation:'ACTIVE', outputRequired:true } };
  const r=run(synth,{'/logs/synthetic.jsonl':{data:JSON.stringify({type:'synthetic_scan',ts:iso(1e4)})+'\n',mtimeMs:NOW}},
    {synthetic:{pid:1,alive:true}});
  assert.strictEqual(r.healthState,'PARTIAL');
  assert.strictEqual(r.comparison,'EXPECTED_SEMANTIC_DIFFERENCE');
  assert(/coverage gap, not a legacy error/.test(r.note),r.note);
});
t('R4-C2 legacy OK + new FAILED → OLD_FALSE_HEALTH (the A7 case)', () => {
  const v=byId(loaded(),'volatility');
  const r=run(v,{[v.target.outputRecord.path]:{data:JSON.stringify({type:'volatility_scan',ts:iso(3600e3)})+'\n',mtimeMs:NOW}},
    {volatility:{pid:1264579,alive:true}});
  assert.strictEqual(r.legacy.state,'OK');
  assert.strictEqual(r.healthState,'FAILED');
  assert.strictEqual(r.comparison,'OLD_FALSE_HEALTH');
});
t('R4-C3 legacy DEAD + new FAILED → AGREEMENT', () => {
  const n=byId(loaded(),'notification_router');
  const r=run(n,{},{notification_router:{pid:1264694,alive:false}});
  assert.strictEqual(r.comparison,'AGREEMENT');
  assert.strictEqual(r.wouldAction,'RESTART');
});
t('R4-C4 every emitted comparison is in the canonical taxonomy', () => {
  const a=fullStack();
  for (const c of a.components) assert(observe.COMPARISON.includes(c.comparison),'off-taxonomy: '+c.comparison);
  assert.strictEqual(a.comparison.EXPECTED_SEMANTIC_DIFFERENCE,6);
  assert.strictEqual(a.comparison.AGREEMENT,2,'heat and volatility: legacy OK + new HEALTHY');
});
t('R4-C5 LEGACY_BLIND / NEW_BLIND are GONE from the emitted envelope', () => {
  const c=fullStack().components[0];
  assert.strictEqual('disagreementClass' in c,false);
  for (const v of Object.values(c)) assert(v!=='LEGACY_BLIND'&&v!=='NEW_BLIND');
});
t('R4-C6 processAgreement is reported SEPARATELY from the health claim', () => {
  // CLASS B — SUBJECT SUBSTITUTION. Needs a component whose health claim is
  // WITHHELD while the process is alive; volatility no longer qualifies.
  const synth={ id:'synthetic', current:{}, target:{ class:'RESTARTABLE',
    heartbeatPath:'/hb/synthetic.hb', heartbeatStaleSec:120,
    heartbeatActivation:'PENDING_MIGRATION', heartbeatRequired:true,
    outputRecord:{ path:'/logs/synthetic.jsonl', format:'jsonl_record', sourceKind:'filesystem',
                   recordType:'synthetic_scan', staleSec:300, failedSec:600 },
    outputActivation:'ACTIVE', outputRequired:true } };
  const r=run(synth,{'/logs/synthetic.jsonl':{data:JSON.stringify({type:'synthetic_scan',ts:iso(1e4)})+'\n',mtimeMs:NOW}},
    {synthetic:{pid:1,alive:true}});
  assert.strictEqual(r.processAgreement,'AGREE','both agree the process is alive');
  assert.notStrictEqual(r.healthState,'HEALTHY','while the health claim is withheld');
});
// ══ headline + Discord mapping ════════════════════════════════════════════
t('R4-H1 the aggregate headline is the HEALTH tally, control named separately', () => {
  const a=fullStack();
  assert.strictEqual(a.healthHeadline,'2/8 HEALTHY');
  assert.strictEqual(a.control.PASSING,8,'control is reported but explicitly named control');
  assert.strictEqual(a.health.HEALTHY,2,'heat and volatility');
});
t('R4-H2 every healthState maps to a colour without a second field', () => {
  const COLOUR={HEALTHY:'green',PARTIAL:'yellow',UNVERIFIABLE:'yellow',DEGRADED:'amber',FAILED:'red',UNKNOWN:'yellow'};
  for (const s of St.HEALTH_STATES) assert(COLOUR[s],'no colour for '+s);
  for (const c of fullStack().components) assert(COLOUR[c.healthState],'unmappable: '+c.healthState);
});
console.log(''); console.log(`passed ${pass}  failed ${fail}`);
process.exit(fail===0?0:1);
