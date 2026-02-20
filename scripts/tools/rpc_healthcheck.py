#!/usr/bin/env python3
"""
RPC Healthcheck - deterministic endpoint verification
Reads RPC endpoints from environment variables matching: <PREFIX>_RPC_URL_<N>
Verifies: responds, correct chainId, returns block number, measures latency
Outputs ranked table. Does NOT mutate env/config.
"""
import argparse, json, os, re, time, urllib.request
from dataclasses import dataclass
from typing import List, Optional, Tuple


def _rpc_call(url, method, params, timeout_s):
    body = json.dumps({"jsonrpc":"2.0","id":1,"method":method,"params":params}).encode()
    req  = urllib.request.Request(url, data=body, headers={"content-type":"application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout_s) as resp:
            data = json.loads(resp.read().decode("utf-8", errors="replace"))
        if "error" in data:
            return False, data, f"rpc_error:{data['error']}"
        return True, data, None
    except Exception as e:
        return False, None, f"exc:{type(e).__name__}:{e}"


def _hex_to_int(h):
    if not isinstance(h, str) or not h.startswith("0x"):
        return None
    try:    return int(h, 16)
    except: return None


RPC_ENV_RE = re.compile(r"^(?P<prefix>[A-Z0-9_]+)_RPC_URL_(?P<idx>\d+)$")


def discover_endpoints(prefix):
    found = []
    for k, v in os.environ.items():
        m = RPC_ENV_RE.match(k)
        if not m or m.group("prefix") != prefix: continue
        url = (v or "").strip()
        if url: found.append((int(m.group("idx")), k, url))
    found.sort(key=lambda x: x[0])
    return [(k, url) for _, k, url in found]


@dataclass
class EndpointResult:
    env_key:      str
    url:          str
    ok:           bool
    chain_id_ok:  bool
    chain_id:     Optional[int]
    block_number: Optional[int]
    latency_ms:   Optional[float]
    error:        Optional[str]


def check_endpoint(url, expected_chain_id, timeout_s):
    t0 = time.perf_counter()
    ok_c, d_c, e_c = _rpc_call(url, "eth_chainId",   [], timeout_s)
    chain_id  = _hex_to_int(d_c.get("result")) if (ok_c and d_c) else None
    chain_ok  = (chain_id == expected_chain_id)
    ok_b, d_b, e_b = _rpc_call(url, "eth_blockNumber", [], timeout_s)
    block     = _hex_to_int(d_b.get("result")) if (ok_b and d_b) else None
    latency   = (time.perf_counter() - t0) * 1000.0
    ok        = bool(ok_c and ok_b and chain_ok and block is not None)
    error     = ";".join([e for e in [e_c, e_b] if e]) if not ok else None
    return EndpointResult("", url, ok, chain_ok, chain_id, block, latency, error)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--prefix",             required=True)
    ap.add_argument("--expected-chain-id",  required=True, type=int)
    ap.add_argument("--timeout",            type=float, default=5.0)
    args = ap.parse_args()

    endpoints = discover_endpoints(args.prefix)
    if not endpoints:
        print(f"No endpoints found for prefix={args.prefix}")
        print(f"Expected env vars like: {args.prefix}_RPC_URL_1=https://...")
        return 2

    results = []
    for env_key, url in endpoints:
        print(f"  Checking {env_key}...", end=" ", flush=True)
        r = check_endpoint(url, args.expected_chain_id, args.timeout)
        r.env_key = env_key
        results.append(r)
        status = "OK" if r.ok else f"FAIL ({r.error[:50] if r.error else "?"})"
        print(f"{status}  {r.latency_ms:.0f}ms")

    results.sort(key=lambda r: (0 if r.ok else 1, r.latency_ms or 1e9))

    print()
    print("=" * 100)
    print(f"RPC HEALTHCHECK  prefix={args.prefix}  expected_chain_id={args.expected_chain_id}")
    print("=" * 100)
    print(f"  {'RANK':<4} {'OK':<3} {'CHAIN':<5} {'LAT(ms)':>8} {'BLOCK':>10}  {'ENV_KEY':<35}  URL")
    print("  " + "-" * 95)
    for i, r in enumerate(results, 1):
        lat = f"{r.latency_ms:8.0f}" if r.latency_ms else "      -"
        blk = f"{r.block_number:10d}" if r.block_number else "         -"
        print(f"  {i:<4} {'Y' if r.ok else 'N':<3} {'Y' if r.chain_id_ok else 'N':<5} {lat} {blk}  {r.env_key:<35}  {r.url}")
    print()

    best = results[0]
    if best.ok:
        print(f"  BEST: {best.env_key}  latency={best.latency_ms:.0f}ms  block={best.block_number}")
        print(f"  Recommendation: use {best.env_key} as primary")
        return 0
    else:
        print("  WARNING: No endpoints passed. Check rate limits / connectivity.")
        return 1

if __name__ == "__main__":
    raise SystemExit(main())
