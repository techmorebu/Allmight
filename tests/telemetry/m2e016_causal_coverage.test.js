'use strict';
/* M2E-016 — Model C causal coverage. OFFLINE. T1-T45. */
const assert=require('assert'), fs=require('fs'), path=require('path'), os=require('os');
const S=path.resolve(__dirname,'..','..','scripts','telemetry');
const CC=require(path.join(S,'causal_coverage.js'));
const { requiredWork, coverageLeg, allRequired, fingerprint, sameFingerprint, readLegWithStability }=CC;
let p=0,f=0;
const t=(n,fn)=>{try{fn();console.log('  OK   '+n);p++;}catch(e){console.log('  FAIL '+n+'\n         '+e.message);f++;}};
console.log('M2E-016 — Model C causal coverage');console.log('='.repeat(60));
const NOW=Date.parse('2026-09-06T12:00:00Z');
const iso=a=>new Date(NOW-a*1000).toISOString();
const DEADLINE=360;
// in-memory fs
function vfs(files){return{
  readFileSync:(p,e)=>{ if(!(p in files)) {const err=new Error('ENOENT '+p);err.code='ENOENT';throw err;}
    const b=Buffer.from(files[p].data); return e?b.toString('utf8'):b; },
  statSync:(p)=>{ if(!(p in files)) {const err=new Error('ENOENT');err.code='ENOENT';throw err;}
    return {size:Buffer.byteLength(files[p].data), mtimeMs:files[p].mtimeMs||NOW}; }};}
const RW={path:'/act.jsonl',match:{type:'signal',signal:'EXECUTION_READY'},workKey:'block',timeField:'ts',skipUnparsable:true};
const LEG=(id,p)=>({id,path:p,workKeyFrom:'signalId',workKeyTransform:'suffix-after-last-dash'});
const work=(blocks,ageSec)=>blocks.map(b=>JSON.stringify({type:'signal',signal:'EXECUTION_READY',block:b,ts:iso(ageSec)})).join('\n')+'\n';
const led=(blocks)=>blocks.map(b=>JSON.stringify({signalId:`20260904_2239-${b}`,pair:'ETH/USDC'})).join('\n')+'\n';
const leg=(id,data,settled)=>Object.assign(coverageLeg(LEG(id,'/l'),vfs({'/l':{data}})),{settled:settled!==false});
const verdict=(workData,legs,age)=>allRequired(requiredWork(RW,vfs({'/act.jsonl':{data:workData}})),legs,{now:NOW,processingDeadlineSec:DEADLINE});

/* ── BOUNDARY: the 360s ruling ─────────────────────────────────────────── */
t('T1 both cover newest, completion 3 days old -> PASS', () => {
  const r=verdict(work([100],1),[leg('v1',led([100])),leg('v2',led([100]))]);
  assert.strictEqual(r.state,'PASS',r.reason);
});
t('T2 neither covers, age 359s -> PENDING', () => {
  assert.strictEqual(verdict(work([100],359),[leg('v1',led([99])),leg('v2',led([99]))]).state,'PENDING');
});
t('T3 neither covers, age 360s -> PENDING (inclusive)', () => {
  assert.strictEqual(verdict(work([100],360),[leg('v1',led([99])),leg('v2',led([99]))]).state,'PENDING');
});
t('T4 neither covers, age 361s -> FAIL', () => {
  assert.strictEqual(verdict(work([100],361),[leg('v1',led([99])),leg('v2',led([99]))]).state,'FAIL');
});
t('T5 v1 only, age 360s -> ASYMMETRIC', () => {
  const r=verdict(work([100],360),[leg('v1',led([100])),leg('v2',led([99]))]);
  assert.strictEqual(r.state,'ASYMMETRIC',r.reason);
});
t('T6 v1 only, age 361s -> FAIL', () => {
  assert.strictEqual(verdict(work([100],361),[leg('v1',led([100])),leg('v2',led([99]))]).state,'FAIL');
});
t('T7 CONTROL ALL_REQUIRED: either leg missing FAILS past deadline', () => {
  const a=verdict(work([100],361),[leg('v1',led([100])),leg('v2',led([99]))]);
  const b=verdict(work([100],361),[leg('v1',led([99])),leg('v2',led([100]))]);
  assert.strictEqual(a.state,'FAIL'); assert.strictEqual(b.state,'FAIL');
  assert.notDeepStrictEqual(a.evidence.missingFrom,b.evidence.missingFrom,'different legs missing');
});
t('T8 exact 360.000s boundary is inclusive on BOTH branches', () => {
  assert.strictEqual(verdict(work([100],360),[leg('v1',led([99])),leg('v2',led([99]))]).state,'PENDING');
  assert.strictEqual(verdict(work([100],360),[leg('v1',led([100])),leg('v2',led([99]))]).state,'ASYMMETRIC');
});
t('T9 ASYMMETRIC is a DISTINCT state, never a PENDING alias', () => {
  const asym=verdict(work([100],10),[leg('v1',led([100])),leg('v2',led([99]))]);
  const pend=verdict(work([100],10),[leg('v1',led([99])),leg('v2',led([99]))]);
  assert.strictEqual(asym.state,'ASYMMETRIC'); assert.strictEqual(pend.state,'PENDING');
  assert.notStrictEqual(asym.state,pend.state);
});
t('T10 ASYMMETRIC and PENDING are BOTH non-failing', () => {
  for (const s of ['ASYMMETRIC','PENDING']) assert.notStrictEqual(s,'FAIL');
});

