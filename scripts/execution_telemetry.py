#!/usr/bin/env python3
"""
Execution Telemetry - Phase 2.4.0 Instrumentation

Provides deterministic, replay-safe logging for execution pipeline.
All events logged to append-only JSONL files.

Author: Allmight System
Phase: 2.4.0 - Instrumentation
Governance: Phase-0 (Determinism + Audit)
"""

import json
import time
import hashlib
from pathlib import Path
from typing import Dict, List, Optional, Literal, Any
from dataclasses import dataclass, asdict
from datetime import datetime
import logging

logger = logging.getLogger('Allmight.Telemetry')


# ===== REJECTION REASON CODES (CANONICAL) =====

class RejectionCode:
    """Canonical rejection reason codes - never rename/remove without migration"""
    NETEDGE_BELOW_BUFFER = "REJ_NETEDGE_BELOW_BUFFER"
    SLIPPAGE_TOO_HIGH = "REJ_SLIPPAGE_TOO_HIGH"
    GAS_TOO_HIGH = "REJ_GAS_TOO_HIGH"
    GAS_COVERAGE_RATIO_LOW = "REJ_GAS_COVERAGE_RATIO_LOW"
    STATE_DRIFT_RISK = "REJ_STATE_DRIFT_RISK"
    COMPETITION_DENSITY_HIGH = "REJ_COMPETITION_DENSITY_HIGH"
    SIMULATION_FAILED = "REJ_SIMULATION_FAILED"
    BUNDLE_SIM_UNPROFITABLE = "REJ_BUNDLE_SIM_UNPROFITABLE"
    BUNDLE_SIM_REVERTS = "REJ_BUNDLE_SIM_REVERTS"
    POLICY_FORBIDDEN = "REJ_POLICY_FORBIDDEN"


# ===== CORE TELEMETRY EVENT =====

@dataclass
class TelemetryEvent:
    """
    Base telemetry event
    
    All telemetry events MUST include these identity fields
    """
    # Identity (required everywhere)
    ts_ms: int
    run_id: str
    opportunity_id: str
    chain_id: str
    venue_id: str
    market_id: str
    route_id: str
    notional_usd: float
    block_ref: int
    block_target: Optional[int] = None
    
    def to_jsonl(self) -> str:
        """
        Convert to JSONL line (deterministic)
        
        Rules:
        - Stable key ordering (sorted)
        - Consistent numeric precision
        - No trailing newline (caller adds)
        """
        data = asdict(self)
        
        # Remove None values for cleaner output
        data = {k: v for k, v in data.items() if v is not None}
        
        # Deterministic serialization
        return json.dumps(data, sort_keys=True, separators=(',', ':'))


# ===== STAGE TIMING EVENTS =====

@dataclass
class PipelineStageEvent(TelemetryEvent):
    """Pipeline stage timing event"""
    event_type: Literal["PIPELINE_STAGE_BEGIN", "PIPELINE_STAGE_END"] = "PIPELINE_STAGE_BEGIN"
    stage: str = ""
    stage_seq: int = 0
    t_start_ms: Optional[int] = None
    t_end_ms: Optional[int] = None
    duration_ms: Optional[int] = None
    notes: Optional[str] = None
    error_code: Optional[str] = None
    error_detail: Optional[str] = None


# ===== PREFLIGHT RESULT =====

@dataclass
class PreflightResultEvent(TelemetryEvent):
    """Preflight decision result"""
    event_type: str = "PREFLIGHT_RESULT"
    preflight_result: Literal["REJECT", "ACCEPT_SIM_ONLY", "ACCEPT_BUNDLE"] = "REJECT"
    rejection_reason_code: Optional[str] = None
    confidence_level: Literal["LOW", "MED", "HIGH"] = "MED"
    net_edge_bps: float = 0.0
    safety_buffer_bps: float = 0.0
    min_profit_wei: int = 0
    max_gas_wei: int = 0


# ===== BUNDLE SIMULATION RESULT =====

@dataclass
class BundleSimResultEvent(TelemetryEvent):
    """Bundle simulation result"""
    event_type: str = "BUNDLE_SIM_RESULT"
    bundle_id: str = ""
    sim_block_target: int = 0
    sim_ok: bool = False
    sim_revert: bool = False
    sim_revert_reason: Optional[str] = None
    gross_profit_wei_sim: int = 0
    gas_used_wei_sim: int = 0
    gas_price_wei_sim: int = 0
    net_profit_wei_sim: int = 0
    gas_coverage_ratio: float = 0.0
    decision: Literal["REJECT", "SUBMIT"] = "REJECT"
    sim_error_code: Optional[str] = None
    sim_error_detail: Optional[str] = None


