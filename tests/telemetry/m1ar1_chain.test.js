'use strict';
/* M1A-R1 — the PRODUCTION CHAIN, offline:
   disk registry → validated → normalized contract → evaluator → reducer → evidence
   Every counterfactual is driven through the LOADER, never a handcrafted object. */
const assert=require('assert'), fs=require('fs'), path=require('path'), os=require('os');
const FB=require('./fixture_builder.js');

// M2-D epoch: heat's heartbeat is now ACTIVE, so fixtures must supply it too.
// Building only ACTIVE outputs leaves heat's heartbeat absent → FAIL, which is
// the evaluator working correctly on an outdated fixture.
function addActiveHeartbeats(reg, files, now, pids){
  for (const c of reg.components) {
    if (c.target.heartbeatActivation !== 'ACTIVE') continue;
    files[c.target.heartbeatPath] = { mtimeMs: now - 10000,
      data: JSON.stringify({ component:c.id, pid:(pids&&pids[c.id]?pids[c.id].pid:1),
        producerBuild:c.target.heartbeatProducerBuild, ts:new Date(now-10000).toISOString() })+'\n' };
  }
}
const S=path.resolve(__dirname,'..','staging','supervisor');
const L=require(path.join(S,'registry_loader.js'));
const observe=require(path.join(S,'observe.js'));
const REG=path.join(S,'components.json'), CON=path.join(S,'health_contracts.json');
let pass=0,fail=0;
const t=(n,f)=>{try{f();console.log('  OK   '+n);pass++;}catch(e){console.log('  FAIL '+n+'\n         '+e.message);fail++;}};
console.log('M1A-R1 — registry→health contract chain'); console.log('='.repeat(62));

const NOW=Date.parse('2026-09-03T09:00:00Z'), SESSION_START=Date.parse('2026-09-03T08:15:00Z');
const iso=(ago)=>new Date(NOW-ago).toISOString();
const mkfs=(f)=>({ statSync:(p)=>{if(!(p in f))throw new Error('ENOENT');return{mtimeMs:f[p].mtimeMs};},
                   readFileSync:(p)=>{if(!(p in f))throw new Error('ENOENT');return f[p].data;} });
const mkprobe=(m)=>({ pidOf:(id)=>(id in m?m[id].pid:null),
  isAlive:(pid)=>{for(const k of Object.keys(m))if(m[k].pid===pid)return m[k].alive;return false;} });
const loaded=()=>L.load(REG,{contracts:CON,strict:true});
const byId=(r,id)=>r.components.find(c=>c.id===id);
const run=(c,files,pids)=>observe.observeComponent(c,
  {now:NOW,sessionStartMs:SESSION_START,fs:mkfs(files),probe:mkprobe(pids),sessionId:'20260903_0315'});