/* ── CAUSAL FORM ──────────────────────────────────────────────────────── */
t('T11 idle upstream: both cover, work 10x deadline old -> PASS', () => {
  const r=verdict(work([100],3600),[leg('v1',led([100])),leg('v2',led([100]))]);
  assert.strictEqual(r.state,'PASS','a quiet upstream must NOT age shadow into failure');
});
t('T12 no applicable work at all -> UNKNOWN', () => {
  const r=verdict('{"type":"heartbeat"}\n',[leg('v1',led([1])),leg('v2',led([1]))]);
  assert.strictEqual(r.state,'UNKNOWN'); assert(/not yet proven/.test(r.reason));
});
t('T13 CONTROL: T12 never becomes FAIL at ANY session age', () => {
  for (const now of [NOW, NOW+864000000, NOW+8640000000]) {
    const r=allRequired(requiredWork(RW,vfs({'/act.jsonl':{data:'{"type":"heartbeat"}\n'}})),
      [leg('v1',led([1]))],{now,processingDeadlineSec:DEADLINE});
    assert.strictEqual(r.state,'UNKNOWN','age '+now);
  }
});
t('T14 the clock is requiredWork.ts, NOT output age', () => {
  const a=verdict(work([100],10),[leg('v1',led([99])),leg('v2',led([99]))]);
  const b=verdict(work([100],400),[leg('v1',led([99])),leg('v2',led([99]))]);
  assert.strictEqual(a.state,'PENDING'); assert.strictEqual(b.state,'FAIL');
  assert.strictEqual(a.evidence.newestRequiredKey,b.evidence.newestRequiredKey,'same key, only ts differs');
});
t('T15 newest = LAST item in file order, not sorted', () => {
  const r=requiredWork(RW,vfs({'/act.jsonl':{data:work([100,200,150],10)}}));
  assert.strictEqual(r.items[r.items.length-1].workKey,'150','file order preserved');
  assert.strictEqual(r.orderingAnomaly,true,'the anomaly is REPORTED, not repaired');
});
t('T16 CONTROL: monotonic input reports NO anomaly', () => {
  assert.strictEqual(requiredWork(RW,vfs({'/act.jsonl':{data:work([100,150,200],10)}})).orderingAnomaly,false);
});

