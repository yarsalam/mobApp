import json
import os

CACHE_DIR = os.getenv("ASSISTANT_CACHE_DIR", "/tmp/assistant_cache")
os.makedirs(CACHE_DIR, exist_ok=True)


def save_json(name: str, data: dict) -> None:
    path = os.path.join(CACHE_DIR, f"{name}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def load_json(name: str) -> dict | None:
    path = os.path.join(CACHE_DIR, f"{name}.json")
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)
