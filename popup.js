const $ = id => document.getElementById(id);
const CIRCUMFERENCE = 2 * Math.PI * 70; // r=70

let state = {};

function fmt(sec) {
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = (sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function setRing(remaining, total) {
  const pct = total > 0 ? remaining / total : 1;
  const offset = CIRCUMFERENCE * (1 - pct);
  $('ring').style.strokeDashoffset = offset;
}

function renderState(s) {
  state = s;
  const total = s.timerMode === 'work' ? s.workDuration * 60 : s.breakDuration * 60;

  // Timer display
  $('timer-display').textContent = fmt(s.timerRemaining);
  $('timer-label').textContent = s.timerMode === 'work' ? 'Focus' : 'Break';
  setRing(s.timerRemaining, total);

  // Ring color
  const ring = $('ring');
  ring.className = 'ring-progress';
  if (s.timerMode === 'break') ring.classList.add('break');
  if (s.timerState === 'paused') ring.classList.add('paused');

  // Main button
  const btn = $('main-btn');
  if (s.timerState === 'idle') { btn.textContent = 'Start Focus'; btn.className = 'btn btn-primary'; }
  else if (s.timerState === 'running') { btn.textContent = 'Pause'; btn.className = 'btn btn-secondary'; }
  else if (s.timerState === 'paused') { btn.textContent = 'Resume'; btn.className = 'btn btn-primary'; }
  else if (s.timerState === 'break') { btn.textContent = 'Break...'; btn.className = 'btn btn-secondary'; btn.disabled = true; }

  $('reset-btn').disabled = s.timerState === 'idle';

  // Session dots
  const dots = $('session-dots').querySelectorAll('.dot');
  dots.forEach((d, i) => {
    d.className = 'dot';
    if (i < s.sessionsCompleted) d.classList.add('done');
    else if (i === s.sessionsCompleted) d.classList.add('active');
  });

  // Block toggle
  $('block-toggle').checked = s.blockEnabled;
  $('block-status').textContent = s.blockEnabled ? 'On' : 'Off';
  $('block-status').style.color = s.blockEnabled ? '#1D9E75' : '#fff';

  // Hard mode banner
  if (s.isPro && s.hardMode && s.timerState === 'running' && s.blockEnabled) {
    $('hard-banner').classList.add('on');
  } else {
    $('hard-banner').classList.remove('on');
  }

  // Stats
  $('s-sessions').textContent = s.sessionsCompleted || 0;
  $('s-streak').textContent = s.streak || 0;
  $('s-score').textContent = s.focusScore || 0;

  // Pro
  if (s.isPro) {
    $('pro-badge').classList.add('on');
    $('license-section').style.display = 'none';
  } else {
    $('license-section').style.display = 'block';
  }
}

function init() {
  chrome.runtime.sendMessage({ type: 'GET_STATE' }, renderState);

  // Get blocklist count
  chrome.storage.sync.get({ blocklist: [] }, s => {
    $('block-count').textContent = `${s.blocklist.length} site${s.blocklist.length !== 1 ? 's' : ''}`;
  });
}

// Main button
$('main-btn').addEventListener('click', () => {
  if (state.timerState === 'idle') {
    chrome.runtime.sendMessage({ type: 'TIMER_START' }, () => init());
  } else if (state.timerState === 'running') {
    chrome.runtime.sendMessage({ type: 'TIMER_PAUSE' }, () => init());
  } else if (state.timerState === 'paused') {
    chrome.runtime.sendMessage({ type: 'TIMER_RESUME' }, () => init());
  }
});

// Reset
$('reset-btn').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'TIMER_RESET' }, () => init());
});

// Block toggle
$('block-toggle').addEventListener('change', () => {
  chrome.runtime.sendMessage({ type: 'TOGGLE_BLOCK' }, res => {
    if (!res.ok && res.reason === 'hard_mode') {
      $('block-toggle').checked = true;
      $('hard-banner').classList.add('on');
      return;
    }
    init();
  });
});

// License
$('activate-btn').addEventListener('click', () => {
  const key = $('license-input').value.trim();
  const msg = $('license-msg');
  if (!key) { msg.textContent = 'Enter your license key.'; msg.className = 'license-msg err'; return; }
  msg.textContent = 'Validating...'; msg.className = 'license-msg';
  chrome.runtime.sendMessage({ type: 'VALIDATE_LICENSE', key }, res => {
    if (res?.valid) {
      msg.textContent = 'Pro unlocked!'; msg.className = 'license-msg ok';
      setTimeout(() => init(), 600);
    } else {
      msg.textContent = 'Invalid key. Try again.'; msg.className = 'license-msg err';
    }
  });
});

// Options
$('options-link').addEventListener('click', () => chrome.runtime.openOptionsPage());

// Live updates from background
chrome.runtime.onMessage.addListener(msg => {
  if (msg.type === 'TIMER_UPDATE') {
    renderState({ ...state, ...msg });
  }
});

// Refresh every second for live countdown
setInterval(() => {
  if (state.timerState === 'running' || state.timerState === 'break') {
    chrome.runtime.sendMessage({ type: 'GET_STATE' }, s => {
      if (s) renderState(s);
    });
  }
}, 1000);

init();