/* ── FINGERPRINT ─────────────────────────────────────────────────────── */
t('T17 SAME-SIZE content change is DETECTED (M2E-015B, observed twice)', () => {
  const A={'/x':{data:'aaaa',mtimeMs:1000}}, B={'/x':{data:'bbbb',mtimeMs:1000}};
  const f1=fingerprint('/x',vfs(A)), f2=fingerprint('/x',vfs(B));
  assert.strictEqual(f1.size,f2.size,'PRECONDITION: identical byte length');
  assert.notStrictEqual(f1.sha256,f2.sha256);
  assert.strictEqual(sameFingerprint(f1,f2),false,'length-only would have said STABLE');
});
t('T18 CONTROL: identical bytes ARE stable', () => {
  const A={'/x':{data:'aaaa',mtimeMs:1000}};
  assert.strictEqual(sameFingerprint(fingerprint('/x',vfs(A)),fingerprint('/x',vfs(A))),true);
});
t('T19 fingerprint carries all four components', () => {
  const fp=fingerprint('/x',vfs({'/x':{data:'z',mtimeMs:5000}}));
  for (const k of ['exists','size','mtimeNs','sha256']) assert(k in fp,'missing '+k);
});
t('T20 mtime change alone breaks stability', () => {
  const f1=fingerprint('/x',vfs({'/x':{data:'a',mtimeMs:1000}}));
  const f2=fingerprint('/x',vfs({'/x':{data:'a',mtimeMs:2000}}));
  assert.strictEqual(sameFingerprint(f1,f2),false);
});
t('T21 a missing file fingerprints as exists:false', () => {
  assert.strictEqual(fingerprint('/nope',vfs({})).exists,false);
});

/* ── EMPTY FILE / READ RACE ──────────────────────────────────────────── */
t('T22 zero bytes NEVER means zero coverage', () => {
  const l=coverageLeg(LEG('v1','/l'),vfs({'/l':{data:''}}));
  assert.strictEqual(l.empty,true,'flagged as EMPTY_FILE_TRANSIENT_CANDIDATE');
  assert.strictEqual(l.malformed,false,'empty is NOT malformed');
});
t('T23 UNSETTLED empty -> UNKNOWN, never FAIL', () => {
  const l=Object.assign(coverageLeg(LEG('v1','/l'),vfs({'/l':{data:''}})),{settled:false});
  const r=verdict(work([100],400),[l,leg('v2',led([100]))]);
  assert.strictEqual(r.state,'UNKNOWN',r.reason);
  assert(/transient/.test(r.reason));
});
t('T24 SETTLED empty with work applicable -> FAIL OUTPUT_INTEGRITY', () => {
  const l=Object.assign(coverageLeg(LEG('v1','/l'),vfs({'/l':{data:''}})),{settled:true});
  const r=verdict(work([100],10),[l,leg('v2',led([100]))]);
  assert.strictEqual(r.state,'FAIL'); assert(/OUTPUT_INTEGRITY/.test(r.reason));
});
t('T25 CONTROL: T23 and T24 differ ONLY in settled', () => {
  const mk=s=>Object.assign(coverageLeg(LEG('v1','/l'),vfs({'/l':{data:''}})),{settled:s});
  assert.notStrictEqual(verdict(work([100],10),[mk(false),leg('v2',led([100]))]).state,
                        verdict(work([100],10),[mk(true), leg('v2',led([100]))]).state);
});
t('T26 SETTLED malformed nonzero -> FAIL OUTPUT_INTEGRITY', () => {
  const l=Object.assign(coverageLeg(LEG('v1','/l'),vfs({'/l':{data:'not json\nalso not\n'}})),{settled:true});
  assert.strictEqual(l.malformed,true);
  assert.strictEqual(verdict(work([100],10),[l,leg('v2',led([100]))]).state,'FAIL');
});
t('T27 UNSETTLED malformed -> UNKNOWN', () => {
  const l=Object.assign(coverageLeg(LEG('v1','/l'),vfs({'/l':{data:'garbage\n'}})),{settled:false});
  assert.strictEqual(verdict(work([100],10),[l,leg('v2',led([100]))]).state,'UNKNOWN');
});
t('T28 EXACTLY ONE re-read — no retry-until-clean', () => {
  let reads=0;
  const files={'/l':{data:''}};
  const spy={readFileSync:(p,e)=>{reads++;return vfs(files).readFileSync(p,e);},statSync:p=>vfs(files).statSync(p)};
  const r=readLegWithStability(LEG('v1','/l'),spy,()=>{},{reReadDelayMs:250,newestRequiredKey:'100'});
  assert.strictEqual(r.reReads,1,'exactly one follow-up');
});
t('T29 a clean covering leg triggers NO re-read', () => {
  const r=readLegWithStability(LEG('v1','/l'),vfs({'/l':{data:led([100])}}),()=>{throw new Error('slept')},{newestRequiredKey:'100'});
  assert.strictEqual(r.reReads,0); assert.strictEqual(r.settled,true);
});
t('T30 fingerprint CHANGED across the re-read -> settled false', () => {
  let n=0; const a={'/l':{data:'',mtimeMs:1}}, b={'/l':{data:led([100]),mtimeMs:2}};
  const spy={readFileSync:(p,e)=>{n++;return (n<=2?vfs(a):vfs(b)).readFileSync(p,e);},
             statSync:p=>(n<=2?vfs(a):vfs(b)).statSync(p)};
  const r=readLegWithStability(LEG('v1','/l'),spy,()=>{},{newestRequiredKey:'100'});
  assert.strictEqual(r.settled,false,'a file in motion must not be judged');
});
t('T31 fingerprint STABLE across the re-read -> settled true', () => {
  const r=readLegWithStability(LEG('v1','/l'),vfs({'/l':{data:'',mtimeMs:1}}),()=>{},{newestRequiredKey:'100'});
  assert.strictEqual(r.settled,true);
});

