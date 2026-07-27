/* On-device "AI" heuristics driven by the exercise dataset + user stats.
   Fully offline — no network, no API keys. */
const AI = (function () {
  let DATA = [];

  function setData(d) { DATA = d; }
  function byId(id) { return DATA.find(e => e.id === id); }
  function byRegion(region) { return DATA.filter(e => e.region === region); }

  // 场景严格白名单：动作匹配按环境区分
  // 健身房：全部器械开放
  // 居家：仅哑铃 + 徒手/垫上（不含任何健身房器械）
  // 户外：仅徒手 + 单杠/双杠（数据集统一标记为 body weight，不含哑铃与器械）
  const ENV_EQUIPMENT = {
    gym: null,
    home: ['dumbbell', 'body weight'],
    outdoor: ['body weight'],
  };
  function equipmentAllowed(equipment, env) {
    const allow = ENV_EQUIPMENT[env];
    if (!allow) return true; // gym: 全部允许
    const eq = (equipment || '').trim().toLowerCase();
    return allow.includes(eq);
  }

  function suggestDuration(profile) {
    const goal = profile && profile.goal;
    if (goal === '增肌') return 50;
    if (goal === '减脂') return 35;
    if (goal === '维持') return 30;
    return 40;
  }

  // rotating training splits so consecutive days vary
  const SPLITS = [
    ['胸部', '背部'],
    ['腿部', '核心/腰腹'],
    ['肩部', '手臂'],
    ['背部', '腿部'],
    ['胸部', '肩部', '手臂'],
    ['核心/腰腹', '腿部'],
  ];
  function pickSplit(completedDays, concernRegions) {
    let base = SPLITS[completedDays % SPLITS.length];
    if (concernRegions && concernRegions.length) {
      const hit = SPLITS.find(s => s.some(r => concernRegions.includes(r)));
      if (hit) base = hit;
    }
    return base;
  }
  function repsScheme(goal) {
    if (goal === '增肌') return { sets: 4, reps: '8-12 次' };
    if (goal === '减脂') return { sets: 3, reps: '12-15 次' };
    if (goal === '维持') return { sets: 3, reps: '10-12 次' };
    return { sets: 3, reps: '10 次' };
  }
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function makeItem(ex, sets, reps, env, secs, kind) {
    return { id: ex.id, name: ex.name, zh: ex.zh, gif: ex.gif, region: ex.region,
      equipment: ex.equipment, sets, reps, secs, kind };
  }

  function generatePlan(opts) {
    const { durationMin, env, profile, completedDays, concernRegions, regions: explicit } = opts;
    // 自选部位优先；否则由 AI 根据打卡进度与身体重点智能搭配
    const regions = (explicit && explicit.length) ? explicit : pickSplit(completedDays || 0, concernRegions);
    const scheme = repsScheme(profile && profile.goal);
    const dur = Math.max(10, durationMin || 30);

    // 统计主训练动作数量，用于把总时长合理分配到每个动作
    let mainCount = 0;
    regions.forEach(rg => {
      const pool = byRegion(rg).filter(e => equipmentAllowed(e.equipment, env));
      if (pool.length) mainCount += (rg === '腿部' || rg === '背部') ? 2 : 1;
    });
    const mainSecs = mainCount ? Math.round(dur * 60 * 0.72 / mainCount) : 50;

    let plan = [];

    // 热身：居家/户外优先徒手有氧，健身房可用任意有氧器械
    const wu = (env === 'gym'
      ? DATA.find(e => e.region === '有氧')
      : DATA.find(e => e.region === '有氧' && e.equipment === 'body weight'))
      || DATA.find(e => e.equipment === 'body weight');
    if (wu) plan.push(makeItem(wu, 1, '动态热身', env, Math.min(240, Math.round(dur * 7.2) || 180), 'warmup'));

    regions.forEach(rg => {
      const pool = shuffle(byRegion(rg).filter(e => equipmentAllowed(e.equipment, env)));
      if (!pool.length) return;
      const n = (rg === '腿部' || rg === '背部') ? 2 : 1;
      pool.slice(0, n).forEach(ex => plan.push(makeItem(ex, scheme.sets, scheme.reps, env, mainSecs, 'main')));
    });

    // 放松：优先拉伸本次训练的部位（徒手），让"选什么部位就见什么部位"，否则退化为通用徒手拉伸
    let cd = null;
    if (regions && regions.length) {
      const cdPool = DATA.filter(e => regions.includes(e.region) && e.equipment === 'body weight');
      if (cdPool.length) cd = cdPool[Math.floor(Math.random() * cdPool.length)];
    }
    if (!cd) cd = DATA.find(e => e.region === '核心/腰腹' && e.equipment === 'body weight')
      || DATA.find(e => e.equipment === 'body weight' && e.region !== '有氧');
    if (cd && !plan.find(p => p.id === cd.id)) plan.push(makeItem(cd, 1, '拉伸放松', env, 180, 'cooldown'));

    return plan;
  }

  function estimateCalories(durationMin, profile, env) {
    const w = (profile && profile.weight) || 65;
    const met = env === 'gym' ? 6.0 : env === 'home' ? 5.5 : 7.0;
    return Math.round(met * w * (durationMin / 60));
  }

  function analyzeBody(profile) {
    const h = (profile && profile.height) || 0, w = (profile && profile.weight) || 0;
    if (!h || !w) return null;
    const bmi = w / Math.pow(h / 100, 2);
    let category, goal;
    if (bmi < 18.5) { category = '偏瘦'; goal = '增肌'; }
    else if (bmi < 24) { category = '正常'; goal = '维持'; }
    else if (bmi < 28) { category = '偏重'; goal = '减脂'; }
    else { category = '肥胖'; goal = '减脂'; }
    const tips = {
      '增肌': '建议以力量训练为主（每组 8-12 次），保证蛋白质摄入与休息，循序渐进增加负荷。',
      '减脂': '建议以中等强度有氧 + 循环训练为主，控制热量缺口，保留力量训练防止肌肉流失。',
      '维持': '建议力量与有氧结合（约 1:1），保持规律训练与均衡饮食即可。',
    };
    return { bmi: +bmi.toFixed(1), category, goal, tip: tips[goal] };
  }

  function concernAdvice(profile) {
    const ca = (profile && profile.concernAreas) || [];
    if (!ca.length) return '尚未标记重点部位。可在下方勾选你想加强的区域，「每日计划」会优先安排对应训练。';
    const tags = ca.map(r => `<span class="tag">${r}</span>`).join('');
    return `已记录重点部位：${tags} 后续「每日计划」将优先安排这些部位的动作，建议每周至少 2 次针对性训练。`;
  }

  // muscle / action fuzzy search with alias mapping (联想 + 模糊)
  const ALIAS = {
    '肩': '肩部', '肩膀': '肩部', '肩中束': '肩部', '肩后束': '肩部', '中束': '肩部', '三角肌': '肩部',
    '胸': '胸部', '胸肌': '胸部', '卧推': '胸部',
    '背': '背部', '背阔肌': '背部', '引体': '背部',
    '腿': '腿部', '大腿': '腿部', '深蹲': '腿部', '臀': '腿部', '小腿': '腿部',
    '手臂': '手臂', '二头': '手臂', '三头': '手臂', '肱二': '手臂', '肱三': '手臂', '弯举': '手臂',
    '核心': '核心/腰腹', '腰': '核心/腰腹', '腹': '核心/腰腹', '腹肌': '核心/腰腹', '马甲线': '核心/腰腹',
    '有氧': '有氧', '心肺': '有氧', '颈': '颈部',
  };
  function search(query, limit) {
    const q = (query || '').trim().toLowerCase();
    if (!q) return [];
    let q2 = q;
    for (const k in ALIAS) { if (q.includes(k)) { q2 = ALIAS[k]; break; } }
    const scored = [];
    DATA.forEach(e => {
      const hay = (e.zh + ' ' + e.name + ' ' + e.target + ' ' + e.secondary.join(' ') + ' ' + e.region + ' ' + e.equipment).toLowerCase();
      let s = 0;
      if (e.zh && e.zh.toLowerCase().includes(q)) s += 10;
      if (e.region === q2) s += 6;
      if (e.region === q) s += 5;
      if (e.target === q2 || e.target.includes(q2)) s += 4;
      if (e.secondary.includes(q2)) s += 3;
      if (hay.includes(q)) s += 2;
      if (s > 0) scored.push({ e, s });
    });
    scored.sort((a, b) => b.s - a.s);
    return scored.slice(0, limit || 20).map(x => x.e);
  }

  return { setData, byId, generatePlan, estimateCalories, suggestDuration, analyzeBody, concernAdvice, search, equipmentAllowed };
})();
