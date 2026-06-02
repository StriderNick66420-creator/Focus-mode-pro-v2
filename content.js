// Runs at document_start on every page
// Checks if current URL is blocked and redirects immediately

(async function () {
  // Don't run on extension pages
  if (location.href.startsWith('chrome-extension://')) return;
  if (location.href.startsWith('chrome://')) return;

  const DEFAULTS = {
    blockEnabled: false,
    blocklist: [],
    schedule: { enabled: false, startHour: 9, endHour: 17 },
  };

  function isBlocked(url, blocklist) {
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
    const h = new Date().getHours();
    return h >= schedule.startHour && h < schedule.endHour;
  }

  chrome.storage.sync.get(DEFAULTS, (s) => {
    if (!s.blockEnabled) return;
    if (!scheduleActive(s.schedule)) return;
    if (isBlocked(location.href, s.blocklist)) {
      const blockedUrl = chrome.runtime.getURL('blocked.html') +
        '?url=' + encodeURIComponent(location.href);
      location.replace(blockedUrl);
    }
  });
})();
