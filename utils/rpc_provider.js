'use strict';

const { ethers } = require('ethers');

function _sanitizeRpcUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;

  let u;
  try { u = new URL(s); } catch { return null; }

  const host = String(u.host || '').toLowerCase();
  const pathname = String(u.pathname || '').replace(/\/+$/, '');
  const segs = pathname.split('/').filter(Boolean);

  // block bare Ankr like /eth (one segment)
  if (host === 'rpc.ankr.com' && segs.length === 1) return null;

  return u.toString();
}

function _looksLikeKey(seg) {
  const s = String(seg || '');
  if (!s) return false;
  if (s.length >= 16) return true;
  if (/^[a-f0-9]{16,}$/i.test(s)) return true;
  if (/^[a-z0-9_-]{20,}$/i.test(s)) return true;
  return false;
}

function _redactUrl(raw) {
  try {
    const u = new URL(String(raw));
    const segs = String(u.pathname || '').split('/').filter(Boolean);

    const out = [];
    if (segs[0]) out.push(segs[0]);
    if (segs[1]) out.push(_looksLikeKey(segs[1]) ? 'REDACTED' : segs[1]);

    u.pathname = '/' + out.join('/');
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch {
    return 'INVALID_URL';
  }
}

function makeProviderFromEnv(envKey, telemetryFn, chainKey = 'UNKNOWN') {
  const raw = String(process.env[envKey] || '');
  const urls = raw.split(',').map((x) => _sanitizeRpcUrl(x)).filter(Boolean);

  if (!urls.length) throw new Error(`[rpc_provider] No valid URLs in ${envKey}`);

  if (typeof telemetryFn === 'function') {
    telemetryFn('rpc_init', {
      chain: chainKey,
      endpoints: urls.map((u, i) => ({ endpointId: i, url: _redactUrl(u) })),
    });
  }

  // simplest: just first URL
  return new ethers.JsonRpcProvider(urls[0], undefined, { batchMaxCount: 1 });
}

module.exports = {
  makeProviderFromEnv,
};