# ===== SUBMISSION RESULT =====

@dataclass
class SubmissionResultEvent(TelemetryEvent):
    """Bundle submission result"""
    event_type: str = "SUBMISSION_RESULT"
    bundle_id: str = ""
    submitted: bool = False
    submit_channel: Literal["FLASHBOTS", "PRIVATE_RPC", "OTHER"] = "FLASHBOTS"
    submit_ok: bool = False
    submit_error_code: Optional[str] = None
    submit_error_detail: Optional[str] = None


# ===== INCLUSION RESULT =====

@dataclass
class InclusionResultEvent(TelemetryEvent):
    """Bundle inclusion/outcome result"""
    event_type: str = "INCLUSION_RESULT"
    bundle_id: str = ""
    target_block: int = 0
    included: bool = False
    included_tx_hashes: Optional[List[str]] = None
    reverted: bool = False
    revert_reason: Optional[str] = None
    gross_profit_wei_real: Optional[int] = None
    gas_spent_wei_real: Optional[int] = None
    net_profit_wei_real: Optional[int] = None


# ===== TELEMETRY LOGGER =====

class TelemetryLogger:
    """
    Append-only JSONL telemetry logger
    
    Logs to: data/telemetry/YYYYMMDD/{namespace}.jsonl
    """
    
    def __init__(self, base_dir: str = "data/telemetry", run_id: Optional[str] = None):
        self.base_dir = Path(base_dir)
        
        # Generate run_id if not provided
        if run_id is None:
            # Format: P24_YYYYMMDD_HHMMSS
            now = datetime.utcnow()
            self.run_id = f"P24_{now.strftime('%Y%m%d_%H%M%S')}"
        else:
            self.run_id = run_id
        
        logger.info(f"TelemetryLogger initialized: run_id={self.run_id}")
    
    def _get_file_path(self, namespace: str) -> Path:
        """Get JSONL file path for namespace"""
        today = datetime.utcnow().strftime('%Y%m%d')
        file_path = self.base_dir / today / f"{namespace}.jsonl"
        
        # Create directory if needed
        file_path.parent.mkdir(parents=True, exist_ok=True)
        
        return file_path
    
    def log_event(self, event: TelemetryEvent, namespace: str):
        """
        Log event to JSONL file
        
        Args:
            event: TelemetryEvent to log
            namespace: File namespace (e.g., 'pipeline_events', 'preflight_results')
        """
        # Ensure run_id is set
        event.run_id = self.run_id
        
        # Get file path
        file_path = self._get_file_path(namespace)
        
        # Append to file (one line per event)
        with open(file_path, 'a') as f:
            f.write(event.to_jsonl() + '\n')
        
        logger.debug(f"Logged {event.event_type} to {namespace}")
    
    def log_pipeline_stage_begin(
        self,
        stage: str,
        opportunity_id: str,
        chain_id: str,
        venue_id: str,
        market_id: str,
        route_id: str,
        notional_usd: float,
        block_ref: int,
        block_target: Optional[int] = None,
        stage_seq: int = 0
    ):
        """Log pipeline stage begin"""
        event = PipelineStageEvent(
            ts_ms=int(time.time() * 1000),
            run_id=self.run_id,
            opportunity_id=opportunity_id,
            chain_id=chain_id,
            venue_id=venue_id,
            market_id=market_id,
            route_id=route_id,
            notional_usd=notional_usd,
            block_ref=block_ref,
            block_target=block_target,
            event_type="PIPELINE_STAGE_BEGIN",
            stage=stage,
            stage_seq=stage_seq,
            t_start_ms=int(time.time() * 1000)
        )
        self.log_event(event, "pipeline_events")
        return event.t_start_ms
    
    def log_pipeline_stage_end(
        self,
        stage: str,
        opportunity_id: str,
        chain_id: str,
        venue_id: str,
        market_id: str,
        route_id: str,
        notional_usd: float,
        block_ref: int,
        block_target: Optional[int] = None,
        stage_seq: int = 0,
        t_start_ms: Optional[int] = None,
        error_code: Optional[str] = None,
        error_detail: Optional[str] = None
    ):
        """Log pipeline stage end"""
        t_end_ms = int(time.time() * 1000)
        duration_ms = (t_end_ms - t_start_ms) if t_start_ms else None
        
        event = PipelineStageEvent(
            ts_ms=t_end_ms,
            run_id=self.run_id,
            opportunity_id=opportunity_id,
            chain_id=chain_id,
            venue_id=venue_id,
            market_id=market_id,
            route_id=route_id,
            notional_usd=notional_usd,
            block_ref=block_ref,
            block_target=block_target,
            event_type="PIPELINE_STAGE_END",
            stage=stage,
            stage_seq=stage_seq,
            t_end_ms=t_end_ms,
            duration_ms=duration_ms,
            error_code=error_code,
            error_detail=error_detail
        )
        self.log_event(event, "pipeline_events")
    
    def log_preflight_result(
        self,
        opportunity_id: str,
        chain_id: str,
        venue_id: str,
        market_id: str,
        route_id: str,
        notional_usd: float,
        block_ref: int,
        block_target: Optional[int],
        result: Literal["REJECT", "ACCEPT_SIM_ONLY", "ACCEPT_BUNDLE"],
        rejection_reason_code: Optional[str],
        confidence_level: Literal["LOW", "MED", "HIGH"],
        net_edge_bps: float,
        safety_buffer_bps: float,
        min_profit_wei: int,
        max_gas_wei: int
    ):
        """Log preflight decision result"""
        event = PreflightResultEvent(
            ts_ms=int(time.time() * 1000),
            run_id=self.run_id,
            opportunity_id=opportunity_id,
            chain_id=chain_id,
            venue_id=venue_id,
            market_id=market_id,
            route_id=route_id,
            notional_usd=notional_usd,
            block_ref=block_ref,
            block_target=block_target,
            preflight_result=result,
            rejection_reason_code=rejection_reason_code,
            confidence_level=confidence_level,
            net_edge_bps=net_edge_bps,
            safety_buffer_bps=safety_buffer_bps,
            min_profit_wei=min_profit_wei,
            max_gas_wei=max_gas_wei
        )
        self.log_event(event, "preflight_results")
    
    def log_bundle_sim_result(
        self,
        opportunity_id: str,
        chain_id: str,
        venue_id: str,
        market_id: str,
        route_id: str,
        notional_usd: float,
        block_ref: int,
        block_target: int,
        bundle_id: str,
        sim_ok: bool,
        sim_revert: bool,
        gross_profit_wei_sim: int,
        gas_used_wei_sim: int,
        gas_price_wei_sim: int,
        net_profit_wei_sim: int,
        gas_coverage_ratio: float,
        decision: Literal["REJECT", "SUBMIT"],
        sim_revert_reason: Optional[str] = None,
        sim_error_code: Optional[str] = None,
        sim_error_detail: Optional[str] = None
    ):
        """Log bundle simulation result"""
        event = BundleSimResultEvent(
            ts_ms=int(time.time() * 1000),
            run_id=self.run_id,
            opportunity_id=opportunity_id,
            chain_id=chain_id,
            venue_id=venue_id,
            market_id=market_id,
            route_id=route_id,
            notional_usd=notional_usd,
            block_ref=block_ref,
            block_target=block_target,
            bundle_id=bundle_id,
            sim_block_target=block_target,
            sim_ok=sim_ok,
            sim_revert=sim_revert,
            sim_revert_reason=sim_revert_reason,
            gross_profit_wei_sim=gross_profit_wei_sim,
            gas_used_wei_sim=gas_used_wei_sim,
            gas_price_wei_sim=gas_price_wei_sim,
            net_profit_wei_sim=net_profit_wei_sim,
            gas_coverage_ratio=gas_coverage_ratio,
            decision=decision,
            sim_error_code=sim_error_code,
            sim_error_detail=sim_error_detail
        )
        self.log_event(event, "bundle_sim_results")