// ── the chain loads and is health-complete ─────────────────────────────────
t('L1 the frozen registry + contracts loads STRICT and health-complete', () => {
  const r=loaded();
  assert.strictEqual(r.counts.invalid,0); assert.strictEqual(r.counts.incomplete,0);
  // R2: PROCESS_ONLY is now an honest per-EPOCH count. Heartbeat producers are
  // not deployed, so 5 components rest on PID alone TODAY — stated, not hidden.
  assert.strictEqual(r.counts.processOnly,5,'this epoch: 5 rest on PID alone');
  assert.strictEqual(r.counts.activeHeartbeat,2,'M2E-006: heat + volatility');
  assert.strictEqual(r.counts.total,8);
});
t('L1-CONTROL the FROZEN registry ALONE is NOT health-complete', () => {
  const bare=L.load(REG);
  // R2: 8, not R1's 7. The frozen registry's single object outputRecord
  // (volatility) declares no `format`, which R2 rejects as INVALID rather than
  // guessing a reading strategy — so it too falls back to process-only.
  assert.strictEqual(bare.counts.processOnly,8,'all 8 rest on PID alone without contracts');
  assert.throws(()=>L.load(REG,{requireComplete:true}),/not health-complete/);
  assert.strictEqual(bare.counts.activeOutput,0,'the frozen registry declares no ACTIVE output');
});
t('L2 every loaded component exposes the EXACT shape health.js consumes', () => {
  for (const c of loaded().components) {
    assert(typeof c.target.class==='string');
    assert(typeof c.target.heartbeatPath==='string','missing heartbeatPath: '+c.id);
    assert(['ACTIVE','PENDING_MIGRATION'].includes(c.target.heartbeatActivation),'activation: '+c.id);
    assert(typeof c.target.restart.maxAttempts==='number');
    if (c.target.outputRecord) {
      const o=c.target.outputRecord;
      assert(typeof o.format==='string','format required: '+c.id);
      // CLASS B — DECLARATION EPOCH: a MULTI-PATH contract declares paths[]
      // and per-leg deadlines rather than a single path/staleSec pair. The
      // invariant — every declared output exposes the shape its evaluator
      // consumes — is unchanged; the shape is format-dependent.
      if (o.multiPath) {
        assert(Array.isArray(o.paths) && o.paths.length,'multiPath needs paths: '+c.id);
        assert(typeof o.processingDeadlineSec==='number','multiPath needs a deadline: '+c.id);
        assert(o.path===undefined,'multiPath must NOT declare a single path: '+c.id);
      } else {
        assert(typeof o.staleSec==='number');
      }
      // R1: the required source field follows the provider's sourceKind. A
      // redis source has a keyPattern and deliberately NO path.
      assert(['filesystem','redis','none'].includes(o.sourceKind),'sourceKind: '+c.id);
      if (o.sourceKind==='redis') { assert(o.keyPattern,'keyPattern: '+c.id);
                                    assert(!('path' in o),'redis must expose no path: '+c.id); }
      // CLASS B — DECLARATION EPOCH: multiPath filesystem sources satisfy this
      // through paths[], asserted above. The invariant — a filesystem source
      // must expose its resolved location(s) — is unchanged.
      else if (!o.multiPath) assert(o.path,'path: '+c.id);
    }
  }
});
t('L3 current.* identity survives normalization unchanged', () => {
  const v=byId(loaded(),'volatility');
  assert.strictEqual(v.current.pidKey,'volatility');
  assert.strictEqual(v.current.pidRefers,'wrapper','INCIDENT 023 marker must survive');
});

// ── loader rejects rather than invents ─────────────────────────────────────
t('L4 heartbeat:true with no path is INCOMPLETE, never invented', () => {
  const iss=[]; const n=L.normalizeComponent({id:'x',target:{class:'RESTARTABLE',heartbeat:true}},iss);
  assert.strictEqual(n.target.heartbeatPath,undefined);
  assert(iss.some(i=>i.level==='INCOMPLETE'&&/heartbeatPath/.test(i.msg)));
});
t('L5 a bare-string output is INCOMPLETE, never guessed into a contract', () => {
  const iss=[]; const n=L.normalizeComponent({id:'x',target:{class:'RESTARTABLE',outputRecord:'foo.jsonl'}},iss);
  assert.strictEqual(n.target.outputRecord,undefined);
  assert(iss.some(i=>i.level==='INCOMPLETE'&&/bare string/.test(i.msg)));
});
t('L6 an unknown class is INVALID and STRICT refuses to load', () => {
  const f=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'m1r-')),'r.json');
  fs.writeFileSync(f,JSON.stringify({components:[{id:'x',target:{class:'BOGUS',heartbeatPath:'/h'}}]}));
  assert.throws(()=>L.load(f,{strict:true}),/INVALID/);
});
t('L7 a contract for an unknown id is INVALID, not silently added', () => {
  const cf=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'m1c-')),'c.json');
  fs.writeFileSync(cf,JSON.stringify({contracts:{ghost:{class:'RESTARTABLE',heartbeatPath:'/h'}}}));
  assert.throws(()=>L.load(REG,{contracts:cf,strict:true}),/INVALID/);
});
t('L8 duplicate ids and unparsable JSON throw with codes', () => {
  const d=fs.mkdtempSync(path.join(os.tmpdir(),'m1d-'));
  const a=path.join(d,'a.json'); fs.writeFileSync(a,'{ not json');
  try{L.load(a);assert.fail('should throw');}catch(e){assert.strictEqual(e.code,'REGISTRY_UNPARSABLE');}
  const b=path.join(d,'b.json'); fs.writeFileSync(b,JSON.stringify({components:[{id:'x'},{id:'x'}]}));
  try{L.load(b);assert.fail('should throw');}catch(e){assert.strictEqual(e.code,'REGISTRY_DUP_ID');}
});

