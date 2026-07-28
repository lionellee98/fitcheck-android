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
  function rand(a, b) { return Math.floor(a + Math.random() * (b - a + 1)); }
  // 动作强度：复合大重量（杠铃/史密斯/龙门架/腿/背）判为高强度，其余（徒手/孤立）为低强度
  function intensityOf(ex) {
    const eq = (ex.equipment || '').toLowerCase();
    if (['barbell', 'smith', 'cable', 'leverage machine'].includes(eq)) return 'high';
    if (['腿部', '背部'].includes(ex.region)) return 'high';
    return 'low';
  }
  function perRep(intensity) { return intensity === 'high' ? 4 : 3; } // 单个动作耗时（秒）
  function restFor(intensity) { return intensity === 'high' ? rand(60, 90) : rand(30, 45); }
  // 把 "8-12 次" 解析为数字（取上限 12），用于按 单次耗时×数量 估算该组时长
  function repsToNum(repsStr) {
    const nums = (repsStr || '').match(/\d+/g);
    if (!nums || !nums.length) return 0;
    return Math.max.apply(null, nums.map(Number));
  }
  function firstSentence(s) {
    const m = (s || '').split(/[。.!?！？]/)[0];
    return m ? m.trim() : '';
  }
  function makeItem(ex, sets, reps, env, secs, kind, restSecs) {
    const intensity = intensityOf(ex);
    return { id: ex.id, name: ex.name, zh: ex.zh, gif: ex.gif, region: ex.region,
      equipment: ex.equipment, sets, reps, secs, kind,
      intensity, restSecs: (restSecs != null ? restSecs : restFor(intensity)), core: firstSentence(ex.desc) };
  }

  function generatePlan(opts) {
    const { durationMin, env, profile, completedDays, concernRegions, regions: explicit } = opts;
    // 自选部位优先；否则由 AI 根据打卡进度与身体重点智能搭配
    const regions = (explicit && explicit.length) ? explicit : pickSplit(completedDays || 0, concernRegions);
    const scheme = repsScheme(profile && profile.goal);
    const B = Math.max(10, durationMin || 30) * 60;   // 总预算（秒）—— 所有动作(含热身/放松/组间休息)之和必须等于它

    // 热身 / 放松按总时长比例分配；运动时间短则相应缩短
    let warmup = Math.round(B * 0.08);
    let cooldown = Math.round(B * 0.07);

    // 主训练动作数量随总时长自适应：短时长自动减少动作数
    const pools = regions.map(rg => shuffle(byRegion(rg).filter(e => equipmentAllowed(e.equipment, env))));
    const avail = pools.reduce((s, p) => s + p.length, 0);
    let n;
    if (B >= 40 * 60) n = 5;
    else if (B >= 25 * 60) n = 3;
    else n = 2;
    n = Math.max(1, Math.min(n, avail, 6));

    // 收集主训练动作（轮询交替，保证覆盖所选部位）
    let mains = [];
    let added = true;
    while (added && mains.length < n) {
      added = false;
      for (const pool of pools) {
        if (pool.length && mains.length < n) { mains.push(pool.shift()); added = true; }
      }
    }
    const wu = (env === 'gym'
      ? DATA.find(e => e.region === '有氧')
      : DATA.find(e => e.region === '有氧' && e.equipment === 'body weight'))
      || DATA.find(e => e.equipment === 'body weight');
    if (wu) mains = mains.filter(m => m.id !== wu.id);

    // 每个动作：单次耗时 = 单次动作耗时(perRep) × 次数(repsToNum)；按预算反推组数
    const rn = repsToNum(scheme.reps) || 10;
    let mainItems = [];
    let sumMains = 0;
    // 热身/放松限制在合理区间（仍随总时长比例，但单块不过长）；残差由主训练吸收
    warmup = Math.max(30, Math.min(300, Math.round(B * 0.08)));
    cooldown = Math.max(20, Math.min(240, Math.round(B * 0.07)));
    if (mains.length) {
      let mainBudget = B - warmup - cooldown;
      if (mainBudget < mains.length * 40) {            // 预算过紧，压缩到下限再试
        warmup = 30; cooldown = 20; mainBudget = B - warmup - cooldown;
      }
      const share = mainBudget / mains.length;
      mains.forEach(ex => {
        const its = intensityOf(ex);
        const setSecs = perRep(its) * rn;              // 每组实际工作秒数
        const rest = restFor(its);                     // 组间休息（与计时器保持一致）
        let sets = Math.round((share + rest) / (setSecs + rest));
        sets = Math.max(1, Math.min(8, sets));
        sumMains += sets * setSecs + (sets - 1) * rest;
        mainItems.push(makeItem(ex, sets, scheme.reps, env, setSecs, 'main', rest));
      });
      // 精确保修：把主训练取整后的残差吸收进最后一个动作（先调组数，再按组数均摊微调单组秒数），
      // 热身/放松保持合理区间，整体 热身+主训练+放松 之和严格等于所选时长
      let diff = mainBudget - sumMains;
      if (diff !== 0 && mainItems.length) {
        const last = mainItems[mainItems.length - 1];
        const unit = last.secs + last.restSecs;
        last.sets = Math.max(1, Math.min(8, last.sets + Math.round(diff / unit)));
        sumMains = mainItems.reduce((s, it) => s + it.sets * it.secs + (it.sets - 1) * it.restSecs, 0);
        let diff2 = mainBudget - sumMains;
        if (diff2 !== 0) {
          last.secs = Math.max(10, last.secs + Math.round(diff2 / last.sets));
          sumMains = mainItems.reduce((s, it) => s + it.sets * it.secs + (it.sets - 1) * it.restSecs, 0);
        }
      }
      // 最终精确保修：把取整残差精确吸收进最后一个动作（反解其单组秒数），仍差极小则进热身
      let finalDiff = B - (warmup + cooldown + sumMains);
      if (finalDiff !== 0 && mainItems.length) {
        const last = mainItems[mainItems.length - 1];
        // last 应有的总时长 = 当前 last 总时长 + finalDiff
        const lastCur = last.sets * last.secs + (last.sets - 1) * last.restSecs;
        const targetLast = lastCur + finalDiff;
        // 反解整数单组秒数，使 last 总时长尽量贴近 targetLast
        let newSecs = Math.max(10, Math.round((targetLast - (last.sets - 1) * last.restSecs) / last.sets));
        last.secs = newSecs;
        sumMains = mainItems.reduce((s, it) => s + it.sets * it.secs + (it.sets - 1) * it.restSecs, 0);
        // 若仍有 ±1~2 秒取整残差，依次吸进热身 / 放松（保证严格精确）
        const f2 = B - (warmup + cooldown + sumMains);
        if (f2 !== 0) {
          const w = warmup + f2;
          if (w >= 30 && w <= 300) warmup = w;
          else { const c = cooldown + f2; if (c >= 20 && c <= 240) cooldown = c; }
        }
      }
    } else {
      // 无主训练动作（极端情况）：热身/放松按比例瓜分全部时长
      warmup = Math.max(60, Math.round(B * 0.5));
      cooldown = B - warmup;
    }

    const plan = [];
    if (wu) plan.push(makeItem(wu, 1, '动态热身', env, warmup, 'warmup', 0));
    plan.push(...mainItems);
    // 放松：优先拉伸本次训练的部位（徒手），让"选什么部位就见什么部位"，否则退化为通用徒手拉伸
    let cd = null;
    const inPlan = new Set(plan.map(p => p.id));
    if (regions && regions.length) {
      const cdPool = DATA.filter(e => regions.includes(e.region) && e.equipment === 'body weight' && !inPlan.has(e.id));
      if (cdPool.length) cd = cdPool[Math.floor(Math.random() * cdPool.length)];
    }
    if (!cd) cd = DATA.find(e => e.equipment === 'body weight' && e.region !== '有氧' && !inPlan.has(e.id));
    if (cd) plan.push(makeItem(cd, 1, '拉伸放松', env, cooldown, 'cooldown', 0));

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
