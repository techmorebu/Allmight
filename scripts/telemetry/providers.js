'use strict';
/**
 * M1A-R2 — TYPED OUTPUT PROVIDERS.
 *
 * R1 let a contract CLAIM semantics the evaluator did not implement: the `heat`
 * contract said "recordType null means freshness falls back to line presence",
 * but evalOutput JSON.parses every line and requires a parsable `ts`. A
 * human-readable heat.jsonl could never satisfy it. The loader called that
 * contract complete anyway.
 *
 * The fix is to make the reading strategy an EXPLICIT, ENUMERATED, IMPLEMENTED
 * type. A contract naming a format with no provider is INVALID — a contract can
 * no longer describe behaviour that does not exist.
 */

/** JSONL: authority is the newest matching record's OWN ts. */
function jsonlRecord(raw, spec) {
  const recs = raw.split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(r => r && (!spec.recordType || r.type === spec.recordType));
  if (recs.length === 0) return { ok: false, reason: `no ${spec.recordType || 'record'} entries`, evidence: { records: 0 } };
  const newest = recs[recs.length - 1];
  const ts = Date.parse(newest.ts);
  if (!Number.isFinite(ts)) return { ok: false, reason: 'newest record has no parsable ts', evidence: { records: recs.length } };
  return { ok: true, tsMs: ts, evidence: { records: recs.length, recordTs: newest.ts, provider: 'jsonl_record' } };
}

/**
 * TEXT_APPEND: for human-readable logs with no per-line timestamp. Authority is
 * the file's mtime PLUS proof the content grew — mtime alone can be touched
 * without new content. The caller supplies the previous observation, so growth
 * is only asserted when there is something to compare against.
 */
function textAppend(raw, spec, ctx) {
  const bytes = Buffer.byteLength(raw);
  const lines = raw.split('\n').filter(Boolean).length;
  if (lines === 0) return { ok: false, reason: 'file is empty', evidence: { bytes, lines, provider: 'text_append' } };
  if (!ctx || !Number.isFinite(ctx.mtimeMs))
    return { ok: false, reason: 'text_append requires file mtime', evidence: { provider: 'text_append' } };
  const ev = { bytes, lines, provider: 'text_append' };
  if (ctx.previous && Number.isFinite(ctx.previous.bytes)) {
    ev.previousBytes = ctx.previous.bytes;
    ev.grew = bytes > ctx.previous.bytes;
    if (!ev.grew) return { ok: false, reason: 'file did not grow since the previous observation', evidence: ev };
  } else {
    ev.growthUnknown = true;   // first observation — stated, not assumed
  }
  return { ok: true, tsMs: ctx.mtimeMs, evidence: ev };
}

/**
 * REDIS_TTL: for output that lands in Redis with an expiry rather than in a
 * file. Authority is the KEY'S REMAINING TTL: a key still alive proves the
 * producer wrote it within (configured TTL - remaining). Evidence is INJECTED
 * by the caller's probe — this module performs no I/O and opens no connection.
 */
function redisTtl(_raw, spec, ctx) {
  const ev = { provider: 'redis_ttl', sourceKind: 'redis', keyPattern: spec.keyPattern || null };
  if (!spec.keyPattern) return { ok: false, reason: 'redis_ttl contract has no keyPattern', evidence: ev };
  if (!ctx || !ctx.redis) return { ok: false, reason: 'redis_ttl requires an injected redis probe', evidence: ev };
  const keys = ctx.redis.keys(spec.keyPattern);
  ev.matchedKeys = Array.isArray(keys) ? keys.length : 0;
  if (!Array.isArray(keys) || keys.length === 0)
    return { ok: false, reason: `no keys match ${spec.keyPattern}`, evidence: ev };
  // Freshest key wins: any live key proves recent production.
  let best = null;
  for (const k of keys) {
    const ttl = ctx.redis.ttl(k);
    if (!Number.isFinite(ttl) || ttl < 0) continue;      // -1 no expiry, -2 gone
    if (best === null || ttl > best.ttl) best = { key: k, ttl };
  }
  if (!best) return { ok: false, reason: 'no matching key has a live TTL', evidence: ev };
  const configured = spec.ttlSec;
  if (!Number.isFinite(configured))
    return { ok: false, reason: 'redis_ttl contract has no ttlSec', evidence: ev };
  const writtenAgoSec = configured - best.ttl;
  ev.key = best.key; ev.remainingTtlSec = best.ttl; ev.configuredTtlSec = configured; ev.writtenAgoSec = writtenAgoSec;
  return { ok: true, tsMs: ctx.now - writtenAgoSec * 1000, evidence: ev };
}

const PROVIDERS = { jsonl_record: jsonlRecord, text_append: textAppend, redis_ttl: redisTtl };

/**
 * M1B-B-R1 — SOURCE KIND. The provider, not a string test on the value,
 * determines how its source is resolved. The first real observation showed
 * expandPaths prefixing the repo root onto a redis:// URI, producing
 * "/home/allmight/Allmight/redis:/fetcher:*". A startsWith('redis:') exception
 * would be the same string-matching mistake relocated; the provider must
 * declare what kind of source it consumes.
 *
 *   filesystem  resolved against repoRoot, $SESSION_DIR expanded
 *   redis       a key pattern — NEVER path-joined, NEVER prefixed
 *   none        no source, no resolution
 */
const SOURCE_KIND = { jsonl_record: 'filesystem', text_append: 'filesystem', redis_ttl: 'redis' };
function sourceKind(format) {
  if (format === null || format === undefined) return 'none';
  return SOURCE_KIND[format] || null;      // null = unknown, callers must fail loud
}
const FORMATS = Object.keys(PROVIDERS);
function get(format) { return PROVIDERS[format] || null; }
module.exports = { get, sourceKind, FORMATS, PROVIDERS, SOURCE_KIND };