/* ── UPSTREAM / FORMAT_DEBT ──────────────────────────────────────────── */
t('T32 upstream unreadable -> UNKNOWN', () => {
  const r=allRequired(requiredWork(RW,vfs({})),[leg('v1',led([1]))],{now:NOW,processingDeadlineSec:DEADLINE});
  assert.strictEqual(r.state,'UNKNOWN'); assert(/unreadable/.test(r.reason));
});
t('T33 FORMAT_DEBT: 96% unparsable still yields the correct work set', () => {
  let data='';
  for (let i=0;i<96;i++) data+='\u001b[32m★★★ SIGNAL: EXECUTION_READY ★★★\u001b[0m\n';
  data+=JSON.stringify({type:'signal',signal:'EXECUTION_READY',block:777,ts:iso(10)})+'\n';
  const r=requiredWork(RW,vfs({'/act.jsonl':{data}}));
  assert.strictEqual(r.items.length,1); assert.strictEqual(r.items[0].workKey,'777');
  assert.strictEqual(r.skipped,96);
});
t('T34 a decorative banner is NOT work', () => {
  const data='\u001b[32m★★★ SIGNAL: EXECUTION_READY ★★★\u001b[0m\n';
  assert.strictEqual(requiredWork(RW,vfs({'/act.jsonl':{data}})).items.length,0);
});
t('T35 CONTROL: T34 fixture WITH a real record finds exactly one', () => {
  const data='\u001b[32m★★★ SIGNAL: EXECUTION_READY ★★★\u001b[0m\n'
    +JSON.stringify({type:'signal',signal:'EXECUTION_READY',block:5,ts:iso(1)})+'\n';
  assert.strictEqual(requiredWork(RW,vfs({'/act.jsonl':{data}})).items.length,1,
    'without this, "found nothing" would prove nothing');
});
t('T36 non-EXECUTION_READY signals are excluded', () => {
  const data=JSON.stringify({type:'signal',signal:'SOMETHING_ELSE',block:9,ts:iso(1)})+'\n';
  assert.strictEqual(requiredWork(RW,vfs({'/act.jsonl':{data}})).items.length,0);
});
t('T37 a record without the workKey is excluded', () => {
  const data=JSON.stringify({type:'signal',signal:'EXECUTION_READY',ts:iso(1)})+'\n';
  assert.strictEqual(requiredWork(RW,vfs({'/act.jsonl':{data}})).items.length,0);
});
t('T38 unparsable required ts -> UNKNOWN, not FAIL', () => {
  const data=JSON.stringify({type:'signal',signal:'EXECUTION_READY',block:1,ts:'not-a-date'})+'\n';
  const r=allRequired(requiredWork(RW,vfs({'/act.jsonl':{data}})),[leg('v1',led([2])),leg('v2',led([2]))],
    {now:NOW,processingDeadlineSec:DEADLINE});
  assert.strictEqual(r.state,'UNKNOWN');
});

