'use strict';
/* RTR-004 — bounded signal context. OFFLINE.
   No SIGINT is sent to any live AllMight process. Children signal THEMSELVES. */
const assert=require('assert'), fs=require('fs'), path=require('path'), os=require('os');
const { spawnSync }=require('child_process');
const SC=path.resolve(__dirname,'..','..','scripts','monitoring','signal_context.js');
const { collectSignalContext, ttyName, allmightTopology }=require(SC);
let p=0,f=0;
const t=(n,fn)=>{try{fn();console.log('  OK   '+n);p++;}catch(e){console.log('  FAIL '+n+'\n         '+e.message);f++;}};
console.log('RTR-004 — bounded signal-time context'); console.log('='.repeat(60));

t('C1 collects self lineage: pid ppid pgid sid tpgid', () => {
  const c=collectSignalContext({pidFilePath:'/nonexistent'});
  for (const k of ['pid','ppid','pgid','sid','tpgid']) assert(k in c.self, 'missing '+k);
  assert.strictEqual(c.self.pid, process.pid);
});
t('C2 TIME-001: the timestamp is UTC (ISO Z), never local', () => {
  const c=collectSignalContext({pidFilePath:'/nonexistent'});
  assert(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(c.capturedAtUtc), c.capturedAtUtc);
  assert(!/[+-]\d{2}:\d{2}$/.test(c.capturedAtUtc), 'must not carry a local offset');
  assert.strictEqual('capturedAtLocal' in c, false, 'no local field in stored evidence');
});
t('C3 foreground-group determination is present and boolean-or-null', () => {
  const c=collectSignalContext({pidFilePath:'/nonexistent'});
  assert([true,false,null].includes(c.self.inForegroundGroup));
});
t('C4 BOUNDED topology reads only the pid file, not the host', () => {
  const d=fs.mkdtempSync(path.join(os.tmpdir(),'rtr4-'));
  const pf=path.join(d,'allmight.pid');
  fs.writeFileSync(pf,`fetcher=${process.pid}\nnotification_router=999999\nbroken\n`);
  const c=collectSignalContext({pidFilePath:pf});
  assert.strictEqual(c.topology.length,2,'only parsed name=pid lines');
  const me=c.topology.find(x=>x.name==='fetcher');
  assert.strictEqual(me.alive,true,'this pid is alive');
  const gone=c.topology.find(x=>x.name==='notification_router');
  assert.strictEqual(gone.alive,false,'999999 is not alive');
  fs.rmSync(d,{recursive:true,force:true});
});
t('C5 NEVER THROWS: unreadable pid file yields null, not an exception', () => {
  const c=collectSignalContext({pidFilePath:'/root/definitely/not/readable'});
  assert.strictEqual(c.topology,null);
  assert(c.self,'self must still be collected');
});
t('C6 NEVER THROWS: a collector that throws is contained', () => {
  const c=collectSignalContext({pidFilePath:'/nonexistent',
    procStat:()=>{throw new Error('boom');}, topology:()=>{throw new Error('boom');}});
  assert(c.collectionErrors.length>0,'the failure must be RECORDED');
  assert(c.capturedAtUtc,'the timestamp still collected');
});
t('C7 no host dump: topology is bounded by the pid file only', () => {
  const src=fs.readFileSync(SC,'utf8').replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,'');
  for (const pat of [/readdirSync\(['"]\/proc/,/spawn/,/child_process/,/execSync/,/process\.env/])
    assert(!pat.test(src),'found '+pat.source);
});
t('C7-CONTROL the scan can fire', () => {
  assert(/readdirSync\(['"]\/proc/.test("fs.readdirSync('/proc')"));
  assert(/child_process/.test("require('child_process')"));
});
t('C8 no network / no dependency', () => {
  const src=fs.readFileSync(SC,'utf8');
  for (const pat of [/require\('http/,/fetch\(/,/axios/,/node-fetch/,/ethers/])
    assert(!pat.test(src),'found '+pat.source);
  const reqs=[...src.matchAll(/require\('([^']+)'\)/g)].map(m=>m[1]);
  assert.deepStrictEqual([...new Set(reqs)].sort(),['fs','path'],'built-ins only: '+reqs);
});
t('C9 signal 0 only — the probe delivers nothing', () => {
  const src=fs.readFileSync(SC,'utf8').replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,'');
  const kills=src.match(/process\.kill\([^)]*\)/g)||[];
  assert.strictEqual(kills.length,1,'exactly one kill call: '+kills);
  assert(/process\.kill\(pid,\s*0\)/.test(kills[0]),kills[0]);
});
t('C9-CONTROL the scan detects a nonzero signal', () => {
  const probe="process.kill(pid, 'SIGINT')";
  const k=probe.match(/process\.kill\([^)]*\)/g)||[];
  assert(k.length===1 && !/process\.kill\(pid,\s*0\)/.test(k[0]));
});
t('C10 ttyName decodes a pts device', () => {
  assert.strictEqual(ttyName((136<<8)|3),'pts/3');
  assert.strictEqual(ttyName(0),null);
});
t('C11 DETERMINISTIC: a child signals ITSELF and the context is captured', () => {
  const d=fs.mkdtempSync(path.join(os.tmpdir(),'rtr4s-'));
  const log=path.join(d,'exit.jsonl'); const pf=path.join(d,'allmight.pid');
  fs.writeFileSync(pf,`self=${process.pid}\n`);
  const script=path.join(d,'c.js');
  fs.writeFileSync(script,`
    const fs=require('fs');
    const { collectSignalContext }=require(${JSON.stringify(SC)});
    let done=false;
    function rec(reason){ if(done)return; done=true;
      let ctx=null; try{ ctx=collectSignalContext({pidFilePath:${JSON.stringify(pf)}}); }catch{}
      const r={ts:new Date().toISOString(),pid:process.pid,reason,uptimeSec:Math.round(process.uptime())};
      if(ctx) r.signalContext=ctx;
      fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(r)+'\\n'); }
    process.on('SIGINT',()=>{ rec('SIGINT'); process.exit(0); });
    setTimeout(()=>process.exit(3), 8000);
    process.kill(process.pid,'SIGINT');   // SELF-signal: no live process touched
  `);
  const r=spawnSync('node',[script],{encoding:'utf8',timeout:15000});
  assert.strictEqual(r.status,0,'child exited '+r.status+' '+r.stderr);
  const rec=JSON.parse(fs.readFileSync(log,'utf8').trim());
  assert.strictEqual(rec.reason,'SIGINT');
  assert(rec.signalContext,'context must be attached to a SIGINT record');
  assert.strictEqual(rec.signalContext.self.pid,rec.pid,'context pid == record pid');
  assert(/Z$/.test(rec.signalContext.capturedAtUtc));
  assert(Array.isArray(rec.signalContext.topology));
  fs.rmSync(d,{recursive:true,force:true});
});
t('C12 CONTROL: without the module the record is STILL written', () => {
  const d=fs.mkdtempSync(path.join(os.tmpdir(),'rtr4n-'));
  const log=path.join(d,'exit.jsonl'); const script=path.join(d,'c.js');
  fs.writeFileSync(script,`
    const fs=require('fs'); let done=false;
    function ctxSafe(){ try{ return require('./definitely_missing_module').collectSignalContext(); }catch{ return null; } }
    function rec(reason){ if(done)return; done=true;
      let c=null; if(reason==='SIGINT') c=ctxSafe();
      const r={ts:new Date().toISOString(),pid:process.pid,reason};
      if(c) r.signalContext=c;
      fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(r)+'\\n'); }
    process.on('SIGINT',()=>{ rec('SIGINT'); process.exit(0); });
    setTimeout(()=>process.exit(3), 8000);
    process.kill(process.pid,'SIGINT');
  `);
  const r=spawnSync('node',[script],{encoding:'utf8',timeout:15000});
  assert.strictEqual(r.status,0,'a missing module must not break the exit path');
  const rec=JSON.parse(fs.readFileSync(log,'utf8').trim());
  assert.strictEqual(rec.reason,'SIGINT');
  assert.strictEqual('signalContext' in rec,false,'absent, but the record survives');
  fs.rmSync(d,{recursive:true,force:true});
});
t('C13 context is attached ONLY for SIGINT/SIGTERM', () => {
  const src=fs.readFileSync('/tmp/tmp.B4CVn1ntx7/rtr004/staging/apply_rtr004.py','utf8');
  assert(/reason === 'SIGINT' \|\| reason === 'SIGTERM'/.test(src),'gate must be explicit');
  assert(/let signalContext = null;/.test(src));
});
t('C14 the patcher REFUSES a file whose sha does not match', () => {
  const d=fs.mkdtempSync(path.join(os.tmpdir(),'rtr4p-'));
  const wrong=path.join(d,'x.js'); fs.writeFileSync(wrong,'// not the router\n');
  const r=spawnSync('python3',['/tmp/tmp.B4CVn1ntx7/rtr004/staging/apply_rtr004.py',wrong],{encoding:'utf8'});
  assert.notStrictEqual(r.status,0,'must refuse');
  assert(/REFUSED/.test(r.stdout+r.stderr),r.stdout+r.stderr);
  fs.rmSync(d,{recursive:true,force:true});
});
console.log(''); console.log(`passed ${p}  failed ${f}`);
process.exit(f===0?0:1);
