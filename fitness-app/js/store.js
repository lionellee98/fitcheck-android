/* Local-only persistence (localStorage). All data stays on device. */
const Store = (function () {
  const KEY = 'fitcheck_v1';
  let state = load();

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; }
    catch (e) { return {}; }
  }
  function persist() { localStorage.setItem(KEY, JSON.stringify(state)); }

  function todayStr(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function getProfile() { return state.profile || null; }
  function setProfile(p) { state.profile = Object.assign({}, state.profile, p); persist(); }

  function getDay(date) { return (state.days && state.days[date]) ? state.days[date] : null; }
  function saveDay(date, rec) { state.days = state.days || {}; state.days[date] = rec; persist(); }
  function getAllDays() { return state.days || {}; }
  function countDays() { return Object.keys(state.days || {}).length; }

  function getMonth(year, month) { // month 0-based
    const out = {}; const days = state.days || {};
    for (const k in days) {
      const parts = k.split('-');
      if (+parts[0] === year && (+parts[1] - 1) === month) out[k] = days[k];
    }
    return out;
  }

  // 当天未完成计划的草稿（未打卡前持久化，避免切换页面/重开导致「开始跟练」消失）
  function getDraft(date) { return (state.drafts && state.drafts[date]) ? state.drafts[date] : null; }
  function saveDraft(date, d) { state.drafts = state.drafts || {}; state.drafts[date] = d; persist(); }
  function clearDraft(date) { if (state.drafts) { delete state.drafts[date]; persist(); } }

  function lastQuoteDate() { return state.lastQuoteDate || ''; }
  function setLastQuoteDate(d) { state.lastQuoteDate = d; persist(); }
  function getTheme() { return state.theme || ''; }
  function setTheme(t) { state.theme = t; persist(); }

  return { todayStr, getProfile, setProfile, getDay, saveDay, getAllDays, countDays, getMonth, getDraft, saveDraft, clearDraft, lastQuoteDate, setLastQuoteDate, getTheme, setTheme };
})();
