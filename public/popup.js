/* global chrome */

let fontActive = false;
let grayActive = false;
let activeCb = null;

function getTab() {
  return chrome.tabs.query({ active: true, currentWindow: true }).then(tabs => tabs[0]);
}

function sendToTab(msg) {
  return getTab().then(tab => {
    if (!tab || !tab.id) return null;
    return chrome.tabs.sendMessage(tab.id, msg);
  });
}

// Sync UI state on open
getTab().then(tab => {
  if (!tab || !tab.id) return;
  // Get vision state
  chrome.tabs.sendMessage(tab.id, { type: 'GET_VISION_STATE' }, (res) => {
    if (chrome.runtime.lastError || !res) return;
    const s = res.state;
    if (s.blur > 0) {
      document.getElementById('blur-slider').value = s.blur;
      document.getElementById('blur-value').textContent = s.blur + 'px';
    }
    if (s.grayscale) {
      grayActive = true;
      document.getElementById('gray-toggle').classList.add('active');
    }
    if (s.colorBlindness) {
      activeCb = s.colorBlindness;
      const btn = document.querySelector('[data-cb="' + s.colorBlindness + '"]');
      if (btn) btn.classList.add('active');
    }
  });
});

// Font Inspector toggle
document.getElementById('font-toggle').addEventListener('click', () => {
  sendToTab({ type: 'TOGGLE_FONT_INSPECTOR' }).then(res => {
    if (!res) return;
    fontActive = res.active;
    document.getElementById('font-toggle').classList.toggle('active', fontActive);
    getTab().then(tab => {
      if (tab && tab.id) {
        chrome.action.setBadgeText({ tabId: tab.id, text: fontActive ? 'ON' : '' });
        chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#4fc1ff' });
      }
    });
  });
});

// Blur slider
document.getElementById('blur-slider').addEventListener('input', (e) => {
  const val = parseFloat(e.target.value);
  document.getElementById('blur-value').textContent = val + 'px';
  sendToTab({ type: 'SET_BLUR', amount: val });
});

// Grayscale toggle
document.getElementById('gray-toggle').addEventListener('click', () => {
  sendToTab({ type: 'TOGGLE_GRAYSCALE' }).then(res => {
    if (!res) return;
    grayActive = res.active;
    document.getElementById('gray-toggle').classList.toggle('active', grayActive);
  });
});

// Color blindness buttons
document.querySelectorAll('.cb-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const type = btn.dataset.cb;
    sendToTab({ type: 'SET_COLOR_BLINDNESS', cbType: type }).then(res => {
      if (!res) return;
      document.querySelectorAll('.cb-btn').forEach(b => b.classList.remove('active'));
      if (res.active) {
        activeCb = res.active;
        btn.classList.add('active');
      } else {
        activeCb = null;
      }
    });
  });
});

// Reset all
document.getElementById('reset-btn').addEventListener('click', () => {
  sendToTab({ type: 'RESET_VISION' });
  // Also disable font inspector if active
  if (fontActive) {
    sendToTab({ type: 'TOGGLE_FONT_INSPECTOR' }).then(() => {
      fontActive = false;
      document.getElementById('font-toggle').classList.remove('active');
      getTab().then(tab => {
        if (tab && tab.id) chrome.action.setBadgeText({ tabId: tab.id, text: '' });
      });
    });
  }
  // Reset UI
  document.getElementById('blur-slider').value = 0;
  document.getElementById('blur-value').textContent = '0px';
  document.getElementById('gray-toggle').classList.remove('active');
  document.querySelectorAll('.cb-btn').forEach(b => b.classList.remove('active'));
  grayActive = false;
  activeCb = null;
});
