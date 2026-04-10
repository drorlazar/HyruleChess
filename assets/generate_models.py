#!/usr/bin/env python3
"""Batch generate 3D GLB models from reference images via Tripo3D."""

import asyncio
import os
import time

from tripo3d import TripoClient

API_KEY = "tsk_oE-gQBhQTTDeXp0Vr5jcycxJY7Mw8K6OZZxXMmTo9FB"
REFS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "references")
MODELS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models")

PIECES = [
    "hyrule_king_link",
    "hyrule_queen_zelda",
    "hyrule_bishop_impa",
    "hyrule_knight_epona",
    "hyrule_rook_tower",
    "hyrule_pawn_soldier",
    "ganon_king_ganondorf",
    "ganon_queen_phantom",
    "ganon_bishop_wizzrobe",
    "ganon_knight_darknut",
    "ganon_rook_tower",
    "ganon_pawn_moblin",
]


async def generate_model(client, name, semaphore):
    """Submit one image-to-model task and wait for completion."""
    img_path = os.path.join(REFS_DIR, f"{name}.png")
    out_path = os.path.join(MODELS_DIR, f"{name}.glb")

    if os.path.exists(out_path):
        print(f"  [SKIP] {name}.glb already exists", flush=True)
        return name, "skipped"

    if not os.path.exists(img_path):
        print(f"  [ERROR] {name}.png not found", flush=True)
        return name, "missing_image"

    async with semaphore:
        try:
            print(f"  [SUBMIT] {name} — creating image_to_model task...", flush=True)

            task_id = await client.image_to_model(
                image=img_path,
                model_version="v2.0-20240919",
                face_limit=10000,
                texture=True,
                pbr=True,
            )
            print(f"  [TASK] {name} — task_id={task_id}, waiting...", flush=True)

            task = await client.wait_for_task(task_id, polling_interval=5.0, timeout=600, verbose=False)

            if task.status == "success":
                print(f"  [DONE] {name} — downloading...", flush=True)
                files = await client.download_task_models(task, MODELS_DIR)
                # Rename the downloaded file to our naming convention
                for key, path in files.items():
                    if path.endswith(".glb"):
                        if path != out_path:
                            os.rename(path, out_path)
                        size_kb = os.path.getsize(out_path) / 1024
                        print(f"  [SAVED] {name}.glb ({size_kb:.0f} KB)", flush=True)
                        return name, "success"

                print(f"  [ERROR] {name} — no .glb in downloaded files: {files}", flush=True)
                return name, "no_glb"
            else:
                print(f"  [FAILED] {name} — status: {task.status}", flush=True)
                return name, "failed"

        except Exception as e:
            print(f"  [ERROR] {name} — {type(e).__name__}: {e}", flush=True)
            return name, f"error: {e}"


async def main():
    os.makedirs(MODELS_DIR, exist_ok=True)

    client = TripoClient(api_key=API_KEY)

    balance = await client.get_balance()
    print(f"Tripo3D Balance: {balance.balance} credits (frozen: {balance.frozen})", flush=True)

    needed = len([p for p in PIECES if not os.path.exists(os.path.join(MODELS_DIR, f"{p}.glb"))])
    est_cost = needed * 100
    print(f"Models to generate: {needed}, estimated cost: ~{est_cost} credits", flush=True)

    if needed == 0:
        print("All models already exist!", flush=True)
        return

    print(f"\nStarting batch generation...", flush=True)
    start = time.time()

    # Limit concurrency to 4 at a time to avoid overwhelming API
    semaphore = asyncio.Semaphore(4)
    tasks = [generate_model(client, name, semaphore) for name in PIECES]
    results = await asyncio.gather(*tasks)

    elapsed = time.time() - start
    print(f"\n{'='*50}", flush=True)
    print(f"Batch complete in {elapsed:.0f}s", flush=True)
    print(f"{'='*50}", flush=True)

    success = sum(1 for _, s in results if s == "success")
    skipped = sum(1 for _, s in results if s == "skipped")
    failed = sum(1 for _, s in results if s not in ("success", "skipped"))

    print(f"Success: {success}, Skipped: {skipped}, Failed: {failed}", flush=True)

    for name, status in results:
        icon = "OK" if status == "success" else "SKIP" if status == "skipped" else "FAIL"
        print(f"  [{icon}] {name}: {status}", flush=True)

    balance = await client.get_balance()
    print(f"\nRemaining balance: {balance.balance} credits", flush=True)

    await client.close()


if __name__ == "__main__":
    asyncio.run(main())