// ══ COUNTERFACTUALS — now driven THROUGH the loaded registry ══════════════
t('C-F1 wrapper alive + worker dead → LEGACY_BLIND (loaded volatility)', () => {
  const v=byId(loaded(),'volatility');
  const r=run(v,{ [v.target.outputRecord.path]:{data:JSON.stringify({type:'volatility_scan',ts:iso(3600e3)})+'\n',mtimeMs:NOW}},
    {volatility:{pid:1264579,alive:true}});
  assert.strictEqual(r.legacy.state,'OK');
  assert.strictEqual(r.controlState,'FAILED');
  assert.strictEqual(r.comparison,'OLD_FALSE_HEALTH');
});
t('C-F2 fresh process log + stale records → DEGRADED (loaded thresholds)', () => {
  // CLASS B: volatility now has an ACTIVE heartbeat, so withholding it would
  // FAIL rather than DEGRADE. Supply it so the OUTPUT staleness is what is
  // under test — the invariant is unchanged.
  const v=byId(loaded(),'volatility');
  assert.strictEqual(v.target.outputRecord.staleSec,300,'threshold must come from the contract');
  const r=run(v,{ [v.target.outputRecord.path]:{data:JSON.stringify({type:'volatility_scan',ts:iso(400e3)})+'\n',mtimeMs:NOW},
    [v.target.heartbeatPath]:{data:JSON.stringify({heartbeatSchemaVersion:1,component:'volatility',
      cycle:'complete',workerPid:1,sessionId:'20260903_0315',producerBuild:v.target.heartbeatProducerBuild,
      ts:new Date(NOW-10000).toISOString()}),mtimeMs:NOW-10000}},
    {volatility:{pid:1,alive:true}});
  assert.strictEqual(r.controlState,'DEGRADED',r.controlReason);
  assert.strictEqual(r.wouldAction,'ALERT');
});
t('C-F3 quiet shadow_engine → PASSING (both authorities PENDING)', () => {
  // CLASS B — DECLARATION EPOCH. M2E-016 DECLARED a causal_coverage output
  // authority for shadow_engine at outputActivation PENDING_MIGRATION. The
  // invariant is unchanged: a DECLARED-but-inactive authority must not alter
  // the control verdict. Only the declaration's existence moved.
  const s=byId(loaded(),'shadow_engine');
  assert.strictEqual(s.target.outputRecord.format,'causal_coverage','declared');
  assert.strictEqual(s.target.outputActivation,'PENDING_MIGRATION','but NOT active');
  assert.strictEqual(s.target.heartbeatActivation,'PENDING_MIGRATION');
  const r=run(s,{},{shadow_engine:{pid:1,alive:true}});
  assert.strictEqual(r.controlState,'PASSING',r.controlReason);
});
t('C-F3-CONTROL a HUNG shadow_engine is caught ONCE heartbeat is ACTIVE', () => {
  const s0=byId(loaded(),'shadow_engine');
  const s={...s0,target:{...s0.target,heartbeatActivation:'ACTIVE'}};
  const r=run(s,{[s.target.heartbeatPath]:{mtimeMs:NOW-3600e3}},{shadow_engine:{pid:1,alive:true}});
  assert.strictEqual(r.controlState,'FAILED'); assert.strictEqual(r.legacy.state,'OK');
});
t('C-F4 prior-session record → FAILED (loaded contract)', () => {
  const v=byId(loaded(),'volatility');
  const r=run(v,{ [v.target.outputRecord.path]:{data:JSON.stringify({type:'volatility_scan',ts:'2026-09-03T08:00:00Z'})+'\n',mtimeMs:NOW}},
    {volatility:{pid:1,alive:true}});
  assert.strictEqual(r.controlState,'FAILED'); assert(/prior-session/.test(r.controlReason));
});
t('C-F5 notification_router: heartbeat is the authority, exit log is NOT output', () => {
  const n=byId(loaded(),'notification_router');
  assert.strictEqual(n.target.outputRecord,undefined,'the exit log is a DEATH record, not liveness');
  assert.strictEqual(n.target.heartbeatStaleSec,400,'must exceed the 300s heartbeat loop');
  const r=run(n,{},{notification_router:{pid:1,alive:true}});
  assert.strictEqual(r.controlState,'PASSING');
});
t('C-F6 the DEAD router (the real incident) → FAILED and RESTART would fire', () => {
  const n=byId(loaded(),'notification_router');
  const r=run(n,{},{notification_router:{pid:1264694,alive:false}});
  assert.strictEqual(r.controlState,'FAILED');
  assert.strictEqual(r.wouldAction,'RESTART','INCIDENT 022: this is what silently did NOT happen');
  assert.strictEqual(r.executed,false,'OBSERVE_ONLY');
});
t('C-F7 watchdog is NOT_RECOVERABLE, declared not attempted', () => {
  const w=byId(loaded(),'watchdog');
  const r=run(w,{},{watchdog:{pid:1264693,alive:false}});
  assert.strictEqual(r.wouldAction,'NOT_RECOVERABLE');
});

