/* Fitness check-in PWA — UI, routing, local logic. */
(function () {
  'use strict';

  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const gifUrl = g => 'assets/videos/' + g;

  let EXERCISES = [];
  let currentPlan = null;     // plan items for today (in memory until completed)
  let guideState = { region: '全部', query: '', offset: 0 };

  const QUOTES = [
    '今天流的汗，是昨天掉的肉。开干！',
    '肌肉不会辜负每一次力竭，坚持就是胜利。',
    '你比昨天的自己强一点，就是进步。',
    '别等状态好才练，练着练着状态就来了。',
    '自律给你自由，今天的训练你做主。',
    '脂肪最怕的是不肯放弃的你。冲！',
    '把借口留在门外，把汗水留在这里。',
    '每一次深蹲，都是在为更好的自己蓄力。',
  ];

  /* ---------- helpers ---------- */
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 1800);
  }
  function fmtTime(sec) {
    const m = Math.floor(sec / 60), s = sec % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }
  function openModal(id) { $('#' + id).classList.add('show'); }
  function closeModal(id) { $('#' + id).classList.remove('show'); }

  /* ---------- theme ---------- */
  function initTheme() {
    const saved = Store.getTheme();
    const sysDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const dark = saved ? saved === 'dark' : sysDark;
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    $('#themeToggle').textContent = dark ? '☀️' : '🌙';
  }
  $('#themeToggle').addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    Store.setTheme(next);
    $('#themeToggle').textContent = next === 'dark' ? '☀️' : '🌙';
  });

  /* ---------- routing ---------- */
  $$('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const page = btn.dataset.page;
      $$('.nav-btn').forEach(b => b.classList.toggle('active', b === btn));
      $$('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + page));
      if (page === 'plan') renderPlan();
      if (page === 'progress') renderProgress();
      if (page === 'guide') renderGuide();
      if (page === 'body') renderBody();
    });
  });

  // 生命周期兜底：App 从后台回到前台（WebView 可能被系统回收/重建）时，
  // 若停留在每日计划页，重新从草稿恢复「开始跟练」按钮，避免其偶发消失。
  function syncPlanOnReturn() {
    if (!EXERCISES.length) return;
    if ($('#page-plan').classList.contains('active')) renderPlan();
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncPlanOnReturn(); });
  window.addEventListener('pageshow', syncPlanOnReturn);

  /* ---------- daily quote ---------- */
  function maybeQuote() {
    const today = Store.todayStr();
    if (Store.lastQuoteDate() === today) return;
    $('#quoteText').textContent = QUOTES[Math.floor(Math.random() * QUOTES.length)];
    Store.setLastQuoteDate(today);
    openModal('quoteModal');
  }
  $('#quoteClose').addEventListener('click', () => closeModal('quoteModal'));
  $$('[data-close]').forEach(b => b.addEventListener('click', () => closeModal(b.dataset.close)));
  // 关闭跟练弹窗时停止计时与语音，避免后台定时器/语音继续走导致再次打开无法暂停
  document.querySelector('[data-close="workoutModal"]').addEventListener('click', () => { stopTimer(); stopSpeech(); });

  /* ================= 每日计划 ================= */
  let planCfg = { duration: 'ai', custom: '', env: 'gym', partsMode: 'ai', parts: [] };
  let pendingPlan = null;       // 实时预览中的计划（尚未提交）
  let pendingMeta = null;

  const PARTS = ['胸部', '背部', '肩部', '手臂', '腿部', '核心/腰腹', '有氧', '颈部'];
  const SCENE = {
    gym: { ic: '🏋️', t: '健身房模式', s: '器械全部开放 · 自由重量 + 固定器械' },
    home: { ic: '🏠', t: '居家模式', s: '仅哑铃 + 垫上徒手 · 无需任何器械' },
    outdoor: { ic: '🌳', t: '户外模式', s: '徒手 + 单杠 / 双杠 · 轻装出门' },
  };
  function isTodayCompleted() { const r = Store.getDay(Store.todayStr()); return !!(r && r.completed); }
  function computeDuration() {
    return planCfg.duration === 'ai' ? AI.suggestDuration(Store.getProfile())
      : (parseInt(planCfg.custom) || parseInt(planCfg.duration) || 30);
  }
  function currentRegions() {
    if (planCfg.partsMode !== 'manual') return null;     // AI 推荐
    return planCfg.parts.length ? planCfg.parts : null; // 自选但未选 → 退回 AI
  }

  function renderPlan() {
    const today = Store.todayStr();
    const rec = Store.getDay(today);
    const hero = $('#planHero');
    if (rec && rec.completed) {
      hero.innerHTML = `<div class="h-label">今日已打卡 ✓</div>
        <div class="h-main">${rec.durationMin} 分钟</div>
        <div class="h-sub">消耗约 ${rec.calories} kcal · ${rec.plan.length} 个动作 · ${envLabel(rec.env)}</div>`;
      currentPlan = rec.plan.map(p => Object.assign({}, p));
      currentPlan._meta = { durationMin: rec.durationMin, env: rec.env };
      $('#planPreview').innerHTML = '';
      Store.clearDraft(today);
      renderPartsChips();
    } else {
      // 恢复未完成的当天计划草稿，让「开始跟练」在切换页面或重开 App 后依然在
      const draft = Store.getDraft(today);
      if (draft && draft.plan && draft.plan.length) {
        hero.innerHTML = `<div class="h-label">今日训练待开始</div>
          <div class="h-main">${draft.meta.durationMin} 分钟</div>
          <div class="h-sub">已生成计划 · 点击下方「开始跟练」即可训练</div>`;
        currentPlan = draft.plan.map(p => Object.assign({}, p));
        currentPlan._meta = Object.assign({}, draft.meta);
        $('#planPreview').innerHTML = '';
        renderPartsChips();
      } else {
        const dur = computeDuration();
        hero.innerHTML = `<div class="h-label">今日尚未打卡</div>
          <div class="h-main">${dur} 分钟训练</div>
          <div class="h-sub">选好条件，下方实时预览今日动作</div>`;
        currentPlan = null;
        renderPartsChips();
        renderPlanPreview();
      }
    }
    renderPlanResult();
  }

  // 提交（锁定）计划：写入草稿并渲染「今日动作顺序 + 开始跟练」
  function commitPlan(plan, meta) {
    currentPlan = plan;
    currentPlan._meta = meta;
    const slim = plan.map(p => ({
      id: p.id, name: p.name, zh: p.zh, gif: p.gif, region: p.region,
      equipment: p.equipment, sets: p.sets, reps: p.reps, secs: p.secs, kind: p.kind,
      intensity: p.intensity, restSecs: p.restSecs, core: p.core
    }));
    Store.saveDraft(Store.todayStr(), { plan: slim, meta });
    $('#planPreview').innerHTML = '';   // 提交后隐藏实时预览，展示已锁定计划
    renderPlanResult();
  }

  // 修改训练条件 → 退回实时预览并清掉草稿（让计划重新随配置更新）
  function resetPlanToPreview() {
    currentPlan = null;
    Store.clearDraft(Store.todayStr());
    $('#planResult').innerHTML = '';    // 清掉可能残留的已锁定计划，避免陈旧的「开始跟练」
    renderPlanPreview();
  }

  // 统一的动作列表渲染：按 热身/训练/放松 分组，并在每个分类旁显示该分类总耗时(MM:SS)
  function phaseTotal(items) {
    return items.reduce((s, p) => {
      const work = (p.sets || 1) * (p.secs || 0);
      const rests = Math.max(0, (p.sets || 1) - 1) * (p.restSecs || 0);
      return s + work + rests;
    }, 0);
  }
  function planItemsHTML(plan) {
    const PHASE = { warmup: '热身', main: '训练', cooldown: '放松' };
    const ORDER = ['warmup', 'main', 'cooldown'];
    let html = '';
    ORDER.forEach(kind => {
      const items = plan.filter(p => p.kind === kind);
      if (!items.length) return;
      html += `<div class="phase-head"><span class="phase-name">${PHASE[kind]}</span>` +
        `<span class="phase-time">${fmtTime(phaseTotal(items))}</span></div>`;
      html += items.map(p => `
        <div class="plan-item" data-id="${p.id}">
          <div class="ord">${plan.indexOf(p) + 1}</div>
          <img loading="lazy" src="${gifUrl(p.gif)}" alt="${p.zh || p.name}" onerror="this.style.visibility='hidden'">
          <div class="pi-info">
            <div class="pi-name">${p.zh || p.name}</div>
            <div class="pi-meta"><span class="pi-tag pi-${p.kind}">${PHASE[kind] || ''}</span>${p.region} · ${p.equipment} · ${p.sets}组×${p.reps}</div>
          </div>
          <div class="pi-reps">${fmtTime((p.sets || 1) * (p.secs || 0))}</div>
        </div>`).join('');
    });
    return html;
  }
  function envLabel(e) { return e === 'gym' ? '健身房' : e === 'home' ? '居家' : '室外体育场'; }

  // 取得当前可训练计划：优先内存中的 currentPlan，否则从草稿/已完成记录恢复。
  // 这是「开始跟练」偶发消失的根因兜底——即便 currentPlan 因页面状态丢失为 null，
  // 也能从持久化的草稿重新取回，按钮永远点得出去。
  function getActivePlan() {
    if (currentPlan && currentPlan.length) return currentPlan;
    const today = Store.todayStr();
    const rec = Store.getDay(today);
    if (rec && rec.completed && rec.plan && rec.plan.length) {
      currentPlan = rec.plan.map(p => Object.assign({}, p));
      currentPlan._meta = { durationMin: rec.durationMin, env: rec.env };
      return currentPlan;
    }
    const draft = Store.getDraft(today);
    if (draft && draft.plan && draft.plan.length) {
      currentPlan = draft.plan.map(p => Object.assign({}, p));
      currentPlan._meta = Object.assign({}, draft.meta);
      return currentPlan;
    }
    return null;
  }

  function renderPlanResult() {
    const box = $('#planResult');
    const plan = getActivePlan();
    if (!plan || !plan.length) { box.innerHTML = ''; return; }
    currentPlan = plan;
    box.innerHTML = `<div class="card-title">今日动作顺序</div>` + planItemsHTML(plan) +
      `<button id="startWorkout" class="primary-btn" style="margin-top:6px">▶ 开始跟练</button>`;
    $$('#planResult .plan-item').forEach(el => el.addEventListener('click', () => {
      const ex = AI.byId(el.dataset.id);
      if (ex) showExercise(ex);
    }));
    $('#startWorkout').addEventListener('click', startWorkout);
  }

  // 部位选择 chips（仅手动模式显示）
  function renderPartsChips() {
    const box = $('#partsChips');
    const hint = $('#partsHint');
    if (planCfg.partsMode !== 'manual') { box.innerHTML = ''; hint.textContent = 'AI 将根据你的打卡进度与身体重点，智能搭配训练部位。'; return; }
    box.innerHTML = PARTS.map(r => `<div class="chip ${planCfg.parts.includes(r) ? 'active' : ''}" data-r="${r}">${r}</div>`).join('');
    hint.textContent = planCfg.parts.length ? '已选 ' + planCfg.parts.length + ' 个部位，下方实时更新动作' : '请选择至少一个目标肌群';
    $$('#partsChips .chip').forEach(c => c.addEventListener('click', () => {
      const set = new Set(planCfg.parts);
      set.has(c.dataset.r) ? set.delete(c.dataset.r) : set.add(c.dataset.r);
      planCfg.parts = Array.from(set);
      renderPartsChips();
      if (!isTodayCompleted()) resetPlanToPreview();
    }));
  }

  // 实时预览：随环境 / 时长 / 部位即时刷新动作列表
  function renderPlanPreview() {
    const box = $('#planPreview');
    if (currentPlan) { box.innerHTML = ''; return; } // 已提交计划时隐藏预览
    if (planCfg.partsMode === 'manual' && !planCfg.parts.length) { box.innerHTML = ''; return; }
    const profile = Store.getProfile() || {};
    const dur = computeDuration();
    const env = planCfg.env;
    const regions = currentRegions();
    const plan = AI.generatePlan({ durationMin: dur, env, profile, completedDays: Store.countDays(), concernRegions: profile.concernAreas || [], regions });
    pendingPlan = plan; pendingMeta = { durationMin: dur, env };
    const badge = SCENE[env];
    const head = `<div class="scene-badge scene-${env}">
        <span class="sb-ic">${badge.ic}</span>
        <div class="sb-text"><div class="sb-t">${badge.t}</div><div class="sb-s">${badge.s}</div></div>
      </div>`;
    const PHASE = { warmup: '热身', main: '训练', cooldown: '放松' };
    const items = plan.map((p, i) => `
      <div class="plan-item" data-id="${p.id}">
        <div class="ord">${i + 1}</div>
        <img loading="lazy" src="${gifUrl(p.gif)}" alt="${p.zh || p.name}" onerror="this.style.visibility='hidden'">
        <div class="pi-info">
          <div class="pi-name">${p.zh || p.name}</div>
          <div class="pi-meta"><span class="pi-tag pi-${p.kind}">${PHASE[p.kind] || ''}</span>${p.region} · ${p.equipment}</div>
        </div>
        <div class="pi-reps">${p.sets === 1 ? p.reps : p.sets + ' 组 × ' + p.reps}</div>
      </div>`).join('');
    box.innerHTML = head +
      `<div class="card-title preview-title">今日训练动作预览 · 共 ${plan.length} 个</div>` + planItemsHTML(plan) +
      `<button id="startWorkoutPreview" class="primary-btn" style="margin-top:10px;width:100%">▶ 开始跟练</button>`;
    $$('#planPreview .plan-item').forEach(el => el.addEventListener('click', () => {
      const ex = AI.byId(el.dataset.id); if (ex) showExercise(ex);
    }));
    const pv = $('#startWorkoutPreview');
    if (pv) pv.addEventListener('click', () => {
      if (!pendingPlan || !pendingPlan.length) { toast('请先生成今日计划'); return; }
      commitPlan(pendingPlan, pendingMeta);   // 直接以预览计划开始
      startWorkout();
    });
  }

  $('#durationSeg').addEventListener('click', e => {
    if (e.target.tagName !== 'BUTTON') return;
    $$('#durationSeg button').forEach(b => b.classList.toggle('active', b === e.target));
    planCfg.duration = e.target.dataset.v;
    if (planCfg.duration !== 'ai') $('#durationCustom').value = '';
    if (!isTodayCompleted()) resetPlanToPreview();
  });
  $('#durationCustom').addEventListener('input', e => {
    planCfg.custom = e.target.value;
    if (e.target.value) {
      $$('#durationSeg button').forEach(b => b.classList.remove('active'));
      if (!isTodayCompleted()) resetPlanToPreview();
    }
  });
  $('#envSeg').addEventListener('click', e => {
    if (e.target.tagName !== 'BUTTON') return;
    $$('#envSeg button').forEach(b => b.classList.toggle('active', b === e.target));
    planCfg.env = e.target.dataset.v;
    if (!isTodayCompleted()) resetPlanToPreview();
  });
  $('#partsModeSeg').addEventListener('click', e => {
    if (e.target.tagName !== 'BUTTON') return;
    $$('#partsModeSeg button').forEach(b => b.classList.toggle('active', b === e.target));
    planCfg.partsMode = e.target.dataset.v;
    renderPartsChips();
    if (!isTodayCompleted()) resetPlanToPreview();
  });
  $('#genPlanBtn').addEventListener('click', () => {
    if (planCfg.partsMode === 'manual' && !planCfg.parts.length) { toast('请先选择训练部位，或切到 AI 推荐'); return; }
    const profile = Store.getProfile() || {};
    const dur = computeDuration();
    const env = planCfg.env;
    const regions = currentRegions();
    const plan = AI.generatePlan({ durationMin: dur, env, profile, completedDays: Store.countDays(), concernRegions: profile.concernAreas || [], regions });
    commitPlan(plan, { durationMin: dur, env });
    toast('已生成 ' + plan.length + ' 个动作的今日计划');
  });

  /* ================= 跟练计时器 ================= */
  let wo = null;
  function rand(a, b) { return Math.floor(a + Math.random() * (b - a + 1)); }

  /* 内置语音包（离线 mp3，不调用系统 TTS；仅在语音包缺失时兜底系统语音） */
  let speechOn = true;            // #woSound 静音开关
  let ttsManifest = null;         // { clipId: 'file.mp3', ... }
  let ttsLoaded = false;
  let ttsToken = 0;               // 每次 stopSpeech 自增，用于中断正在播放的队列
  let ttsAudio = null;            // 当前正在播放的 Audio 元素
  const TTS_BASE = 'vendor/tts/';

  function loadTts() {
    if (ttsLoaded) return Promise.resolve();
    ttsLoaded = true;
    return fetch(TTS_BASE + 'manifest.json')
      .then(r => (r && r.ok ? r.json() : null))
      .then(m => { ttsManifest = m && Object.keys(m).length ? m : null; })
      .catch(() => { ttsManifest = null; });
  }
  function ttsUrl(id) {
    if (!ttsManifest || !ttsManifest[id]) return null;
    return TTS_BASE + ttsManifest[id];
  }
  function playClip(url, gap) {
    return new Promise(res => {
      const my = ttsToken;
      if (ttsAudio) { try { ttsAudio.pause(); } catch (e) {} ttsAudio = null; } // 先停掉上一条仍在播放的音频，杜绝重叠
      const a = new Audio(url);
      a.preload = 'auto';
      ttsAudio = a;
      const done = () => { if (ttsAudio === a) ttsAudio = null; if (my !== ttsToken) return res(); setTimeout(res, gap || 150); };
      a.onended = done;
      a.onerror = () => { if (ttsAudio === a) ttsAudio = null; res(); };
      a.play().catch(() => { if (ttsAudio === a) ttsAudio = null; res(); });
    });
  }
  async function playClips(ids) {
    const my = ttsToken;
    for (const id of ids) {
      if (my !== ttsToken) return;            // 已被 stopSpeech 中断
      const u = ttsUrl(id);
      if (u) await playClip(u);
    }
  }
  // 优先播内置语音包；语音包整包缺失（CI 生成失败）时才兜底系统 TTS
  function announce(ids, fallbackText) {
    if (!speechOn) return;
    if (ttsManifest) {
      stopSpeech();          // 先停掉当前正在播放的语音（含上一条），避免与下一条重叠
      playClips(ids);
      return;
    }
    // 兜底：系统语音（仅当内置包不可用时）
    if (!('speechSynthesis' in window) || !fallbackText) return;
    try {
      window.speechSynthesis.cancel();
      setTimeout(() => {
        if (!speechOn || !('speechSynthesis' in window)) return;
        try { const u = new SpeechSynthesisUtterance(fallbackText); u.lang = 'zh-CN'; u.volume = 1; window.speechSynthesis.speak(u); } catch (e) {}
      }, 60);
    } catch (e) {}
  }
  function stopSpeech() {
    ttsToken++;                              // 让进行中的 playClips 队列立即退出
    if (ttsAudio) { try { ttsAudio.pause(); } catch (e) {} ttsAudio = null; }
    try { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); } catch (e) {}
  }

  const COACH = {
    warmup: '活动关节、升高体温，让身体进入训练状态，呼吸均匀。',
    work: '保持动作标准、控制节奏；发力时呼气，还原时吸气，感受目标肌群收缩。',
    rest: '组间短暂休息，喝口水、调整呼吸，为下一组做好准备。',
    cooldown: '放慢节奏，充分拉伸刚才训练的肌群，帮助恢复、缓解酸痛。',
  };

  function startWorkout() {
    const plan = getActivePlan();
    if (!plan || !plan.length) { toast('请先生成今日计划'); return; }
    const old = $('#workoutModal .wo-summary'); if (old) old.remove();
    stopTimer();                // 防止上一次会话遗留的定时器继续走
    stopSpeech();
    wo = { i: 0, j: 1, phase: 'work', remaining: plan[0].secs, total: plan[0].secs,
      running: false, timer: null, plan, meta: plan._meta || { durationMin: 30, env: 'gym' } };
    openModal('workoutModal');
    loadTts();                        // 确保内置语音包 manifest 已就绪
    setPhase('work', plan[0].secs);   // 进入第一组，由 setPhase 统一播报（含开场提示），避免重复触发被吞
  }
  function startTimer() {
    stopTimer();                // 永远只保留一个活动定时器
    if (wo) wo.timer = setInterval(woTick, 1000);
  }
  function stopTimer() {
    if (wo && wo.timer) { clearInterval(wo.timer); wo.timer = null; }
  }
  function curItem() { return wo.plan[wo.i]; }
  function setPhase(phase, secs) {
    wo.phase = phase; wo.remaining = secs; wo.total = secs;
    if (phase === 'work') {
      const it = curItem();
      const isLastSet = (wo.i === wo.plan.length - 1 && wo.j === it.sets);
      const ids = [];
      let fb = '';
      if (it.kind === 'warmup') { ids.push('warmup_start'); fb = '热身开始，活动开关节。'; }
      else if (it.kind === 'cooldown') { ids.push('cooldown_start'); fb = '拉伸放松开始，慢慢来。'; }
      else {
        if (wo.i === 0 && wo.j === 1) ids.push('train_start');
        ids.push('set_start_' + wo.j);
        if (it.id) ids.push('cue_' + it.id);
        fb = (wo.i === 0 && wo.j === 1 ? '训练开始，' : isLastSet ? '最后一组，' : '') + '第 ' + wo.j + ' 组，开始。' + (it.core || '');
      }
      announce(ids, fb);
    } else if (phase === 'rest') {
      announce(['rest_' + secs], '休息 ' + secs + ' 秒，调整呼吸，准备下一组。');
    }
    updateWorkoutUI();
  }
  // 间歇休息时长：高强度动作 60~90 秒，低强度 30~45 秒（优先用计划生成时算好的 restSecs）
  function restSecondsFor(item) {
    if (item.restSecs) return item.restSecs;
    return item.intensity === 'high' ? rand(60, 90) : rand(30, 45);
  }
  function advance() {
    const item = curItem();
    if (wo.phase === 'work') {
      if (wo.j < item.sets) { wo.j++; setPhase('rest', restSecondsFor(item)); }
      else {
        const isLast = (wo.i === wo.plan.length - 1);
        if (isLast) announce(['finish_encourage'], '最后一组完成，太棒了！坚持就是胜利！');
        wo.i++;
        if (wo.i >= wo.plan.length) { finishWorkout(); return; }
        wo.j = 1; setPhase('work', curItem().secs);
      }
    } else { // rest -> next work set
      setPhase('work', curItem().secs);
    }
  }
  function woTick() {
    wo.remaining--;
    if (wo.phase === 'rest' && wo.remaining > 0 && wo.remaining <= 3) announce(['count_' + wo.remaining], String(wo.remaining));
    if (wo.remaining <= 0) advance();
    else updateWorkoutUI();
  }
  function updateWorkoutUI() {
    const item = curItem();
    if (!item) return;
    const phaseLabel = wo.phase === 'warmup' ? '热身' : wo.phase === 'cooldown' ? '放松' : wo.phase === 'rest' ? '休息' : '训练';
    $('#woPhase').textContent = phaseLabel + ' · 第 ' + (wo.i + 1) + '/' + wo.plan.length + ' 个动作';
    // 当前动作演示图（按动作匹配）
    const media = $('#woMedia');
    if (media) {
      const src = gifUrl(item.gif);
      if (media.getAttribute('src') !== src) media.setAttribute('src', src);
      media.onerror = () => { media.style.visibility = 'hidden'; };
      media.style.visibility = 'visible';
    }
    const setInfo = $('#woSetInfo');
    if (setInfo) {
      if (wo.phase === 'work') setInfo.textContent = '第 ' + wo.j + '/' + item.sets + ' 组 · ' + item.reps;
      else if (wo.phase === 'rest') setInfo.textContent = '组间休息 · 下一组 ' + (wo.j + 1) + '/' + item.sets;
      else setInfo.textContent = item.region + ' · ' + item.equipment;
    }
    $('#woExercise').textContent = item.zh || item.name;
    $('#woCoach').textContent = COACH[wo.phase] || '';
    $('#woTime').textContent = fmtTime(Math.max(0, wo.remaining));
    const pct = wo.total ? Math.max(0, Math.min(100, (wo.remaining / wo.total) * 100)) : 0;
    const bar = $('#woBar'); if (bar) bar.style.width = pct + '%';
    $('#woToggle').textContent = wo.running ? '暂停' : '开始';
  }
  $('#woToggle').addEventListener('click', () => {
    if (!wo) return;
    wo.running = !wo.running;
    if (wo.running) { startTimer(); }
    else { stopTimer(); stopSpeech(); }   // 暂停：停止唯一的活动定时器并停止语音
    updateWorkoutUI();
  });
  $('#woSkip').addEventListener('click', () => { if (wo) advance(); });
  $('#woSound').addEventListener('click', () => {
    speechOn = !speechOn;
    const b = $('#woSound'); if (b) b.textContent = speechOn ? '🔊' : '🔇';
    if (!speechOn) stopSpeech();
  });
  function finishWorkout() {
    stopTimer();
    // 注意：不调用 stopSpeech()，让刚 announce 的「最后一组完成，太棒了」鼓励语音播完再停
    Store.clearDraft(Store.todayStr());   // 已打卡，清掉未完成的草稿
    const meta = wo.meta;
    const profile = Store.getProfile() || {};
    const calories = AI.estimateCalories(meta.durationMin, profile, meta.env);
    const regions = Array.from(new Set(wo.plan.map(p => p.region)));
    const rec = {
      date: Store.todayStr(), completed: true, durationMin: meta.durationMin, env: meta.env,
      calories, regionsTrained: regions,
      plan: wo.plan.map(p => ({ id: p.id, name: p.name, zh: p.zh, gif: p.gif, region: p.region, equipment: p.equipment, sets: p.sets, reps: p.reps })),
      createdAt: new Date().toISOString(),
    };
    Store.saveDay(rec.date, rec);
    // summary overlay (keeps timer UI intact for re-open)
    const ov = document.createElement('div');
    ov.className = 'wo-summary';
    ov.innerHTML = `
      <div class="wo-phase">训练完成 🎉</div>
      <div style="font-size:40px;margin:10px 0">💪</div>
      <div class="wo-exercise">今日打卡成功</div>
      <div class="wo-coach">时长 ${rec.durationMin} 分钟 · 消耗约 <b style="color:var(--accent)">${calories} kcal</b><br>
      完成 ${rec.plan.length} 个动作，覆盖 ${regions.length} 个部位</div>
      <button class="primary-btn" id="woDone" style="margin-top:16px">完成</button>`;
    $('#workoutModal .modal').appendChild(ov);
    ov.querySelector('#woDone').addEventListener('click', () => { closeModal('workoutModal'); renderPlan(); });
  }

  /* ================= 动作详情 ================= */
  function showExercise(ex) {
    $('#exMedia').innerHTML = `<img src="${gifUrl(ex.gif)}" alt="${ex.zh || ex.name}" onerror="this.style.display='none'">`;
    $('#exName').textContent = (ex.zh || ex.name) + (ex.zh && ex.name ? '  /  ' + ex.name : '');
    $('#exMeta').innerHTML = [ex.region, ex.equipment, '目标: ' + (ex.target || '-')]
      .map(m => `<span class="m">${m}</span>`).join('');
    $('#exDesc').textContent = ex.desc || '暂无文字说明。';
    $('#exSteps').innerHTML = (ex.steps && ex.steps.length)
      ? ex.steps.map(s => `<li>${s}</li>`).join('')
      : '<li>跟随演示动画完成标准动作即可。</li>';
    openModal('exerciseModal');
  }

  /* ================= 本月进度 ================= */
  function renderProgress() {
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth();
    const month = Store.getMonth(y, m);
    const days = Object.values(month).filter(d => d.completed);
    const totalCal = days.reduce((s, d) => s + (d.calories || 0), 0);

    $('#progressSummary').innerHTML = `
      <div class="card-title">${y} 年 ${m + 1} 月</div>
      <div style="display:flex;gap:14px">
        <div style="flex:1"><div style="font-size:26px;font-weight:800;color:var(--accent)">${days.length}</div><div class="pi-meta">打卡天数</div></div>
        <div style="flex:1"><div style="font-size:26px;font-weight:800">${totalCal}</div><div class="pi-meta">累计消耗 kcal</div></div>
        <div style="flex:1"><div style="font-size:26px;font-weight:800">${days.reduce((s,d)=>s+d.plan.length,0)}</div><div class="pi-meta">完成动作</div></div>
      </div>`;

    // calendar
    const first = new Date(y, m, 1).getDay();
    const dim = new Date(y, m + 1, 0).getDate();
    let cal = '<div class="cal-dow">日</div><div class="cal-dow">一</div><div class="cal-dow">二</div><div class="cal-dow">三</div><div class="cal-dow">四</div><div class="cal-dow">五</div><div class="cal-dow">六</div>';
    for (let i = 0; i < first; i++) cal += '<div class="cal-cell dim"></div>';
    const today = Store.todayStr();
    for (let d = 1; d <= dim; d++) {
      const ds = y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      const done = month[ds] && month[ds].completed;
      const isToday = ds === today;
      cal += `<div class="cal-cell ${done ? 'done' : ''} ${isToday ? 'today' : ''}" data-date="${ds}">${d}</div>`;
    }
    $('#calendar').innerHTML = cal;
    $('#dayDetail').textContent = '点击某天查看详情';
    $$('#calendar .cal-cell[data-date]').forEach(c => c.addEventListener('click', () => {
      const rec = month[c.dataset.date];
      if (rec && rec.completed) {
        $('#dayDetail').innerHTML = `<b>${c.dataset.date}</b> · ${rec.durationMin} 分钟 · 约 ${rec.calories} kcal · ${rec.plan.length} 个动作（${rec.regionsTrained.join('、')}）`;
      } else {
        $('#dayDetail').textContent = c.dataset.date + '：未打卡';
      }
    }));

    // part stats
    const cnt = {};
    days.forEach(d => (d.regionsTrained || []).forEach(r => cnt[r] = (cnt[r] || 0) + 1));
    const max = Math.max(1, ...Object.values(cnt));
    const rows = Object.keys(cnt).length
      ? Object.keys(cnt).map(r => `<div class="stat-row"><div class="sr-name">${r}</div><div class="stat-bar"><i style="width:${cnt[r] / max * 100}%"></i></div><div class="sr-num">${cnt[r]}</div></div>`).join('')
      : '<div class="empty">本月还没有打卡记录</div>';
    $('#partStats').innerHTML = rows;

    // monthly summary
    const total = Store.countDays();
    let summary;
    if (!days.length) summary = '本月尚未打卡。从「每日计划」生成今天的训练，坚持下来就能在这里看到你的进步。';
    else {
      const top = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0];
      summary = `本月已打卡 <b>${days.length}</b> 天，累计消耗约 <b>${totalCal} kcal</b>，最受欢迎的部位是 <b>${top}</b>。` +
        (days.length < 12 ? ` 距离「每月 12 天」的达标线还差 <b>${12 - days.length}</b> 天，继续保持！` : ` 已达成月度打卡目标，状态在线 💪`);
    }
    $('#monthSummary').innerHTML = summary;
  }

  /* ================= 动作指导 ================= */
  const REGIONS = ['全部', '胸部', '背部', '肩部', '手臂', '腿部', '核心/腰腹', '有氧', '颈部'];
  function renderGuide() {
    const chips = REGIONS.map(r => `<div class="chip ${r === guideState.region ? 'active' : ''}" data-r="${r}">${r}</div>`).join('');
    $('#regionChips').innerHTML = chips;
    $$('#regionChips .chip').forEach(c => c.addEventListener('click', () => {
      guideState.region = c.dataset.r; guideState.offset = 0;
      renderGuide();
    }));
    renderGuideGrid();
  }
  function renderGuideGrid() {
    let list = EXERCISES;
    if (guideState.region !== '全部') list = list.filter(e => e.region === guideState.region);
    if (guideState.query) list = AI.search(guideState.query, 999);
    else if (guideState.region !== '全部') list = list.filter(e => e.region === guideState.region);
    const slice = list.slice(guideState.offset, guideState.offset + 60);
    const grid = $('#guideGrid');
    if (!slice.length) { grid.innerHTML = '<div class="empty">没有匹配的动作</div>'; $('#loadMoreGuide').hidden = true; return; }
    const html = slice.map(e => `
      <div class="guide-card" data-id="${e.id}">
        <img loading="lazy" src="${gifUrl(e.gif)}" alt="${e.zh || e.name}" onerror="this.style.visibility='hidden'">
        <div class="gc-name">${e.zh || e.name}</div>
        <div class="gc-eq">${e.equipment}</div>
      </div>`).join('');
    grid.innerHTML = (guideState.offset === 0 ? '' : grid.innerHTML) + html;
    $$('#guideGrid .guide-card').forEach(c => c.addEventListener('click', () => {
      const ex = AI.byId(c.dataset.id); if (ex) showExercise(ex);
    }));
    $('#loadMoreGuide').hidden = guideState.offset + 60 >= list.length;
  }

  const searchInput = $('#guideSearch');
  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim();
    guideState.query = q; guideState.offset = 0;
    const box = $('#suggestBox');
    if (!q) { box.classList.remove('show'); box.innerHTML = ''; renderGuideGrid(); return; }
    const sug = AI.search(q, 8);
    if (sug.length) {
      box.innerHTML = sug.map(e => `<div class="suggest-item" data-id="${e.id}"><span>${e.zh || e.name}</span><span class="si-en">${e.region}·${e.equipment}</span></div>`).join('');
      box.classList.add('show');
      $$('#suggestBox .suggest-item').forEach(s => s.addEventListener('click', () => {
        const ex = AI.byId(s.dataset.id);
        box.classList.remove('show');
        if (ex) showExercise(ex);
      }));
    } else { box.classList.remove('show'); box.innerHTML = ''; }
    renderGuideGrid();
  });
  searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') $('#suggestBox').classList.remove('show'); });
  $('#loadMoreGuide').addEventListener('click', () => { guideState.offset += 60; renderGuideGrid(); });

  /* ================= 身体情况 ================= */
  function renderBody() {
    const p = Store.getProfile() || {};
    $('#inpWeight').value = p.weight || '';
    $('#inpHeight').value = p.height || '';
    const v = document.querySelector('meta[name="app-version"]');
    if (v && $('#appVersion')) $('#appVersion').textContent = '版本 v' + (v.content || '1.0');
    renderBodyAnalysis();
    renderPhotos();
    renderConcern();
  }
  $('#saveBodyBtn').addEventListener('click', () => {
    const w = parseFloat($('#inpWeight').value), h = parseFloat($('#inpHeight').value);
    if (!w || !h) { toast('请填写体重和身高'); return; }
    const p = Store.getProfile() || {};
    p.weight = w; p.height = h;
    const ana = AI.analyzeBody(p);
    if (ana) p.goal = ana.goal;
    Store.setProfile(p);
    renderBodyAnalysis();
    toast('已保存并分析，建议目标：' + (ana ? ana.goal : '—'));
  });
  function renderBodyAnalysis() {
    const p = Store.getProfile() || {};
    const ana = AI.analyzeBody(p);
    const box = $('#bodyAnalysis');
    if (!ana) { box.innerHTML = '<span style="color:var(--text-dim)">填写体重身高后，自动分析适合的目标。</span>'; return; }
    box.innerHTML = `BMI <span class="tag">${ana.bmi}</span> <span class="tag">${ana.category}</span> 建议目标 <span class="tag">${ana.goal}</span><br>${ana.tip}`;
  }
  $('#addPhotoBtn').addEventListener('click', () => $('#photoInput').click());
  $('#photoInput').addEventListener('change', e => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const max = 480, scale = Math.min(1, max / Math.max(img.width, img.height));
        const cv = document.createElement('canvas');
        cv.width = img.width * scale; cv.height = img.height * scale;
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        const data = cv.toDataURL('image/jpeg', 0.7);
        const p = Store.getProfile() || {}; p.photos = (p.photos || []).slice(0, 2); p.photos.push(data);
        Store.setProfile(p); renderPhotos();
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  });
  function renderPhotos() {
    const p = Store.getProfile() || {};
    const box = $('#photoList');
    box.innerHTML = (p.photos || []).map((src, i) => `<img class="photo-thumb" src="${src}" data-i="${i}">`).join('');
    $$('#photoList .photo-thumb').forEach(im => im.addEventListener('click', () => {
      const p2 = Store.getProfile() || {}; p2.photos.splice(+im.dataset.i, 1); Store.setProfile(p2); renderPhotos();
    }));
    const ab = $('#analyzePhotoBtn'); if (ab) ab.disabled = !(p.photos && p.photos.length);
  }
  const CONCERN = ['胸部', '背部', '肩部', '手臂', '腿部', '核心/腰腹', '有氧'];
  function renderConcern() {
    const p = Store.getProfile() || {};
    const ca = p.concernAreas || [];
    $('#concernChips').innerHTML = CONCERN.map(r => `<div class="chip ${ca.includes(r) ? 'active' : ''}" data-r="${r}">${r}</div>`).join('');
    $$('#concernChips .chip').forEach(c => c.addEventListener('click', () => {
      const p2 = Store.getProfile() || {}; const set = new Set(p2.concernAreas || []);
      set.has(c.dataset.r) ? set.delete(c.dataset.r) : set.add(c.dataset.r);
      p2.concernAreas = Array.from(set); Store.setProfile(p2); renderConcern();
    }));
    $('#concernAdvice').innerHTML = AI.concernAdvice(p);
  }

  /* ============ 照片 AI 姿态分析（本地 TensorFlow.js + MoveNet） ============ */
  // 在手机端本地运行姿态模型，检测人体关键点/对称性，启发式推断需加强部位。照片不出设备。
  let _detector = null, _tfLoading = null;
  // 本地打包的库/模型（CI 已随 APK 一起打包，运行时无外网依赖，国内不会被墙）
  function loadLocal(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => res();
      s.onerror = () => rej(new Error('本地模型库缺失，请更新到最新版 APK'));
      document.head.appendChild(s);
    });
  }
  async function ensurePoseDetector() {
    if (_detector) return _detector;
    if (_tfLoading) return _tfLoading;
    _tfLoading = (async () => {
      if (typeof tf === 'undefined') await loadLocal('vendor/tf.min.js');
      if (typeof poseDetection === 'undefined') await loadLocal('vendor/pose-detection.min.js');
      if (typeof tf === 'undefined' || typeof poseDetection === 'undefined') {
        throw new Error('本地模型库未正确打包，请更新到最新版 APK');
      }
      await tf.ready();
      try { await tf.setBackend('webgl'); }
      catch (e) { try { await tf.setBackend('cpu'); } catch (e2) {} }
      // modelType 必须是完整枚举值；pose-detection 的 validateModelConfig 仅接受
      // 'SinglePose.Lightning' / 'SinglePose.Thunder' / 'MultiPose.Lightning'，
      // 之前用 'Lightning' 会抛 "Invalid architecture Lightning"。
      _detector = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, {
        modelType: poseDetection.movenetModelType ? poseDetection.movenetModelType.LIGHTNING : 'SinglePose.Lightning',
        modelUrl: 'vendor/movenet/model.json'
      });
      return _detector;
    })();
    return _tfLoading;
  }
  const KP_INDEX = { nose:0, left_eye:1, right_eye:2, left_ear:3, right_ear:4, left_shoulder:5, right_shoulder:6, left_elbow:7, right_elbow:8, left_wrist:9, right_wrist:10, left_hip:11, right_hip:12, left_knee:13, right_knee:14, left_ankle:15, right_ankle:16 };
  const REGION_KEYS = {
    '肩部': ['left_shoulder', 'right_shoulder'],
    '手臂': ['left_elbow', 'right_elbow', 'left_wrist', 'right_wrist'],
    '腿部': ['left_hip', 'right_hip', 'left_knee', 'right_knee', 'left_ankle', 'right_ankle'],
    '核心/腰腹': ['left_hip', 'right_hip'],
    '胸部': ['left_shoulder', 'right_shoulder', 'left_hip', 'right_hip'],
    '颈部': ['left_ear', 'right_ear', 'left_shoulder', 'right_shoulder'],
  };
  const SKELETON = [[5,6],[5,7],[7,9],[6,8],[8,10],[5,11],[6,12],[11,12],[11,13],[13,15],[12,14],[14,16]];
  function kpByName(kps, name) { return (kps.find(k => k.name === name)) || kps[KP_INDEX[name]]; }
  function regionVisibility(kps, keys) {
    const pts = keys.map(n => kpByName(kps, n)).filter(p => p && p.score > 0.3);
    if (!pts.length) return 0;
    return pts.reduce((s, p) => s + p.score, 0) / pts.length;
  }
  function normAsym(kps, a, b, imgH) {
    const pa = kpByName(kps, a), pb = kpByName(kps, b);
    if (!pa || !pb || pa.score < 0.3 || pb.score < 0.3 || !imgH) return 0;
    return Math.abs(pa.y - pb.y) / imgH;
  }
  function computeNeeds(kps, imgH) {
    const shAsym = normAsym(kps, 'left_shoulder', 'right_shoulder', imgH);
    const hipAsym = normAsym(kps, 'left_hip', 'right_hip', imgH);
    const out = [];
    for (const rg in REGION_KEYS) {
      const vis = regionVisibility(kps, REGION_KEYS[rg]);
      let pen = 0;
      if (rg === '肩部') pen = Math.min(1, shAsym / 0.06);
      if (rg === '核心/腰腹' || rg === '腿部') pen = Math.min(1, hipAsym / 0.06);
      const health = 0.65 * vis + 0.35 * (1 - pen);
      out.push({ rg, need: 1 - health, vis, pen });
    }
    out.sort((a, b) => b.need - a.need);
    return out;
  }
  function drawSkeleton(img, kps) {
    const W = 240, scale = W / img.width, H = img.height * scale;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    ctx.drawImage(img, 0, 0, W, H);
    ctx.strokeStyle = 'rgba(18,183,106,0.9)'; ctx.lineWidth = 2;
    SKELETON.forEach(([a, b]) => {
      const pa = kps[a], pb = kps[b];
      if (pa && pb && pa.score > 0.3 && pb.score > 0.3) {
        ctx.beginPath(); ctx.moveTo(pa.x * scale, pa.y * scale); ctx.lineTo(pb.x * scale, pb.y * scale); ctx.stroke();
      }
    });
    ctx.fillStyle = '#0ba5ec';
    kps.forEach(k => { if (k.score > 0.3) { ctx.beginPath(); ctx.arc(k.x * scale, k.y * scale, 3, 0, 7); ctx.fill(); } });
    return cv;
  }
  function renderPhotoAnalysis(box, imgData, need, sugg) {
    const tags = sugg.map(r => `<span class="tag">${r}</span>`).join('');
    const reasons = need.slice(0, 3).map(x => {
      const why = x.pen > 0.3 ? '姿态不对称' : (x.vis < 0.5 ? '该部位识别度偏低' : '综合评分偏低');
      return `${x.rg}（${why}）`;
    }).join('、');
    box.innerHTML = `
      <div class="ph-analysis">
        <img src="${imgData}" class="ph-skeleton" alt="姿态分析">
        <div class="ph-result">
          <div class="ph-title">✨ 建议重点加强</div>
          <div class="ph-tags">${tags}</div>
          <div class="ph-reason">依据：${reasons}。这是基于姿态/对称性的本地启发式评估，非医学体脂分析。</div>
          <button id="applyAnalysisBtn" class="ghost-btn" style="margin-top:8px">应用到每日计划</button>
        </div>
      </div>`;
    $('#applyAnalysisBtn').addEventListener('click', () => {
      const p = Store.getProfile() || {};
      p.concernAreas = Array.from(new Set([...(p.concernAreas || []), ...sugg]));
      Store.setProfile(p); renderConcern();
      toast('已把建议部位加入「每日计划」重点');
    });
  }
  async function analyzePhoto() {
    const p = Store.getProfile() || {};
    if (!p.photos || !p.photos.length) { toast('请先上传一张照片'); return; }
    const btn = $('#analyzePhotoBtn'), box = $('#photoAnalysis');
    btn.disabled = true; btn.textContent = '分析中…';
    box.innerHTML = '<span style="color:var(--text-dim)">正在用本地 AI 模型分析姿态，请稍候…</span>';
    try {
      const detector = await ensurePoseDetector();
      const dataUrl = p.photos[p.photos.length - 1];
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = dataUrl; });
      const poses = await detector.estimatePoses(img);
      if (!poses.length) {
        box.innerHTML = '<span style="color:#b45309">未检测到清晰人体，请换一张全身/半身清晰的照片，或手动勾选下方部位。</span>';
        return;
      }
      const kps = poses[0].keypoints;
      const need = computeNeeds(kps, img.height);
      const sugg = need.slice(0, 3).map(x => x.rg);
      const canvas = drawSkeleton(img, kps);
      renderPhotoAnalysis(box, canvas.toDataURL('image/jpeg', 0.7), need, sugg);
    } catch (e) {
      box.innerHTML = '<span style="color:#dc2626">分析失败：' + (e && e.message ? e.message : e) + '。可手动勾选下方部位。</span>';
    } finally {
      btn.disabled = false; btn.textContent = '✨ 智能分析需加强的部位';
    }
  }
  $('#analyzePhotoBtn').addEventListener('click', analyzePhoto);

  /* ---------- boot ---------- */
  fetch('data/exercises.min.json')
    .then(r => r.json())
    .then(data => {
      EXERCISES = data; AI.setData(data);
      initTheme(); renderPlan(); maybeQuote();
    })
    .catch(err => {
      document.querySelector('.pages').innerHTML = '<div class="empty">数据加载失败，请通过本地服务器打开（不要用 file:// 直接打开）。</div>';
      console.error(err);
    });
})();
