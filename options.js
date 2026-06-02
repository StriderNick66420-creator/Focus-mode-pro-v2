const $ = id => document.getElementById(id);
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

const DEFAULTS = {
  blockEnabled: false,
  blocklist: [],
  schedule: { enabled: false, startHour: 9, endHour: 17 },
  workDuration: 25,
  breakDuration: 5,
  focusGoal: '',
  isPro: false,
  licenseKey: '',
  hardMode: false,
  focusScore: 0,
  streak: 0,
  totalSessionsAllTime: 0,
  weeklyData: [0,0,0,0,0,0,0],
};

function getSettings() {
  return new Promise(resolve => chrome.storage.sync.get(DEFAULTS, resolve));
}
function saveSettings(patch) {
  return new Promise(resolve => chrome.storage.sync.set(patch, resolve));
}

// Populate hour selects
function buildHourSelects() {
  ['sched-start','sched-end'].forEach(id => {
    const sel = $(id);
    for (let h = 0; h < 24; h++) {
      const opt = document.createElement('option');
      opt.value = h;
      const ampm = h < 12 ? 'AM' : 'PM';
      const h12 = h % 12 || 12;
      opt.textContent = `${h12}:00 ${ampm}`;
      sel.appendChild(opt);
    }
  });
}

function renderTags(blocklist) {
  const c = $('site-tags');
  c.innerHTML = '';
  blocklist.forEach((entry, i) => {
    const t = document.createElement('span');
    t.className = 'tag';
    t.innerHTML = `${entry}<span class="tag-x" data-i="${i}">×</span>`;
    c.appendChild(t);
  });
  c.querySelectorAll('.tag-x').forEach(x => {
    x.addEventListener('click', async () => {
      const s = await getSettings();
      s.blocklist.splice(Number(x.dataset.i), 1);
      await saveSettings({ blocklist: s.blocklist });
      renderTags(s.blocklist);
    });
  });
}

function renderWeekChart(data) {
  const chart = $('week-chart');
  chart.innerHTML = '';
  const max = Math.max(...data, 1);
  const today = new Date().getDay();
  data.forEach((val, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'bar-wrap';
    const bar = document.createElement('div');
    bar.className = 'bar';
    const heightPct = Math.round((val / max) * 100);
    bar.style.height = `${Math.max(4, heightPct * 0.6)}px`;
    if (i === today) bar.style.opacity = '1';
    else bar.style.opacity = '0.4';
    const label = document.createElement('div');
    label.className = 'bar-label';
    label.textContent = DAYS[i];
    wrap.appendChild(bar);
    wrap.appendChild(label);
    chart.appendChild(wrap);
  });
}

async function init() {
  buildHourSelects();
  const s = await getSettings();

  $('work-dur').value = s.workDuration;
  $('break-dur').value = s.breakDuration;
  $('focus-goal').value = s.focusGoal || '';
  $('block-enabled').checked = s.blockEnabled;
  $('schedule-enabled').checked = s.schedule.enabled;
  $('sched-start').value = s.schedule.startHour;
  $('sched-end').value = s.schedule.endHour;
  $('hard-mode').checked = s.hardMode;

  renderTags(s.blocklist);
  renderWeekChart(s.weeklyData || [0,0,0,0,0,0,0]);

  $('s-total').textContent = s.totalSessionsAllTime || 0;
  $('s-streak').textContent = s.streak || 0;
  $('s-score').textContent = s.focusScore || 0;

  if (s.isPro) {
    $('pro-active-view').classList.add('on');
    $('pro-lock-view').style.display = 'none';
    $('hard-mode-field').style.display = 'block';
  }
}

$('add-site').addEventListener('click', async () => {
  const val = $('site-input').value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  if (!val) return;
  const s = await getSettings();
  if (!s.blocklist.includes(val)) {
    s.blocklist.push(val);
    await saveSettings({ blocklist: s.blocklist });
    renderTags(s.blocklist);
  }
  $('site-input').value = '';
});

$('site-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') $('add-site').click();
});

$('save-btn').addEventListener('click', async () => {
  const s = await getSettings();
  await saveSettings({
    workDuration: Math.max(1, parseInt($('work-dur').value) || 25),
    breakDuration: Math.max(1, parseInt($('break-dur').value) || 5),
    focusGoal: $('focus-goal').value.trim(),
    blockEnabled: $('block-enabled').checked,
    schedule: {
      enabled: $('schedule-enabled').checked,
      startHour: parseInt($('sched-start').value),
      endHour: parseInt($('sched-end').value),
    },
    hardMode: s.isPro ? $('hard-mode').checked : false,
  });
  chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED' });
  const msg = $('save-msg');
  msg.textContent = 'Saved!';
  setTimeout(() => { msg.textContent = ''; }, 2000);
});

$('activate-btn').addEventListener('click', () => {
  const key = $('license-key').value.trim();
  const statusEl = $('license-status');
  if (!key) { statusEl.textContent = 'Enter your key.'; statusEl.className = 'license-status ls-err'; return; }
  statusEl.textContent = 'Validating...'; statusEl.className = 'license-status';
  chrome.runtime.sendMessage({ type: 'VALIDATE_LICENSE', key }, res => {
    if (res?.valid) {
      statusEl.textContent = 'Pro unlocked!'; statusEl.className = 'license-status ls-ok';
      $('pro-active-view').classList.add('on');
      $('pro-lock-view').style.display = 'none';
      $('hard-mode-field').style.display = 'block';
    } else {
      statusEl.textContent = 'Invalid key. Try again.'; statusEl.className = 'license-status ls-err';
    }
  });
});

init();
