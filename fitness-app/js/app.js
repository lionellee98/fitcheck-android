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
    renderPlanResult();
  }
  function envLabel(e) { return e === 'gym' ? '健身房' : e === 'home' ? '居家' : '室外体育场'; }

  function renderPlanResult() {
    const box = $('#planResult');
    if (!currentPlan || !currentPlan.length) { box.innerHTML = ''; return; }
    const items = currentPlan.map((p, i) => `
      <div class="plan-item" data-id="${p.id}">
        <div class="ord">${i + 1}</div>
        <img loading="lazy" src="${gifUrl(p.gif)}" alt="${p.zh || p.name}" onerror="this.style.visibility='hidden'">
        <div class="pi-info">
          <div class="pi-name">${p.zh || p.name}</div>
          <div class="pi-meta">${p.region} · ${p.equipment}</div>
        </div>
        <div class="pi-reps">${p.sets === 1 ? p.reps : p.sets + ' 组 × ' + p.reps}</div>
      </div>`).join('');
    box.innerHTML = `<div class="card-title">今日动作顺序</div>` + items +
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
      if (!isTodayCompleted()) { currentPlan = null; renderPlanPreview(); }
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
    const items = plan.map((p, i) => `
      <div class="plan-item" data-id="${p.id}">
        <div class="ord">${i + 1}</div>
        <img loading="lazy" src="${gifUrl(p.gif)}" alt="${p.zh || p.name}" onerror="this.style.visibility='hidden'">
        <div class="pi-info">
          <div class="pi-name">${p.zh || p.name}</div>
          <div class="pi-meta">${p.region} · ${p.equipment}</div>
        </div>
        <div class="pi-reps">${p.sets === 1 ? p.reps : p.sets + ' 组 × ' + p.reps}</div>
      </div>`).join('');
    box.innerHTML = head +
      `<div class="card-title preview-title">今日训练动作预览 · 共 ${plan.length} 个</div>` + items;
    $$('#planPreview .plan-item').forEach(el => el.addEventListener('click', () => {
      const ex = AI.byId(el.dataset.id); if (ex) showExercise(ex);
    }));
  }

  $('#durationSeg').addEventListener('click', e => {
    if (e.target.tagName !== 'BUTTON') return;
    $$('#durationSeg button').forEach(b => b.classList.toggle('active', b === e.target));
    planCfg.duration = e.target.dataset.v;
    if (planCfg.duration !== 'ai') $('#durationCustom').value = '';
    if (!isTodayCompleted()) { currentPlan = null; renderPlanPreview(); }
  });
  $('#durationCustom').addEventListener('input', e => {
    planCfg.custom = e.target.value;
    if (e.target.value) {
      $$('#durationSeg button').forEach(b => b.classList.remove('active'));
      if (!isTodayCompleted()) { currentPlan = null; renderPlanPreview(); }
    }
  });
  $('#envSeg').addEventListener('click', e => {
    if (e.target.tagName !== 'BUTTON') return;
    $$('#envSeg button').forEach(b => b.classList.toggle('active', b === e.target));
    planCfg.env = e.target.dataset.v;
    if (!isTodayCompleted()) { currentPlan = null; renderPlanPreview(); }
  });
  $('#partsModeSeg').addEventListener('click', e => {
    if (e.target.tagName !== 'BUTTON') return;
    $$('#partsModeSeg button').forEach(b => b.classList.toggle('active', b === e.target));
    planCfg.partsMode = e.target.dataset.v;
    renderPartsChips();
    if (!isTodayCompleted()) { currentPlan = null; renderPlanPreview(); }
  });
  $('#genPlanBtn').addEventListener('click', () => {
    if (planCfg.partsMode === 'manual' && !planCfg.parts.length) { toast('请先选择训练部位，或切到 AI 推荐'); return; }
    const profile = Store.getProfile() || {};
    const dur = computeDuration();
    const env = planCfg.env;
    const regions = currentRegions();
    currentPlan = AI.generatePlan({ durationMin: dur, env, profile, completedDays: Store.countDays(), concernRegions: profile.concernAreas || [], regions });
    currentPlan._meta = { durationMin: dur, env };
    $('#planPreview').innerHTML = '';   // 提交后隐藏实时预览，展示已锁定计划
    toast('已生成 ' + currentPlan.length + ' 个动作的今日计划');
    renderPlanResult();
  });

  /* ================= 跟练计时器 ================= */
  const REST = 20;
  let wo = null;
  const COACH = {
    warmup: '活动关节、升高体温，让身体进入训练状态，呼吸均匀。',
    work: '保持动作标准、控制节奏；发力时呼气，还原时吸气，感受目标肌群收缩。',
    rest: '组间短暂休息，喝口水、调整呼吸，为下一组做好准备。',
    cooldown: '放慢节奏，充分拉伸刚才训练的肌群，帮助恢复、缓解酸痛。',
  };

  function startWorkout() {
    if (!currentPlan || !currentPlan.length) { toast('请先生成今日计划'); return; }
    const old = $('#workoutModal .wo-summary'); if (old) old.remove();
    const plan = currentPlan;
    wo = { i: 0, j: 1, phase: 'work', remaining: plan[0].secs, total: plan[0].secs,
      running: false, timer: null, plan, meta: currentPlan._meta || { durationMin: 30, env: 'gym' } };
    updateWorkoutUI();
    openModal('workoutModal');
  }
  function curItem() { return wo.plan[wo.i]; }
  function setPhase(phase, secs) {
    wo.phase = phase; wo.remaining = secs; wo.total = secs;
    updateWorkoutUI();
  }
  function advance() {
    const item = curItem();
    if (wo.phase === 'work') {
      if (wo.j < item.sets) { wo.j++; setPhase('rest', REST); }
      else {
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
    if (wo.remaining <= 0) advance();
    else updateWorkoutUI();
  }
  function updateWorkoutUI() {
    const item = curItem();
    if (!item) return;
    const phaseLabel = wo.phase === 'warmup' ? '热身' : wo.phase === 'cooldown' ? '放松' : wo.phase === 'rest' ? '休息' : '训练';
    $('#woPhase').textContent = phaseLabel + ' · 第 ' + (wo.i + 1) + '/' + wo.plan.length + ' 个动作';
    $('#woExercise').textContent = item.zh || item.name;
    $('#woCoach').textContent = COACH[wo.phase] || '';
    $('#woTime').textContent = fmtTime(Math.max(0, wo.remaining));
    const C = 2 * Math.PI * 54;
    const off = wo.total ? C * (1 - wo.remaining / wo.total) : 0;
    $('#woRing').style.strokeDashoffset = off;
    $('#woToggle').textContent = wo.running ? '暂停' : '开始';
  }
  $('#woToggle').addEventListener('click', () => {
    wo.running = !wo.running;
    $('#woToggle').textContent = wo.running ? '暂停' : '开始';
    if (wo.running) wo.timer = setInterval(woTick, 1000);
    else clearInterval(wo.timer);
  });
  $('#woSkip').addEventListener('click', () => { if (wo) advance(); });
  function finishWorkout() {
    clearInterval(wo.timer);
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
