/* global chrome */

// Pointer tools; the content script runs at most one at a time.
const TOOLS = {
  font: { id: 'font-toggle', color: '#4fc1ff' },
  copier: { id: 'copier-toggle', color: '#f0b429' },
  image: { id: 'image-toggle', color: '#4ec9b0' },
};
let activeTool = null;
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

function showActiveTool(tool) {
  activeTool = tool;
  for (const [name, { id }] of Object.entries(TOOLS)) {
    document.getElementById(id).classList.toggle('active', name === tool);
  }
  getTab().then(tab => {
    if (!tab || !tab.id) return;
    chrome.action.setBadgeText({ tabId: tab.id, text: tool ? 'ON' : '' });
    if (tool) chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: TOOLS[tool].color });
  });
}

// Sync UI state on open
getTab().then(tab => {
  if (!tab || !tab.id) return;
  chrome.tabs.sendMessage(tab.id, { type: 'GET_TOOL_STATE' }, (res) => {
    if (chrome.runtime.lastError || !res) return;
    showActiveTool(res.tool);
  });
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

// Tool toggles
for (const [name, { id }] of Object.entries(TOOLS)) {
  document.getElementById(id).addEventListener('click', () => {
    sendToTab({ type: 'TOGGLE_TOOL', tool: name }).then(res => {
      if (res) showActiveTool(res.tool);
    });
  });
}

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
  if (activeTool) {
    sendToTab({ type: 'TOGGLE_TOOL', tool: activeTool }).then(res => {
      if (res) showActiveTool(res.tool);
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
