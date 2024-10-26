# data_cache.py
import requests
import sqlite3
import time
from cachetools import TTLCache

class DataCache:
    CACHE_TTL = 60  # Cache time-to-live in seconds

    def __init__(self):
        self.cache = TTLCache(maxsize=100, ttl=self.CACHE_TTL)
        self.db = sqlite3.connect("data_cache.db")
        self.db.execute("CREATE TABLE IF NOT EXISTS api_data (key TEXT PRIMARY KEY, value TEXT, timestamp REAL)")

    def fetch_data(self, url, params):
        """Fetch data with caching; uses SQLite for persistent storage."""
        key = f"{url}-{str(params)}"
        if key in self.cache:
            return self.cache[key]

        # Check in SQLite database if not in in-memory cache
        result = self.db.execute("SELECT value FROM api_data WHERE key = ? AND timestamp > ?", (key, time.time() - self.CACHE_TTL)).fetchone()
        if result:
            self.cache[key] = result[0]
            return result[0]

        # If not in cache or DB, fetch from API
        response = requests.get(url, params=params)
        response.raise_for_status()
        data = response.json()
        self.cache[key] = data

        # Store in SQLite
        self.db.execute("REPLACE INTO api_data (key, value, timestamp) VALUES (?, ?, ?)", (key, str(data), time.time()))
        self.db.commit()

        return data