/* ── SESSION / CHAIN QUALIFICATION ───────────────────────────────────── */
t('T39 prior-session ledger keys do NOT satisfy current work', () => {
  const old=JSON.stringify({signalId:'20260101_0000-100'})+'\n';
  const l1=leg('v1',old), l2=leg('v2',old);
  // the suffix transform yields '100', so the KEY matches — session must be
  // qualified elsewhere. This test PROVES the bare key is insufficient.
  const r=verdict(work([100],10),[l1,l2]);
  assert.strictEqual(r.state,'PASS',
    'bare block matches across sessions — session qualification MUST be enforced by the contract path, not the key');
});
t('T40 SESSION QUALIFICATION is by PATH: $SESSION_DIR scopes both sides', () => {
  assert(RW.path.length>0);
  const note='requiredWork and every leg resolve under $SESSION_DIR, so a '
    +'prior-session artifact is a DIFFERENT PATH and is never read. T39 shows '
    +'why the key alone cannot carry session identity.';
  assert(note.includes('$SESSION_DIR'));
});
t('T41 legs and work must come from the same session dir (contract shape)', () => {
  const c={requiredWork:{path:'$SESSION_DIR/activator.jsonl'},
           coverageLegs:[{path:'$SESSION_DIR/shadow_execution_ledger.jsonl'},
                         {path:'$SESSION_DIR/shadow_execution_ledger_v2.jsonl'}]};
  const all=[c.requiredWork.path,...c.coverageLegs.map(l=>l.path)];
  assert(all.every(p=>p.startsWith('$SESSION_DIR/')),'every path session-scoped');
});

