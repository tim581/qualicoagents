#!/usr/bin/env python3
"""
Bol Retailer API helper for stock refresh workflows.

Usage:
  python scripts/bol_retailer_api.py token
  python scripts/bol_retailer_api.py offers --limit 50
  python scripts/bol_retailer_api.py export-stock --out .debug/bol-stock-snapshot.json

Env vars required:
  BOL_CLIENT_ID
  BOL_CLIENT_SECRET
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, Optional
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

TOKEN_URL = "https://login.bol.com/token?grant_type=client_credentials"
API_BASE = "https://api.bol.com/retailer"


class BolApiError(RuntimeError):
    pass


def _http_json(
    method: str,
    url: str,
    headers: Optional[Dict[str, str]] = None,
    body: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    payload = None
    req_headers = {"Accept": "application/vnd.retailer.v10+json"}
    if headers:
        req_headers.update(headers)
    if body is not None:
        payload = json.dumps(body).encode("utf-8")
        req_headers["Content-Type"] = "application/json"

    req = Request(url=url, method=method, headers=req_headers, data=payload)
    try:
        with urlopen(req, timeout=40) as resp:
            raw = resp.read().decode("utf-8") if resp.length != 0 else "{}"
            if not raw.strip():
                return {}
            return json.loads(raw)
    except HTTPError as exc:
        details = exc.read().decode("utf-8", errors="ignore")
        raise BolApiError(f"HTTP {exc.code} for {url}: {details[:500]}") from exc
    except URLError as exc:
        raise BolApiError(f"Network error for {url}: {exc}") from exc


def get_access_token(client_id: str, client_secret: str) -> str:
    auth = f"{client_id}:{client_secret}".encode("utf-8")
    import base64

    basic = base64.b64encode(auth).decode("ascii")
    data = _http_json(
        "POST",
        TOKEN_URL,
        headers={
            "Authorization": f"Basic {basic}",
            "Accept": "application/json",
        },
    )
    token = data.get("access_token")
    if not token:
        raise BolApiError("No access_token in Bol auth response")
    return token


def get_offers(token: str, limit: int = 50) -> Dict[str, Any]:
    params = urlencode({"page": 1, "limit": limit})
    return _http_json(
        "GET",
        f"{API_BASE}/offers?{params}",
        headers={"Authorization": f"Bearer {token}"},
    )


def export_stock_snapshot(token: str, limit: int = 200) -> Dict[str, Any]:
    data = get_offers(token, limit=limit)
    offers = data.get("offers", [])
    snapshot = []
    for o in offers:
        snapshot.append(
            {
                "offerId": o.get("offerId"),
                "ean": o.get("ean"),
                "reference": o.get("reference"),
                "onHoldByRetailer": o.get("onHoldByRetailer"),
                "unknownProductTitle": o.get("unknownProductTitle"),
                "stockAmount": (o.get("stock") or {}).get("amount"),
                "stockManagedByRetailer": (o.get("stock") or {}).get("managedByRetailer"),
                "fulfilmentMethod": o.get("fulfilmentMethod"),
            }
        )
    return {"count": len(snapshot), "offers": snapshot}


def _require_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise BolApiError(f"Missing env var {name}")
    return value


def main() -> int:
    parser = argparse.ArgumentParser(description="Bol Retailer API helper")
    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("token", help="Print token check result")

    p_offers = sub.add_parser("offers", help="Fetch offers list")
    p_offers.add_argument("--limit", type=int, default=50)

    p_export = sub.add_parser("export-stock", help="Export compact stock snapshot JSON")
    p_export.add_argument("--limit", type=int, default=200)
    p_export.add_argument("--out", type=str, default=".debug/bol-stock-snapshot.json")

    args = parser.parse_args()

    try:
        client_id = _require_env("BOL_CLIENT_ID")
        client_secret = _require_env("BOL_CLIENT_SECRET")
        token = get_access_token(client_id, client_secret)

        if args.cmd == "token":
            print(json.dumps({"ok": True, "token_prefix": token[:12]}, indent=2))
            return 0

        if args.cmd == "offers":
            data = get_offers(token, limit=args.limit)
            print(json.dumps(data, indent=2))
            return 0

        if args.cmd == "export-stock":
            out = Path(args.out)
            out.parent.mkdir(parents=True, exist_ok=True)
            snapshot = export_stock_snapshot(token, limit=args.limit)
            out.write_text(json.dumps(snapshot, indent=2), encoding="utf-8")
            print(json.dumps({"ok": True, "out": str(out), "count": snapshot["count"]}, indent=2))
            return 0

        raise BolApiError(f"Unsupported command: {args.cmd}")
    except BolApiError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, indent=2))
        return 1


if __name__ == "__main__":
    sys.exit(main())
