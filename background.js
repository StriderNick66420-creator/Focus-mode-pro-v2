// ── Constants ──────────────────────────────────────────────
const TIMER_ALARM   = 'focus-tick';
const STATS_ALARM   = 'daily-reset';
const TICK_INTERVAL = 1; // minutes (alarm minimum)

const DEFAULTS = {
  // Blocker
  blockEnabled: false,
  blocklist: [],
  schedule: { enabled: false, startHour: 9, endHour: 17 },

  // Timer
  timerState: 'idle',      // idle | running | break | paused
  timerMode: 'work',       // work | break
  timerRemaining: 25 * 60, // seconds
  workDuration: 25,        // minutes
  breakDuration: 5,        // minutes
  sessionsCompleted: 0,
  timerStartedAt: null,    // timestamp when last started

  // Pro
  isPro: false,
  licenseKey: '',
  hardMode: false,          // can't disable block until session ends

  // Stats
  focusScore: 0,
  streak: 0,
  lastActiveDate: '',
  totalSessionsAllTime: 0,
  weeklyData: [0,0,0,0,0,0,0], // Sun–Sat sessions
};

// ── Storage helpers ─────────────────────────────────────────
function getSettings() {
  return new Promise(resolve => chrome.storage.sync.get(DEFAULTS, resolve));
}
function saveSettings(patch) {
  return new Promise(resolve => chrome.storage.sync.set(patch, resolve));
}

// ── Blocking ────────────────────────────────────────────────
function isBlocked(url, blocklist) {
  if (!url) return false;
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    return blocklist.some(entry => {
      const clean = entry.trim().toLowerCase().replace(/^www\./, '');
      return hostname === clean || hostname.endsWith('.' + clean);
    });
  } catch { return false; }
}

function scheduleActive(schedule) {
  if (!schedule.enabled) return true;
  const now = new Date();
  const h = now.getHours();
  return h >= schedule.startHour && h < schedule.endHour;
}

async function checkTab(tab) {
  if (!tab?.url || !tab.id) return;
  const s = await getSettings();
  if (!s.blockEnabled) return;
  if (!scheduleActive(s.schedule)) return;
  if (isBlocked(tab.url, s.blocklist)) {
    const blocked = chrome.runtime.getURL('blocked.html') +
      '?url=' + encodeURIComponent(tab.url);
    chrome.tabs.update(tab.id, { url: blocked });
  }
}

chrome.tabs.onUpdated.addListener((id, info, tab) => {
  if (info.status === 'loading') checkTab(tab);
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId, tab => checkTab(tab));
});

// ── Pomodoro timer ──────────────────────────────────────────
let tickInterval = null; // in-memory fallback for sub-minute ticks

async function startInMemoryTick() {
  if (tickInterval) clearInterval(tickInterval);
  tickInterval = setInterval(timerTick, 1000);
}

function stopInMemoryTick() {
  if (tickInterval) { clearInterval(tickInterval); tickInterval = null; }
}

async function timerTick() {
  const s = await getSettings();
  if (s.timerState !== 'running' && s.timerState !== 'break') return;

  // Calculate true elapsed time
  const now = Date.now();
  const elapsed = s.timerStartedAt ? Math.floor((now - s.timerStartedAt) / 1000) : 0;
  const totalDuration = s.timerMode === 'work'
    ? s.workDuration * 60
    : s.breakDuration * 60;
  const remaining = Math.max(0, totalDuration - elapsed);

  if (remaining <= 0) {
    await sessionComplete(s);
    return;
  }

  await saveSettings({ timerRemaining: remaining });
  broadcastState({ timerRemaining: remaining, timerState: s.timerState, timerMode: s.timerMode });
}

async function sessionComplete(s) {
  stopInMemoryTick();

  if (s.timerMode === 'work') {
    // Work session done — start break
    const sessions = s.sessionsCompleted + 1;
    const total = s.totalSessionsAllTime + 1;
    const today = new Date().toISOString().slice(0, 10);
    const weekly = [...(s.weeklyData || [0,0,0,0,0,0,0])];
    const dow = new Date().getDay();
    weekly[dow] = (weekly[dow] || 0) + 1;

    const score = Math.min(100, Math.round((sessions / 8) * 100));
    let streak = s.streak || 0;
    if (s.lastActiveDate !== today) {
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      streak = s.lastActiveDate === yesterday ? streak + 1 : 1;
    }

    await saveSettings({
      timerMode: 'break',
      timerState: 'break',
      timerRemaining: s.breakDuration * 60,
      timerStartedAt: Date.now(),
      sessionsCompleted: sessions,
      totalSessionsAllTime: total,
      focusScore: score,
      streak,
      lastActiveDate: today,
      weeklyData: weekly,
    });

    chrome.notifications.create('session-done', {
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: '✅ Focus session complete!',
      message: `Session ${sessions} done. Take a ${s.breakDuration}-min break.`,
    });
    startInMemoryTick();
    broadcastState({ timerMode: 'break', timerState: 'break', timerRemaining: s.breakDuration * 60, sessionsCompleted: sessions });
  } else {
    // Break done — back to idle
    await saveSettings({
      timerMode: 'work',
      timerState: 'idle',
      timerRemaining: s.workDuration * 60,
      timerStartedAt: null,
    });
    chrome.notifications.create('break-done', {
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: '🎯 Break over — time to focus!',
      message: 'Ready for your next focus session.',
    });
    broadcastState({ timerMode: 'work', timerState: 'idle', timerRemaining: s.workDuration * 60 });
    updateBadge('idle', 0);
  }
}

