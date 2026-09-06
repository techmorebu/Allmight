'use strict';
/**
 * M2E-016 — MODEL C CAUSAL COVERAGE PROVIDER.
 *
 * Every prior output authority ages the OUTPUT: "how old is the newest record?"
 * That question is WRONG for a component that legitimately produces nothing
 * when upstream is quiet — an idle activator would false-red it.
 *
 * This asks instead: "is there REQUIRED WORK that not every producer has
 * processed, and has it been outstanding past the deadline?" The clock is
 * anchored to the required work's own ts, NEVER to output age. [RATIFIED]
 *
 * THREE SEPARABLE PARTS. Only allRequired() knows about time:
 *   requiredWork()  pure parsing        -> ordered work items
 *   coverageLeg()   pure set extraction -> Set<workKey> per producer
 *   allRequired()   the ONLY clock user -> verdict
 */
const crypto = require('crypto');

/* ── FINGERPRINT ─────────────────────────────────────────────────────────
 * existence + byte length + mtime_ns + sha256(bytes).
 *
 * LENGTH ALONE IS PERMANENTLY REJECTED. M2E-015B observed a v2 rewrite that
 * changed content while remaining EXACTLY 2,604,110 bytes — twice in one hour.
 * A length-only discriminator would have called that actively-rewriting file
 * stable and returned a wrong coverage set.
 */
function fingerprint(path, fsx) {
  try {
    const st = fsx.statSync(path);
    const buf = fsx.readFileSync(path);
    const bytes = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf));
    return {
      exists: true,
      size: st.size !== undefined ? st.size : bytes.length,
      mtimeNs: st.mtimeNs !== undefined ? String(st.mtimeNs)
             : (st.mtimeMs !== undefined ? String(Math.round(st.mtimeMs * 1e6)) : null),
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    };
  } catch (e) {
    return { exists: false, size: null, mtimeNs: null, sha256: null, error: e.message };
  }
}

function sameFingerprint(a, b) {
  if (!a || !b) return false;
  return a.exists === b.exists && a.size === b.size
      && a.mtimeNs === b.mtimeNs && a.sha256 === b.sha256;
}

/* ── REQUIRED WORK ───────────────────────────────────────────────────────
 * Parses the upstream source. PURE: no clock, no retry.
 *
 * skipUnparsable is a DECLARED contract term, not incidental parser
 * behaviour: activator.jsonl is FORMAT_DEBT — a mixed stream where ~96% of
 * lines are ANSI console output (M2E-013B). A future reader must be able to
 * see that the skip was a decision.
 *
 * Items are returned in FILE ORDER, never sorted. `block` is monotonic
 * (M2E-013A: 0 decreasing steps across 2515 records), so the newest is the
 * last — but sorting would silently hide an ordering break, whereas taking
 * the last exposes it.
 */
function requiredWork(spec, fsx) {
  const s = spec || {};
  let raw;
  try { raw = String(fsx.readFileSync(s.path, 'utf8')); }
  catch (e) { return { items: [], skipped: 0, readable: false, error: e.message }; }
  const match = s.match || {};
  const items = []; let skipped = 0;
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let rec;
    try { rec = JSON.parse(t); }
    catch { skipped++; continue; }               // declared skip
    if (!rec || typeof rec !== 'object') { skipped++; continue; }
    let ok = true;
    for (const k of Object.keys(match)) if (rec[k] !== match[k]) { ok = false; break; }
    if (!ok) continue;
    const key = rec[s.workKey];
    if (key === undefined || key === null) continue;
    items.push({ workKey: String(key), ts: rec[s.timeField], raw: rec });
  }
  // report an ordering anomaly rather than repairing it
  let orderingAnomaly = false;
  for (let i = 1; i < items.length; i++) {
    const a = Number(items[i - 1].workKey), b = Number(items[i].workKey);
    if (Number.isFinite(a) && Number.isFinite(b) && b < a) { orderingAnomaly = true; break; }
  }
  return { items, skipped, readable: true, orderingAnomaly };
}

/* ── COVERAGE LEG ────────────────────────────────────────────────────────
 * One producer artifact -> the set of work keys it covers. PURE.
 *
 * EMPTY_FILE_TRANSIENT_CANDIDATE [RATIFIED]: a zero-byte file parses cleanly
 * as "zero covered keys" — a confident, WRONG answer. fs.writeFileSync
 * truncates to 0 before writing (M2E-015A observed 2,142,199 -> 0), so a read
 * inside that window sees an empty file with no parse error at all. It must
 * be flagged, never folded into "zero coverage".
 */
function coverageLeg(spec, fsx) {
  const s = spec || {};
  let raw;
  try { raw = String(fsx.readFileSync(s.path, 'utf8')); }
  catch (e) { return { id: s.id, covered: new Set(), readable: false, empty: false, malformed: false, error: e.message }; }
  if (raw.length === 0)
    return { id: s.id, covered: new Set(), readable: true, empty: true, malformed: false, records: 0 };
  const covered = new Set();
  let records = 0, unparsable = 0;
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let rec;
    try { rec = JSON.parse(t); } catch { unparsable++; continue; }
    records++;
    const src = rec[s.workKeyFrom];
    if (src === undefined || src === null) continue;
    let key = String(src);
    if (s.workKeyTransform === 'suffix-after-last-dash') key = key.split('-').pop();
    covered.add(key);
  }
  // structurally wrong: non-empty, but nothing parsed at all
  const malformed = records === 0 && unparsable > 0;
  return { id: s.id, covered, readable: true, empty: false, malformed, records, unparsable };
}

