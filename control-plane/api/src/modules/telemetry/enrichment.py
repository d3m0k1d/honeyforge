import asyncio
import ipaddress
import json
import time
from typing import Any
from urllib.parse import quote
from urllib.request import Request, urlopen

from core.config import Settings

_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_cache_ttl = 3600
_cache_limit = 2048


def source_host(source: str | None) -> str | None:
    if not source:
        return None
    value = source.strip()
    if value.startswith("[") and "]" in value:
        value = value[1 : value.index("]")]
    elif value.count(":") == 1:
        value = value.rsplit(":", 1)[0]
    try:
        return str(ipaddress.ip_address(value))
    except ValueError:
        return None


def _lookup(host: str) -> dict[str, Any]:
    url = Settings.GEO_LOOKUP_URL.format(ip=quote(host, safe=""))
    request = Request(
        url,
        headers={"Accept": "application/json", "User-Agent": "HoneyForge/1.0"},
    )
    with urlopen(request, timeout=Settings.GEO_LOOKUP_TIMEOUT_SECONDS) as response:
        if response.status != 200:
            return {}
        value = json.loads(response.read(64 * 1024))
    if not isinstance(value, dict):
        return {}
    return value


async def enrich(source: str | None, data: dict[str, Any]) -> dict[str, Any]:
    """Enrich an event centrally; lookup failure never rejects telemetry."""
    result = dict(data)
    host = source_host(source)
    if host is None:
        return result
    address = ipaddress.ip_address(host)
    if address.is_private or address.is_loopback or address.is_reserved:
        result.setdefault("source_scope", "private")
        return result
    if not Settings.GEO_LOOKUP_ENABLED:
        return result

    now = time.monotonic()
    cached = _cache.get(host)
    if cached and cached[0] > now:
        lookup = cached[1]
    else:
        try:
            lookup = await asyncio.to_thread(_lookup, host)
        except (OSError, ValueError, TimeoutError, json.JSONDecodeError):
            result.setdefault("enrichment_error", "geo_lookup_failed")
            return result
        if len(_cache) >= _cache_limit:
            _cache.pop(next(iter(_cache)))
        _cache[host] = (now + _cache_ttl, lookup)

    mappings = {
        "country_code": "country",
        "country_name": "country_name",
        "region": "region",
        "city": "city",
        "latitude": "latitude",
        "longitude": "longitude",
        "asn": "asn",
        "org": "asn_org",
    }
    for source_key, target_key in mappings.items():
        value = lookup.get(source_key)
        if value not in (None, ""):
            result.setdefault(target_key, str(value))
    if any(key in result for key in ("asn", "country")):
        result.setdefault("enrichment_source", "ipapi")
    return result
