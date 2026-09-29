"""Dump all RC profiles to server/data/profiles.json. Run: uv run fetch-profiles"""

import json
from pathlib import Path

import httpx
from rc_galaxy.config import RC_TOKEN

API = "https://www.recurse.com/api/v1/profiles"
OUT = Path(__file__).resolve().parents[3] / "data" / "profiles.json"  # server/data/


def main() -> None:
    headers = {"Authorization": f"Bearer {RC_TOKEN}"}
    profiles, offset = [], 0
    with httpx.Client(headers=headers, timeout=30) as client:
        while True:
            r = client.get(API, params={"limit": 50, "offset": offset})
            r.raise_for_status()
            page = r.json()
            if not page:
                break
            profiles.extend(page)
            offset += 50
            print(f"fetched {len(profiles)}")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(profiles, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
