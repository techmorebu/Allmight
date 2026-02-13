#!/usr/bin/env python3
"""
Market Snapshot Storage - Deterministic append-only storage

Stores snapshots in JSONL format for:
- Market Inefficiency Profiler analysis
- Replay/audit capability
- Historical analysis

Storage structure:
data/snapshots/{chain}/{venue}/{market_id}/{date}.jsonl

Author: Allmight System
Phase: 2.3A - Market Inefficiency Profiler
"""

import os
import json
from datetime import datetime
from pathlib import Path
from typing import List, Optional, Iterator
import logging

from .market_snapshot import MarketSnapshotV1

logger = logging.getLogger('Allmight.MarketStorage')


class MarketStorage:
    """
    Deterministic storage for market snapshots
    
    Design:
    - Append-only JSONL files
    - One line per snapshot
    - Stable serialization
    - Organized by chain/venue/market/date
    """
    
    def __init__(self, base_dir: str = "data/snapshots"):
        self.base_dir = Path(base_dir)
        self.base_dir.mkdir(parents=True, exist_ok=True)
        logger.info(f"MarketStorage initialized: {self.base_dir.absolute()}")
    
    def _get_file_path(
        self,
        chain_id: str,
        venue_id: str,
        market_id: str,
        date: Optional[str] = None
    ) -> Path:
        """
        Get file path for snapshots
        
        Args:
            chain_id: Chain identifier
            venue_id: Venue identifier
            market_id: Market identifier (sanitized)
            date: Date string (YYYY-MM-DD), defaults to today
        
        Returns:
            Path to JSONL file
        """
        if date is None:
            date = datetime.utcnow().strftime('%Y-%m-%d')
        
        # Sanitize market_id for filesystem
        safe_market_id = market_id.replace('/', '_').replace('\\', '_')
        
        # Build path
        file_path = self.base_dir / chain_id / venue_id / safe_market_id / f"{date}.jsonl"
        
        # Create parent directories
        file_path.parent.mkdir(parents=True, exist_ok=True)
        
        return file_path
    
    def append(self, snapshot: MarketSnapshotV1) -> None:
        """
        Append a snapshot to storage
        
        Args:
            snapshot: MarketSnapshotV1 to store
        """
        file_path = self._get_file_path(
            snapshot.chain_id,
            snapshot.venue_id,
            snapshot.market_id
        )
        
        # Serialize with stable output
        json_line = snapshot.to_json() + '\n'
        
        # Append to file
        with open(file_path, 'a') as f:
            f.write(json_line)
        
        logger.debug(f"Appended snapshot to {file_path}")
    
    def append_batch(self, snapshots: List[MarketSnapshotV1]) -> None:
        """
        Append multiple snapshots efficiently
        
        Groups by file to minimize I/O
        """
        # Group snapshots by file
        by_file = {}
        
        for snapshot in snapshots:
            file_path = self._get_file_path(
                snapshot.chain_id,
                snapshot.venue_id,
                snapshot.market_id
            )
            
            if file_path not in by_file:
                by_file[file_path] = []
            
            by_file[file_path].append(snapshot)
        
        # Write each file
        for file_path, file_snapshots in by_file.items():
            with open(file_path, 'a') as f:
                for snapshot in file_snapshots:
                    json_line = snapshot.to_json() + '\n'
                    f.write(json_line)
            
            logger.debug(f"Appended {len(file_snapshots)} snapshots to {file_path}")
        
        logger.info(f"Stored {len(snapshots)} snapshots across {len(by_file)} files")
    
    def read(
        self,
        chain_id: str,
        venue_id: str,
        market_id: str,
        date: Optional[str] = None
    ) -> List[MarketSnapshotV1]:
        """
        Read all snapshots for a market on a given date
        
        Args:
            chain_id: Chain identifier
            venue_id: Venue identifier
            market_id: Market identifier
            date: Date string (YYYY-MM-DD), defaults to today
        
        Returns:
            List of MarketSnapshotV1
        """
        file_path = self._get_file_path(chain_id, venue_id, market_id, date)
        
        if not file_path.exists():
            return []
        
        snapshots = []
        
        with open(file_path, 'r') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                
                try:
                    from .market_snapshot import create_snapshot_from_json
                    snapshot = create_snapshot_from_json(line)
                    snapshots.append(snapshot)
                except Exception as e:
                    logger.error(f"Failed to parse snapshot from {file_path}: {e}")
        
        logger.info(f"Read {len(snapshots)} snapshots from {file_path}")
        return snapshots
    
    def read_range(
        self,
        chain_id: str,
        venue_id: str,
        market_id: str,
        start_date: str,
        end_date: str
    ) -> List[MarketSnapshotV1]:
        """
        Read snapshots across a date range
        
        Args:
            chain_id: Chain identifier
            venue_id: Venue identifier
            market_id: Market identifier
            start_date: Start date (YYYY-MM-DD)
            end_date: End date (YYYY-MM-DD)
        
        Returns:
            List of MarketSnapshotV1 sorted by timestamp
        """
        from datetime import datetime, timedelta
        
        start = datetime.strptime(start_date, '%Y-%m-%d')
        end = datetime.strptime(end_date, '%Y-%m-%d')
        
        all_snapshots = []
        current = start
        
        while current <= end:
            date_str = current.strftime('%Y-%m-%d')
            snapshots = self.read(chain_id, venue_id, market_id, date_str)
            all_snapshots.extend(snapshots)
            current += timedelta(days=1)
        
        # Sort by timestamp
        all_snapshots.sort(key=lambda s: s.ts_ms)
        
        return all_snapshots
    
    def iter_snapshots(
        self,
        chain_id: str,
        venue_id: str,
        market_id: str,
        date: Optional[str] = None
    ) -> Iterator[MarketSnapshotV1]:
        """
        Iterate over snapshots without loading all into memory
        
        Useful for large files
        """
        file_path = self._get_file_path(chain_id, venue_id, market_id, date)
        
        if not file_path.exists():
            return
        
        with open(file_path, 'r') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                
                try:
                    from .market_snapshot import create_snapshot_from_json
                    snapshot = create_snapshot_from_json(line)
                    yield snapshot
                except Exception as e:
                    logger.error(f"Failed to parse snapshot: {e}")
    
    def get_market_stats(
        self,
        chain_id: str,
        venue_id: str,
        market_id: str,
        date: Optional[str] = None
    ) -> dict:
        """
        Get basic stats for a market on a given date
        
        Returns:
            {
                'count': int,
                'first_ts': int,
                'last_ts': int,
                'duration_minutes': float
            }
        """
        snapshots = self.read(chain_id, venue_id, market_id, date)
        
        if not snapshots:
            return {'count': 0}
        
        first_ts = min(s.ts_ms for s in snapshots)
        last_ts = max(s.ts_ms for s in snapshots)
        duration_minutes = (last_ts - first_ts) / 60000
        
        return {
            'count': len(snapshots),
            'first_ts': first_ts,
            'last_ts': last_ts,
            'duration_minutes': duration_minutes
        }
    
    def list_markets(
        self,
        chain_id: Optional[str] = None,
        venue_id: Optional[str] = None
    ) -> List[dict]:
        """
        List all markets in storage
        
        Returns:
            List of {chain_id, venue_id, market_id, files}
        """
        markets = []
        
        # Traverse directory structure
        if chain_id:
            chain_dirs = [self.base_dir / chain_id]
        else:
            chain_dirs = [d for d in self.base_dir.iterdir() if d.is_dir()]
        
        for chain_dir in chain_dirs:
            if venue_id:
                venue_dirs = [chain_dir / venue_id]
            else:
                venue_dirs = [d for d in chain_dir.iterdir() if d.is_dir()]
            
            for venue_dir in venue_dirs:
                for market_dir in venue_dir.iterdir():
                    if not market_dir.is_dir():
                        continue
                    
                    files = list(market_dir.glob('*.jsonl'))
                    
                    markets.append({
                        'chain_id': chain_dir.name,
                        'venue_id': venue_dir.name,
                        'market_id': market_dir.name,
                        'files': len(files),
                        'latest_file': max(f.stem for f in files) if files else None
                    })
        
        return markets