// ── full-stack aggregate ───────────────────────────────────────────────────
t('AG1 all 8 evaluate; aggregate is executedAnything:false', () => {
  const reg=loaded();
  const files={}; const pids={}; const prev={};
  for (const c of reg.components) {
    if(c.target.outputRecord && c.target.outputActivation==='ACTIVE') {
      files[c.target.outputRecord.path]= c.target.outputRecord.format==='jsonl_record'
        ? {data:JSON.stringify({type:c.target.outputRecord.recordType||'x',ts:iso(10e3)})+'\n',mtimeMs:NOW}
        : {data:'x\ny\n',mtimeMs:NOW-10e3};
      prev[c.id]={bytes:1};
    }
    pids[c.id]={pid:1000+reg.components.indexOf(c),alive:true}; }
  addActiveHeartbeats(reg,files,NOW,pids);
  // CLASS B: this loop supplied ACTIVE OUTPUTS only. volatility's heartbeat is
  // ACTIVE as of M2E-006, so withholding it made the component FAIL. Derive the
  // remaining evidence from the declaration.
  FB.buildEvidence(reg,{now:NOW,files,pids,prev,sessionId:'FIXTURE_SESSION'});
  const a=observe.observeAll(reg,{now:NOW,sessionStartMs:SESSION_START,sessionId:'FIXTURE_SESSION',fs:mkfs(files),probe:mkprobe(pids),previous:prev});
  assert.strictEqual(a.components.length,8);
  assert.strictEqual(a.executedAnything,false);
  assert.strictEqual(a.control.PASSING,8,JSON.stringify(a.control));
});
t('AG2 a single dead worker changes ONLY that component', () => {
  const reg=loaded(); const files={}; const pids={}; const prev={};
  for (const c of reg.components) {
    if(c.target.outputRecord && c.target.outputActivation==='ACTIVE') {
      const stale = c.id==='volatility';
      files[c.target.outputRecord.path]= c.target.outputRecord.format==='jsonl_record'
        ? {data:JSON.stringify({type:c.target.outputRecord.recordType||'x',ts:iso(stale?3600e3:10e3)})+'\n',mtimeMs:NOW}
        : {data:'x\ny\n',mtimeMs:NOW-10e3};
      prev[c.id]={bytes:1};
    }
    pids[c.id]={pid:1000+reg.components.indexOf(c),alive:true}; }
  addActiveHeartbeats(reg,files,NOW,pids);
  const a=observe.observeAll(reg,{now:NOW,sessionStartMs:SESSION_START,sessionId:'FIXTURE_SESSION',fs:mkfs(files),probe:mkprobe(pids),previous:prev});
  assert.strictEqual(a.control.PASSING,7); assert.strictEqual(a.control.FAILED,1);
  assert.strictEqual((a.comparison.OLD_FALSE_HEALTH||0),1,'the old boundary sees 8/8');
});
console.log(''); console.log(`passed ${pass}  failed ${fail}`);
process.exit(fail===0?0:1);
