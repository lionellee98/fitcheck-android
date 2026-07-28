#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
在 CI 中把中文播报预生成为离线 mp3，打包进 APK（不调用系统 TTS）。
使用 edge-tts(zh-CN) 合成，输出到 fitness-app/vendor/tts/ 并生成 manifest.json。
若 edge-tts/网络不可用，则写出空 manifest（App 自动兜底系统语音），不阻断构建。
"""
import asyncio
import json
import os
import re
import sys

WORKSPACE = os.environ.get("GITHUB_WORKSPACE", os.getcwd())
DATA = os.path.join(WORKSPACE, "fitness-app", "data", "exercises.min.json")
OUT_DIR = os.path.join(WORKSPACE, "fitness-app", "vendor", "tts")
VOICE = "zh-CN-XiaoxiaoNeural"
CONCURRENCY = 20

# ---------- 话术清单（固定 + 数字） ----------
def fixed_phrases():
    items = []
    items.append(("train_start", "训练开始，准备好了吗？我们开始今天的训练。"))
    items.append(("warmup_start", "热身开始，活动开关节。"))
    items.append(("cooldown_start", "拉伸放松开始，慢慢来。"))
    items.append(("finish_encourage", "最后一组完成，太棒了！坚持就是胜利！"))
    for k in range(1, 9):
        items.append(("set_start_%d" % k, "第 %d 组，开始。" % k))
    for m in range(20, 91):
        items.append(("rest_%d" % m, "休息 %d 秒，调整呼吸，准备下一组。" % m))
    for n in range(1, 4):
        items.append(("count_%d" % n, "还有 %d 秒。" % n))
    return items

def safe(s):
    return re.sub(r"[^A-Za-z0-9_-]", "_", s)

def first_sentence(text):
    if not text:
        return ""
    return text.split("。")[0].split("！")[0].split("？")[0].split("!")[0].split("?")[0].strip()

def exercise_cues():
    items = []
    if not os.path.exists(DATA):
        return items
    with open(DATA, "r", encoding="utf-8") as f:
        data = json.load(f)
    for ex in data:
        ex_id = ex.get("id") or ex.get("name") or ""
        if not ex_id:
            continue
        zh = ex.get("zh") or ex.get("name") or ""
        core = first_sentence(ex.get("desc") or "")
        text = (zh + "。" + core) if core else zh
        if not text.strip():
            continue
        items.append(("cue_" + safe(str(ex_id)), text))
    return items

async def synth_all(pairs):
    import edge_tts  # 延迟导入，失败时可在主流程捕获
    sem = asyncio.Semaphore(CONCURRENCY)
    manifest = {}
    async def one(cid, text):
        async with sem:
            fname = cid + ".mp3"
            path = os.path.join(OUT_DIR, fname)
            try:
                comm = edge_tts.Communicate(text, VOICE)
                await comm.save(path)
                if os.path.getsize(path) > 0:
                    manifest[cid] = fname
            except Exception as e:
                sys.stderr.write("WARN skip %s: %s\n" % (cid, e))
    await asyncio.gather(*(one(c, t) for c, t in pairs))
    return manifest

def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    pairs = fixed_phrases() + exercise_cues()
    print("待合成语音条数: %d" % len(pairs), flush=True)
    manifest = {}
    try:
        manifest = asyncio.run(synth_all(pairs))
    except Exception as e:
        sys.stderr.write("edge-tts 不可用(%s)，写出空 manifest 兜底系统语音。\n" % e)
        manifest = {}
    with open(os.path.join(OUT_DIR, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=0)
    print("已生成语音文件: %d / %d" % (len(manifest), len(pairs)), flush=True)

if __name__ == "__main__":
    main()
