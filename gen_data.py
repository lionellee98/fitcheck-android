#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Generate a trimmed, app-ready dataset from the exercise skill's data."""
import json
import os

SKILL = r"C:\Users\Administrator\.workbuddy\skills\exercise-dataset-zh"
OUT_DIR = r"C:\Users\Administrator\WorkBuddy\2026-07-27-09-23-40\fitness-app\data"
os.makedirs(OUT_DIR, exist_ok=True)

exercises = json.load(open(os.path.join(SKILL, "data", "exercises.json"), encoding="utf-8"))
name_zh = json.load(open(os.path.join(SKILL, "data", "name_zh.json"), encoding="utf-8"))

# body part -> region group (Chinese label)
REGION = {
    "chest": "胸部",
    "back": "背部",
    "shoulders": "肩部",
    "upper arms": "手臂",
    "lower arms": "手臂",
    "upper legs": "腿部",
    "lower legs": "腿部",
    "waist": "核心/腰腹",
    "cardio": "有氧",
    "neck": "颈部",
}

out = []
for e in exercises:
    bp = (e.get("body_part") or "").strip().lower()
    region = REGION.get(bp, "其他")
    gif = e.get("gif_url") or ""
    gif = os.path.basename(gif) if gif else ""
    zh = name_zh.get(e.get("name", ""), "")
    instr = e.get("instructions", {}) or {}
    steps = e.get("instruction_steps", {}) or {}
    desc = (instr.get("zh") or instr.get("en") or "").strip()
    step_arr = steps.get("zh") or steps.get("en") or []
    step_arr = [str(s).strip() for s in step_arr if str(s).strip()][:8]
    out.append({
        "id": e.get("id"),
        "name": e.get("name", ""),
        "zh": zh,
        "bodyPart": bp,
        "region": region,
        "equipment": (e.get("equipment") or "").strip().lower(),
        "target": (e.get("target") or "").strip().lower(),
        "secondary": [str(s).strip().lower() for s in (e.get("secondary_muscles") or [])],
        "category": (e.get("category") or "").strip().lower(),
        "gif": gif,
        "desc": desc,
        "steps": step_arr,
    })

# group counts by region
counts = {}
for e in out:
    counts[e["region"]] = counts.get(e["region"], 0) + 1

with open(os.path.join(OUT_DIR, "exercises.min.json"), "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

print("total exercises:", len(out))
print("regions:", counts)
print("output bytes:", os.path.getsize(os.path.join(OUT_DIR, "exercises.min.json")))