# ===== OPPORTUNITY ID GENERATOR =====

def generate_opportunity_id(
    chain_id: str,
    venue_id: str,
    market_id: str,
    route_id: str,
    notional_tier: int,
    block_ref: int
) -> str:
    """
    Generate stable opportunity ID
    
    Format: opp_{hash}
    Hash of: chain_id|venue_id|market_id|route_id|notional_tier|block_ref
    """
    composite = f"{chain_id}|{venue_id}|{market_id}|{route_id}|{notional_tier}|{block_ref}"
    hash_bytes = hashlib.sha256(composite.encode()).digest()
    hash_hex = hash_bytes[:4].hex()  # First 4 bytes = 8 hex chars
    
    return f"opp_{hash_hex}"


# ===== CONTEXT MANAGER FOR STAGE TIMING =====

class StageTimer:
    """
    Context manager for stage timing
    
    Usage:
        with StageTimer(telemetry, "PREFLIGHT", opportunity_id, ...):
            # Do work
            pass
    """
    
    def __init__(
        self,
        telemetry: TelemetryLogger,
        stage: str,
        opportunity_id: str,
        chain_id: str,
        venue_id: str,
        market_id: str,
        route_id: str,
        notional_usd: float,
        block_ref: int,
        block_target: Optional[int] = None,
        stage_seq: int = 0
    ):
        self.telemetry = telemetry
        self.stage = stage
        self.opportunity_id = opportunity_id
        self.chain_id = chain_id
        self.venue_id = venue_id
        self.market_id = market_id
        self.route_id = route_id
        self.notional_usd = notional_usd
        self.block_ref = block_ref
        self.block_target = block_target
        self.stage_seq = stage_seq
        self.t_start_ms = None
        self.error_code = None
        self.error_detail = None
    
    def __enter__(self):
        self.t_start_ms = self.telemetry.log_pipeline_stage_begin(
            stage=self.stage,
            opportunity_id=self.opportunity_id,
            chain_id=self.chain_id,
            venue_id=self.venue_id,
            market_id=self.market_id,
            route_id=self.route_id,
            notional_usd=self.notional_usd,
            block_ref=self.block_ref,
            block_target=self.block_target,
            stage_seq=self.stage_seq
        )
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        if exc_type is not None:
            self.error_code = exc_type.__name__
            self.error_detail = str(exc_val)
        
        self.telemetry.log_pipeline_stage_end(
            stage=self.stage,
            opportunity_id=self.opportunity_id,
            chain_id=self.chain_id,
            venue_id=self.venue_id,
            market_id=self.market_id,
            route_id=self.route_id,
            notional_usd=self.notional_usd,
            block_ref=self.block_ref,
            block_target=self.block_target,
            stage_seq=self.stage_seq,
            t_start_ms=self.t_start_ms,
            error_code=self.error_code,
            error_detail=self.error_detail
        )
        
        # Don't suppress exceptions
        return False


