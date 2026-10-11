#!/usr/bin/env python3
"""Upload explicitly selected Kaggle outputs to the owner's AI Video R2 bridge.

Kaggle secrets: AIVIDEO_BRIDGE_TOKEN (required), AIVIDEO_APP_URL (optional).
Run manually after a render. Never put the token directly in shared notebook cells.
"""
import argparse
import glob
import os
import sys
from pathlib import Path
from urllib.parse import urlsplit

import requests

DEFAULT_GLOBS = {
    "cinema": [
        "/kaggle/working/wan_broll/*.mp4",
        "/kaggle/working/cinema_output/*.mp4",
        "/kaggle/working/MABRIG_*WAN*.mp4",
    ],
    "voice": [
        "/kaggle/working/voice_outputs/*.wav",
        "/kaggle/working/voice_outputs/*.mp3",
        "/kaggle/working/*voice*.wav",
    ],
    "musetalk": [
        "/kaggle/working/musetalk_results/**/*.mp4",
        "/kaggle/working/results/**/*.mp4",
        "/kaggle/working/*musetalk*.mp4",
    ],
}
MAX_BYTES = 1024 * 1024 * 1024
WORKDIR = Path("/kaggle/working").resolve()


def get_secret(name: str) -> str:
    try:
        from kaggle_secrets import UserSecretsClient
        value = UserSecretsClient().get_secret(name)
        if value:
            return value.strip()
    except Exception:
        pass
    return os.environ.get(name, "").strip()


def api_request(method: str, url: str, token: str, body: dict):
    result = requests.request(
        method, url, headers={
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json",
        },
        json=body, timeout=(20, 45),
    )
    if result.status_code >= 400:
        # Avoid returning provider response bodies that could echo credentials.
        raise RuntimeError(f"AI Video bridge returned HTTP {result.status_code}")
    return result.json()


def validate_file(path: Path) -> Path:
    resolved = path.expanduser().resolve()
    if not resolved.is_relative_to(WORKDIR):
        raise ValueError(f"File must be inside {WORKDIR}: {path}")
    if not resolved.is_file():
        raise ValueError(f"File not found: {resolved}")
    if resolved.stat().st_size == 0 or resolved.stat().st_size > MAX_BYTES:
        raise ValueError(f"File must be nonempty and at most 1 GiB: {resolved.name}")
    return resolved


def candidates(pipeline: str, explicit: list[str], scan: bool) -> list[Path]:
    paths = [Path(item) for item in explicit]
    if scan:
        for pattern in DEFAULT_GLOBS[pipeline]:
            paths.extend(Path(item) for item in glob.glob(pattern, recursive=True))
    deduped = []
    visited = set()
    for path in paths:
        try:
            checked = validate_file(path)
        except ValueError as error:
            if not scan or path in [Path(x) for x in explicit]:
                raise
            print(f"Skipping unsuitable discovered file: {error}")
            continue
        if checked not in visited:
            deduped.append(checked)
            visited.add(checked)
    return sorted(deduped, key=lambda p: p.stat().st_mtime, reverse=True)[:12]


def run() -> int:
    parser = argparse.ArgumentParser(description="Import selected Kaggle output media to AI Video.")
    parser.add_argument("--pipeline", required=True, choices=list(DEFAULT_GLOBS))
    parser.add_argument("--project", default="mabrig-cinema")
    parser.add_argument("--file", action="append", default=[], help="Absolute path; may repeat.")
    parser.add_argument("--scan", action="store_true", help="Find up to 12 known output files (no uploads before --consent).")
    parser.add_argument("--consent", action="store_true", help="Confirm ownership/permission for audio and likeness.")
    args = parser.parse_args()
    if not args.consent:
        parser.error("Add --consent only when you have permission to use the audio and likeness.")
    if not args.file and not args.scan:
        parser.error("Provide --file /kaggle/working/output.mp4 or --scan.")
    token = get_secret("AIVIDEO_BRIDGE_TOKEN")
    if len(token) < 24:
        print("Missing AIVIDEO_BRIDGE_TOKEN. Add it in Kaggle Add-ons > Secrets, then enable notebook access.")
        return 2
    app_url = get_secret("AIVIDEO_APP_URL") or "https://aivideo.mabrigkorie.org"
    parsed = urlsplit(app_url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        print("AIVIDEO_APP_URL must be an HTTPS website address.")
        return 2
    api_url = app_url.rstrip("/") + "/api/kaggle"
    try:
        files = candidates(args.pipeline, args.file, args.scan)
    except ValueError as err:
        print(str(err))
        return 2
    if not files:
        print("No render outputs found. Render first, or supply --file with the actual path.")
        return 2

    completed = 0
    for path in files:
        print(f"Preparing {args.pipeline}: {path.name} ({path.stat().st_size:,} bytes)")
        try:
            description = {
                "action": "prepare", "pipeline": args.pipeline,
                "projectId": args.project, "filename": path.name,
                "sizeBytes": path.stat().st_size, "consentConfirmed": True,
            }
            receipt = api_request("POST", api_url, token, description)
            upload_url = receipt.get("uploadUrl", "")
            target = urlsplit(upload_url)
            if target.scheme != "https" or not target.hostname:
                raise RuntimeError("Bridge did not return an HTTPS upload destination.")
            with path.open("rb") as stream:
                upload = requests.put(
                    upload_url, data=stream,
                    headers={"Content-Type": receipt["contentType"]},
                    timeout=(30, 900),
                )
                if not 200 <= upload.status_code < 300:
                    raise RuntimeError(f"R2 media upload rejected (HTTP {upload.status_code}).")
            confirmation = {
                "action": "complete", "id": receipt["id"],
                "pipeline": receipt["pipeline"], "projectId": receipt["projectId"],
                "filename": receipt["filename"], "sizeBytes": receipt["sizeBytes"],
                "proof": receipt["proof"],
            }
            response = api_request("POST", api_url, token, confirmation)
            if response.get("completed"):
                print(f"Imported: {path.name}, id={response['id']}")
                completed += 1
            else:
                print(f"Upload not confirmed for {path.name}.")
        except (requests.RequestException, RuntimeError, KeyError, ValueError) as exc:
            print(f"Import failed for {path.name}: {exc}")
            # Continue to the next explicit file without duplicating a successful import.
    print(f"Import finished: {completed}/{len(files)} files confirmed.")
    return 0 if completed == len(files) else 1


if __name__ == "__main__":
    sys.exit(run())
