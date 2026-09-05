'use strict';
/**
 * RTR-004 — BOUNDED SIGNAL-TIME CONTEXT COLLECTION.
 *
 * Incident 021: two long-lived routers died to SIGINT (08:24:10Z uptime 412s,
 * 22:50:34Z uptime 2130s). RTR-003/R1 exhausted retrospective attribution —
 * auditd was never installed, /proc records no sender, and the corrected
 * journal windows contain no sshd/logind/kill activity at either instant.
 *
 * Linux does not tell a process who signalled it. This CANNOT name the sender.
 * What it CAN do is capture the state that the current record omits: this
 * process's own lineage, and which AllMight components were alive at the
 * instant. That converts "we know nothing" into a comparable snapshot the next
 * time it happens.
 *
 * TIME-001: every stored timestamp is UTC. No local conversion here — CT is a
 * presentation concern for the notifier, never for evidence.
 *
 * INVARIANT: collection must NEVER prevent the exit record from being written.
 * Every field is independently guarded; a failure yields null, not a throw.
 */
const fs = require('fs');
const path = require('path');

/** Read one /proc/<pid>/stat field set. Returns null on any failure. */
function procStat(pid) {
  try {
    const raw = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    // comm may contain spaces/parens; split after the final ')'
    const close = raw.lastIndexOf(')');
    if (close < 0) return null;
    const f = raw.slice(close + 2).split(' ');
    // fields after comm+state: ppid pgrp session tty_nr tpgid ...
    return {
      ppid:  Number(f[1]),
      pgid:  Number(f[2]),
      sid:   Number(f[3]),
      ttyNr: Number(f[4]),
      tpgid: Number(f[5]),
    };
  } catch { return null; }
}

/** Decode tty_nr into a device name where possible. */
function ttyName(ttyNr) {
  try {
    if (!Number.isFinite(ttyNr) || ttyNr === 0) return null;
    const major = (ttyNr >> 8) & 0xfff;
    const minor = (ttyNr & 0xff) | ((ttyNr >> 12) & 0xfff00);
    if (major === 136) return `pts/${minor}`;      // UNIX98 pty slave
    if (major === 4)   return `tty${minor}`;
    return `dev(${major},${minor})`;
  } catch { return null; }
}

/**
 * BOUNDED topology: only components named in the AllMight pid file, plus their
 * liveness. This is deliberately NOT a host process dump — the directive
 * forbids one, and a dump would also be unbounded at signal time.
 */
function allmightTopology(pidFilePath) {
  try {
    const raw = fs.readFileSync(pidFilePath, 'utf8');
    const out = [];
    for (const line of raw.split('\n')) {
      const s = line.trim();
      if (!s) continue;
      const i = s.indexOf('=');
      if (i < 0) continue;
      const name = s.slice(0, i).trim();
      const pid = Number(s.slice(i + 1).trim());
      if (!Number.isInteger(pid) || pid <= 0) { out.push({ name, pid: null, alive: null }); continue; }
      let alive = null;
      try { process.kill(pid, 0); alive = true; }       // signal 0: probe only
      catch (e) { alive = e && e.code === 'EPERM'; }     // EPERM: exists, not ours
      const st = procStat(pid);
      out.push({ name, pid, alive, pgid: st ? st.pgid : null, sid: st ? st.sid : null });
    }
    return out;
  } catch { return null; }
}

/**
 * Collect the snapshot. Returns a plain object; NEVER throws.
 * `deps` is injectable so tests drive it without touching the real filesystem.
 */
function collectSignalContext(deps) {
  const d = deps || {};
  const pidFile = d.pidFilePath || path.join(__dirname, '..', '..', 'logs', 'allmight.pid');
  const ctx = {
    capturedAtUtc: null, self: null, topology: null,
    note: 'Linux does not expose the signal sender; this is lineage + liveness only',
    collectionErrors: [],
  };
  try { ctx.capturedAtUtc = new Date().toISOString(); }      // TIME-001: UTC
  catch (e) { ctx.collectionErrors.push('ts'); }
  try {
    const st = (d.procStat || procStat)(process.pid);
    ctx.self = {
      pid: process.pid,
      ppid: st ? st.ppid : (typeof process.ppid === 'number' ? process.ppid : null),
      pgid: st ? st.pgid : null,
      sid:  st ? st.sid  : null,
      tpgid: st ? st.tpgid : null,
      tty:  st ? ttyName(st.ttyNr) : null,
      // tpgid !== pgid means this process is NOT in the terminal's foreground
      // group, so a terminal-driven Ctrl+C could not have reached it.
      inForegroundGroup: st && Number.isFinite(st.tpgid) && Number.isFinite(st.pgid)
        ? (st.tpgid === st.pgid) : null,
    };
  } catch (e) { ctx.collectionErrors.push('self'); }
  try { ctx.topology = (d.topology || allmightTopology)(pidFile); }
  catch (e) { ctx.collectionErrors.push('topology'); }
  return ctx;
}
module.exports = { collectSignalContext, procStat, ttyName, allmightTopology };
