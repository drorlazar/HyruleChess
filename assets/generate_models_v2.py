#!/usr/bin/env python3
"""Batch generate v2 3D GLB models (Link's Awakening Switch remake style)
from reference images via Tripo3D. 12 characters + 2 disc pedestals."""

import asyncio
import os
import time

from tripo3d import TripoClient

API_KEY = "tsk_oE-gQBhQTTDeXp0Vr5jcycxJY7Mw8K6OZZxXMmTo9FB"
ROOT = os.path.dirname(os.path.abspath(__file__))
REFS_DIR = os.path.join(ROOT, "references", "v2", "individual")
DISC_REFS_DIR = os.path.join(ROOT, "references", "v2")
MODELS_DIR = os.path.join(ROOT, "models", "v2")

# (reference_path, output_glb_name) tuples
JOBS = [
    # Hyrule characters (cleaned up, no disc baked in)
    (os.path.join(REFS_DIR, "hyrule_king_link_clean.png"),      "hyrule_king_link.glb"),
    (os.path.join(REFS_DIR, "hyrule_queen_zelda_clean.png"),    "hyrule_queen_zelda.glb"),
    (os.path.join(REFS_DIR, "hyrule_bishop_impa_clean.png"),    "hyrule_bishop_impa.glb"),
    (os.path.join(REFS_DIR, "hyrule_knight_epona_clean.png"),   "hyrule_knight_epona.glb"),
    (os.path.join(REFS_DIR, "hyrule_rook_tower_clean.png"),     "hyrule_rook_tower.glb"),
    (os.path.join(REFS_DIR, "hyrule_pawn_soldier_clean.png"),   "hyrule_pawn_soldier.glb"),
    # Ganon characters
    (os.path.join(REFS_DIR, "ganon_king_ganondorf_clean.png"),  "ganon_king_ganondorf.glb"),
    (os.path.join(REFS_DIR, "ganon_queen_phantom_clean.png"),   "ganon_queen_phantom.glb"),
    (os.path.join(REFS_DIR, "ganon_bishop_wizzrobe_clean.png"), "ganon_bishop_wizzrobe.glb"),
    (os.path.join(REFS_DIR, "ganon_knight_darknut_clean.png"),  "ganon_knight_darknut.glb"),
    (os.path.join(REFS_DIR, "ganon_rook_tower_clean.png"),      "ganon_rook_tower.glb"),
    (os.path.join(REFS_DIR, "ganon_pawn_moblin_clean.png"),     "ganon_pawn_moblin.glb"),
    # Two disc pedestals (separate from characters)
    (os.path.join(DISC_REFS_DIR, "disc_hyrule.png"),            "disc_hyrule.glb"),
    (os.path.join(DISC_REFS_DIR, "disc_ganon.png"),             "disc_ganon.glb"),
]


async def generate_model(client, img_path, out_name, semaphore):
    out_path = os.path.join(MODELS_DIR, out_name)

    if os.path.exists(out_path):
        print(f"  [SKIP] {out_name} already exists", flush=True)
        return out_name, "skipped"

    if not os.path.exists(img_path):
        print(f"  [ERROR] {os.path.basename(img_path)} not found at {img_path}", flush=True)
        return out_name, "missing_image"

    async with semaphore:
        try:
            print(f"  [SUBMIT] {out_name} — creating image_to_model task...", flush=True)
            task_id = await client.image_to_model(
                image=img_path,
                model_version="v2.0-20240919",
                face_limit=10000,
                texture=True,
                pbr=True,
            )
            print(f"  [TASK] {out_name} — task_id={task_id}, waiting...", flush=True)

            task = await client.wait_for_task(task_id, polling_interval=5.0, timeout=600, verbose=False)

            if task.status == "success":
                print(f"  [DONE] {out_name} — downloading...", flush=True)
                files = await client.download_task_models(task, MODELS_DIR)
                for key, path in files.items():
                    if path.endswith(".glb"):
                        if path != out_path:
                            os.rename(path, out_path)
                        size_kb = os.path.getsize(out_path) / 1024
                        print(f"  [SAVED] {out_name} ({size_kb:.0f} KB)", flush=True)
                        return out_name, "success"
                print(f"  [ERROR] {out_name} — no .glb in downloaded files: {files}", flush=True)
                return out_name, "no_glb"
            else:
                print(f"  [FAILED] {out_name} — status: {task.status}", flush=True)
                return out_name, "failed"
        except Exception as e:
            print(f"  [ERROR] {out_name} — {type(e).__name__}: {e}", flush=True)
            return out_name, f"error: {e}"


async def main():
    os.makedirs(MODELS_DIR, exist_ok=True)

    client = TripoClient(api_key=API_KEY)

    balance = await client.get_balance()
    print(f"Tripo3D Balance: {balance.balance} credits (frozen: {balance.frozen})", flush=True)

    needed = len([j for j in JOBS if not os.path.exists(os.path.join(MODELS_DIR, j[1]))])
    # v2.0-20240919 image_to_model is ~30 credits per task (not 100 as the
    # older script estimated). Leave a 2x safety margin just in case.
    est_cost = needed * 30
    print(f"Models to generate: {needed}, estimated cost: ~{est_cost} credits", flush=True)

    # Only abort if we can't even cover the estimated cost. Tripo3D will
    # itself reject individual tasks if the balance runs out mid-batch.
    if balance.balance < est_cost:
        print(f"WARNING: balance ({balance.balance}) below estimated cost ({est_cost}), aborting", flush=True)
        await client.close()
        return

    if needed == 0:
        print("All models already exist!", flush=True)
        await client.close()
        return

    print(f"\nStarting v2 batch generation (14 jobs)...", flush=True)
    start = time.time()

    semaphore = asyncio.Semaphore(4)
    tasks = [generate_model(client, img, name, semaphore) for img, name in JOBS]
    results = await asyncio.gather(*tasks)

    elapsed = time.time() - start
    print(f"\n{'=' * 50}", flush=True)
    print(f"Batch complete in {elapsed:.0f}s", flush=True)
    print(f"{'=' * 50}", flush=True)

    success = sum(1 for _, s in results if s == "success")
    skipped = sum(1 for _, s in results if s == "skipped")
    failed = sum(1 for _, s in results if s not in ("success", "skipped"))
    print(f"Success: {success}, Skipped: {skipped}, Failed: {failed}", flush=True)

    for name, status in results:
        icon = "OK  " if status == "success" else "SKIP" if status == "skipped" else "FAIL"
        print(f"  [{icon}] {name}: {status}", flush=True)

    balance = await client.get_balance()
    print(f"\nRemaining balance: {balance.balance} credits", flush=True)

    await client.close()


if __name__ == "__main__":
    asyncio.run(main())