function broadcastState(patch) {
  chrome.runtime.sendMessage({ type: 'TIMER_UPDATE', ...patch }).catch(() => {});
}

async function updateBadge(state, remaining) {
  if (state === 'idle') {
    chrome.action.setBadgeText({ text: '' });
    return;
  }
  const mins = Math.ceil(remaining / 60);
  const color = state === 'running' ? '#1D9E75' : state === 'break' ? '#3B82F6' : '#888';
  chrome.action.setBadgeText({ text: String(mins) });
  chrome.action.setBadgeBackgroundColor({ color });
}

// ── License validation ──────────────────────────────────────
function validateKey(key) {
  if (!key) return false;
  const clean = key.trim().toUpperCase();
  const pattern = /^FMP-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
  if (!pattern.test(clean)) return false;
  const chars = clean.replace(/-/g, '');
  const sum = chars.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return sum % 7 === 0;
}

// ── Message handler ─────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {

  if (msg.type === 'GET_STATE') {
    getSettings().then(s => sendResponse({
      timerState: s.timerState,
      timerMode: s.timerMode,
      timerRemaining: s.timerRemaining,
      sessionsCompleted: s.sessionsCompleted,
      workDuration: s.workDuration,
      breakDuration: s.breakDuration,
      blockEnabled: s.blockEnabled,
      hardMode: s.hardMode,
      isPro: s.isPro,
      focusScore: s.focusScore,
      streak: s.streak,
    }));
    return true;
  }

  if (msg.type === 'TIMER_START') {
    getSettings().then(async s => {
      await saveSettings({
        timerState: 'running',
        timerMode: 'work',
        timerRemaining: s.workDuration * 60,
        timerStartedAt: Date.now(),
        sessionsCompleted: 0,
      });
      startInMemoryTick();
      updateBadge('running', s.workDuration * 60);
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.type === 'TIMER_PAUSE') {
    getSettings().then(async s => {
      stopInMemoryTick();
      await saveSettings({ timerState: 'paused', timerStartedAt: null });
      updateBadge('paused', s.timerRemaining);
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.type === 'TIMER_RESUME') {
    getSettings().then(async s => {
      await saveSettings({ timerState: 'running', timerStartedAt: Date.now() - ((s.workDuration * 60 - s.timerRemaining) * 1000) });
      startInMemoryTick();
      updateBadge('running', s.timerRemaining);
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.type === 'TIMER_RESET') {
    getSettings().then(async s => {
      stopInMemoryTick();
      await saveSettings({
        timerState: 'idle',
        timerMode: 'work',
        timerRemaining: s.workDuration * 60,
        timerStartedAt: null,
        sessionsCompleted: 0,
      });
      updateBadge('idle', 0);
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.type === 'TOGGLE_BLOCK') {
    getSettings().then(async s => {
      if (s.hardMode && s.isPro && s.timerState === 'running' && s.blockEnabled) {
        sendResponse({ ok: false, reason: 'hard_mode' });
        return;
      }
      await saveSettings({ blockEnabled: !s.blockEnabled });
      sendResponse({ ok: true, blockEnabled: !s.blockEnabled });
    });
    return true;
  }

  if (msg.type === 'VALIDATE_LICENSE') {
    const valid = validateKey(msg.key);
    if (valid) {
      saveSettings({ licenseKey: msg.key.trim().toUpperCase(), isPro: true })
        .then(() => sendResponse({ valid: true }));
    } else {
      sendResponse({ valid: false });
    }
    return true;
  }

  if (msg.type === 'SETTINGS_UPDATED') {
    sendResponse({ ok: true });
    return true;
  }
});

// Resume tick if service worker restarts mid-session
getSettings().then(s => {
  if (s.timerState === 'running' || s.timerState === 'break') {
    startInMemoryTick();
  }
});