# ===== DEMO/TEST =====

if __name__ == '__main__':
    # Demo usage
    logging.basicConfig(level=logging.INFO)
    
    telemetry = TelemetryLogger()
    
    # Generate opportunity ID
    opp_id = generate_opportunity_id(
        chain_id="eth",
        venue_id="uniswap_v3",
        market_id="0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640",
        route_id="ETH->USDC_v3_500",
        notional_tier=1000,
        block_ref=21876543
    )
    
    print(f"Opportunity ID: {opp_id}")
    
    # Use context manager for stage timing
    with StageTimer(
        telemetry=telemetry,
        stage="PREFLIGHT",
        opportunity_id=opp_id,
        chain_id="eth",
        venue_id="uniswap_v3",
        market_id="0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640",
        route_id="ETH->USDC_v3_500",
        notional_usd=1000.0,
        block_ref=21876543,
        block_target=21876544,
        stage_seq=1
    ):
        # Simulate work
        time.sleep(0.05)
    
    # Log preflight result
    telemetry.log_preflight_result(
        opportunity_id=opp_id,
        chain_id="eth",
        venue_id="uniswap_v3",
        market_id="0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640",
        route_id="ETH->USDC_v3_500",
        notional_usd=1000.0,
        block_ref=21876543,
        block_target=21876544,
        result="REJECT",
        rejection_reason_code=RejectionCode.NETEDGE_BELOW_BUFFER,
        confidence_level="MED",
        net_edge_bps=1.7,
        safety_buffer_bps=3.5,
        min_profit_wei=0,
        max_gas_wei=0
    )
    
    print(f"\n✅ Telemetry logged to: data/telemetry/{datetime.utcnow().strftime('%Y%m%d')}/")
    print("Check pipeline_events.jsonl and preflight_results.jsonl")