/* ── ALL_REQUIRED REDUCER — the only part that knows the time ───────────── */
function allRequired(work, legs, opts) {
  const o = opts || {};
  const deadline = o.processingDeadlineSec;
  const now = o.now;
  const ev = { deadlineSec: deadline };
  if (!work || work.readable === false)
    return { state: 'UNKNOWN', reason: 'required-work source unreadable — the question cannot be answered', evidence: { ...ev, upstreamReadable: false } };
  if (work.orderingAnomaly) ev.orderingAnomaly = true;
  if (!work.items || work.items.length === 0)
    return { state: 'UNKNOWN', reason: 'no applicable work this session — not yet proven, and this never ages into failure', evidence: { ...ev, requiredCount: 0 } };

  const newest = work.items[work.items.length - 1];
  ev.newestRequiredKey = newest.workKey;
  ev.newestRequiredTs = newest.ts;
  ev.requiredCount = work.items.length;

  const tw = Date.parse(newest.ts);
  const ageSec = Number.isFinite(tw) ? Math.floor((now - tw) / 1000) : null;
  ev.ageSec = ageSec;

  const coveredBy = [], missingFrom = [], transient = [], integrity = [];
  for (const leg of legs) {
    if (!leg.readable) { transient.push(`${leg.id}:unreadable`); continue; }
    if (leg.settled === false) { transient.push(`${leg.id}:in-motion`); continue; }
    if (leg.empty) { (leg.settled ? integrity : transient).push(`${leg.id}:empty`); continue; }
    if (leg.malformed) { (leg.settled ? integrity : transient).push(`${leg.id}:malformed`); continue; }
    if (leg.covered.has(newest.workKey)) coveredBy.push(leg.id); else missingFrom.push(leg.id);
  }
  ev.coveredBy = coveredBy; ev.missingFrom = missingFrom;
  if (transient.length) ev.transient = transient;
  if (integrity.length) ev.integrity = integrity;

  // a STABLE empty or malformed artifact, with work applicable, is integrity failure
  if (integrity.length)
    return { state: 'FAIL', reason: `OUTPUT_INTEGRITY: ${integrity.join(', ')} stable across the bounded re-read while work is applicable`, evidence: ev };
  if (transient.length)
    return { state: 'UNKNOWN', reason: `artifact in motion or unreadable (${transient.join(', ')}) — transient, not a failure`, evidence: ev };

  if (missingFrom.length === 0)
    return { state: 'PASS', reason: `all required producers cover ${newest.workKey}; completion age is irrelevant under the causal form`, evidence: ev };
  if (ageSec === null)
    return { state: 'UNKNOWN', reason: 'required work carries no parsable ts — the deadline cannot be applied', evidence: ev };
  if (ageSec <= deadline) {
    const st = coveredBy.length > 0 ? 'ASYMMETRIC' : 'PENDING';
    return { state: st, reason: st === 'ASYMMETRIC'
        ? `${coveredBy.join(',')} covers ${newest.workKey}, ${missingFrom.join(',')} does not, ${ageSec}s of ${deadline}s — the sequential-engine race, non-failing`
        : `no producer covers ${newest.workKey} yet, ${ageSec}s of ${deadline}s — in flight`,
      evidence: ev };
  }
  return { state: 'FAIL', reason: `${missingFrom.join(',')} has not covered ${newest.workKey} after ${ageSec}s (deadline ${deadline}s)`, evidence: ev };
}

/* ── BOUNDED RE-READ ─────────────────────────────────────────────────────
 * EXACTLY ONE follow-up. Unbounded retry would turn a transient into an
 * indefinite UNKNOWN, hiding a real failure behind "still settling".
 * `settled` is true only when the full fingerprint is identical across both
 * reads — length alone is permanently rejected.
 */
function readLegWithStability(spec, fsx, sleepSync, opts) {
  const o = opts || {};
  const first = coverageLeg(spec, fsx);
  const fp1 = fingerprint(spec.path, fsx);
  const suspicious = !first.readable || first.empty || first.malformed
                   || (o.newestRequiredKey !== undefined && !first.covered.has(o.newestRequiredKey));
  if (!suspicious) return Object.assign(first, { settled: true, reReads: 0 });
  if (typeof sleepSync === 'function') sleepSync(o.reReadDelayMs === undefined ? 250 : o.reReadDelayMs);
  const second = coverageLeg(spec, fsx);
  const fp2 = fingerprint(spec.path, fsx);
  const settled = sameFingerprint(fp1, fp2);
  return Object.assign(second, { settled, reReads: 1, fpBefore: fp1, fpAfter: fp2 });
}

module.exports = { fingerprint, sameFingerprint, requiredWork, coverageLeg, allRequired, readLegWithStability };