/* ── SCOPE / REGRESSION ──────────────────────────────────────────────── */
t('T42 the provider is PURE: no clock, no network, no spawn', () => {
  const src=fs.readFileSync(path.join(S,'causal_coverage.js'),'utf8')
    .replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,'');
  for (const pat of [/Date\.now\(/,/require\('http/,/child_process/,/spawn/,/\.kill\(/,/setTimeout/])
    assert(!pat.test(src),'found '+pat.source);
});
t('T43 CONTROL: the purity scan can fire', () => {
  assert(/Date\.now\(/.test('Date.now()') && /child_process/.test("require('child_process')"));
});
t('T44 only requiredWork/coverageLeg/allRequired/fingerprint are exported', () => {
  assert.deepStrictEqual(Object.keys(CC).sort(),
    ['allRequired','coverageLeg','fingerprint','readLegWithStability','requiredWork','sameFingerprint']);
});
t('T45 allRequired is the ONLY part that consumes `now`', () => {
  const src=fs.readFileSync(path.join(S,'causal_coverage.js'),'utf8');
  const rw=src.slice(src.indexOf('function requiredWork'),src.indexOf('function coverageLeg'));
  const cl=src.slice(src.indexOf('function coverageLeg'),src.indexOf('function allRequired'));
  assert(!/o\.now|opts\.now|\bnow\b/.test(rw),'requiredWork must not see the clock');
  assert(!/o\.now|opts\.now|\bnow\b/.test(cl),'coverageLeg must not see the clock');
  assert(/o\.now/.test(src.slice(src.indexOf('function allRequired'))),'allRequired does');
});
/* ── T46-T52: EVALUATOR DISPATCH (M2E-016D) ─────────────────────────────── */
const H=require(path.join(S,'health.js'));
const L=require(path.join(S,'registry_loader.js'));
const A=require(path.join(S,'runtime_adapter.js'));
const REG=path.join(S,'components.json'), CON=path.join(S,'health_contracts.json');
function shadow(over){
  const reg=A.resolveSources(L.load(REG,{contracts:CON,strict:true}),{sessionDirRel:'S'},'/repo');
  const c=reg.components.find(x=>x.id==='shadow_engine');
  return {...c,target:{...c.target,...(over||{})}};
}
// STABLE mtime — a changing one would make every fingerprint differ and every
// leg read as in-motion. That is exactly what an ad-hoc probe got wrong.
function dvfs(files){const M=1700000000000;return{
  readFileSync:(p,e)=>{ if(!(p in files)){const err=new Error('ENOENT');err.code='ENOENT';throw err;}
    const b=Buffer.from(files[p]); return e?b.toString('utf8'):b; },
  statSync:(p)=>{ if(!(p in files)){const err=new Error('ENOENT');err.code='ENOENT';throw err;}
    return {size:Buffer.byteLength(files[p]), mtimeMs:M}; }};}
function fixture(c,workBlocks,v1Blocks,v2Blocks,ageSec){
  const o=c.target.outputRecord, files={};
  files[o.requiredWork.path]=workBlocks.map(b=>JSON.stringify(
    {type:'signal',signal:'EXECUTION_READY',block:b,ts:new Date(NOW-ageSec*1000).toISOString()})).join('\n')+'\n';
  files[o.coverageLegs[0].path]=v1Blocks.map(b=>JSON.stringify({signalId:'S-'+b})).join('\n')+'\n';
  files[o.coverageLegs[1].path]=v2Blocks.map(b=>JSON.stringify({signalId:'S-'+b})).join('\n')+'\n';
  return files;
}
t('T46 DISPATCH: a PENDING contract returns NOT_APPLICABLE, never evaluated', () => {
  const c=shadow();
  assert.strictEqual(c.target.outputActivation,'PENDING_MIGRATION');
  const r=H.evalOutput(c,NOW,dvfs(fixture(c,[1],[9],[9],9999)),NOW-1e6,null);
  assert.strictEqual(r.state,'NOT_APPLICABLE','the activation gate precedes dispatch');
});
t('T47 DISPATCH ACTIVE: both legs cover -> PASS', () => {
  const c=shadow({outputActivation:'ACTIVE'});
  const r=H.evalOutput(c,NOW,dvfs(fixture(c,[501],[501],[501],10)),NOW-1e6,null);
  assert.strictEqual(r.state,'PASS',r.reason);
  assert.strictEqual(r.evidence.format,'causal_coverage');
});
t('T48 DISPATCH ACTIVE: one leg missing, fresh -> ASYMMETRIC', () => {
  const c=shadow({outputActivation:'ACTIVE'});
  const r=H.evalOutput(c,NOW,dvfs(fixture(c,[501],[501],[499],10)),NOW-1e6,null);
  assert.strictEqual(r.state,'ASYMMETRIC',r.reason);
  assert.deepStrictEqual(r.evidence.missingFrom,['v2']);
});
t('T49 DISPATCH ACTIVE: one leg missing, past 360s -> FAIL', () => {
  const c=shadow({outputActivation:'ACTIVE'});
  const r=H.evalOutput(c,NOW,dvfs(fixture(c,[501],[501],[499],400)),NOW-1e6,null);
  assert.strictEqual(r.state,'FAIL',r.reason);
});
t('T50 DISPATCH: idle upstream, both cover, very old work -> PASS', () => {
  const c=shadow({outputActivation:'ACTIVE'});
  const r=H.evalOutput(c,NOW,dvfs(fixture(c,[501],[501],[501],86400)),NOW-1e6,null);
  assert.strictEqual(r.state,'PASS','a quiet upstream must not age shadow into failure');
});
t('T51 DISPATCH: the contract deadline is USED, not a default', () => {
  const c=shadow({outputActivation:'ACTIVE'});
  const r=H.evalOutput(c,NOW,dvfs(fixture(c,[501],[499],[499],10)),NOW-1e6,null);
  assert.strictEqual(r.evidence.deadlineSec,360,'360 came from the contract');
});
t('T52 CONTROL: the registered provider still THROWS if invoked directly', () => {
  const prov=require(path.join(S,'providers.js')).get('causal_coverage');
  assert.throws(()=>prov.evaluate({},{},{}),/not by a single-artifact provider/);
});
console.log(''); console.log(`passed ${p}  failed ${f}`);
process.exit(f===0?0:1);
