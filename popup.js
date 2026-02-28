// popup.js — Popup UI logic: detect platform, control extraction, show progress

let currentPlatform = null;
let activeTabId = null;
let port = null;

document.addEventListener('DOMContentLoaded', async () => {
  // Detect which page the active tab is on
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = tab.id;
  const url = tab.url || '';

  if (url.includes('x.com/i/bookmarks') || url.includes('twitter.com/i/bookmarks')) {
    currentPlatform = 'twitter';
    showBadge('Twitter / X', 'twitter');
  } else if (url.includes('linkedin.com/my-items/saved-posts')) {
    currentPlatform = 'linkedin';
    showBadge('LinkedIn', 'linkedin');
  } else {
    showBadge('Unsupported page', 'none');
    document.getElementById('startBtn').style.display = 'none';
    document.getElementById('unsupportedMsg').classList.add('visible');
    return;
  }

  document.getElementById('startBtn').disabled = false;

  // Show last-run stats
  const stats = await getStats(currentPlatform);
  const statsEl = document.getElementById('stats');
  if (stats.lastRun) {
    const date = new Date(stats.lastRun);
    const formatted = date.toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit'
    });
    statsEl.innerHTML =
      `Last run: ${formatted}<br>` +
      `Total extracted: ${stats.totalExtracted} posts` +
      `<br><span class="clear-link" id="clearBtn">Clear history</span>`;

    document.getElementById('clearBtn').addEventListener('click', async () => {
      await clearStorage(currentPlatform);
      statsEl.textContent = 'History cleared.';
    });
  } else {
    statsEl.textContent = 'No previous extractions.';
  }
});

// Start button
document.getElementById('startBtn').addEventListener('click', () => {
  if (!activeTabId || !currentPlatform) return;

  // Open a long-lived port to the content script
  try {
    port = chrome.tabs.connect(activeTabId, { name: 'magpie' });
  } catch (err) {
    document.getElementById('statusText').textContent =
      'Failed to connect. Try refreshing the page (Cmd+Shift+R).';
    document.getElementById('progressArea').classList.add('visible');
    return;
  }

  port.postMessage({ action: 'start', platform: currentPlatform });

  port.onMessage.addListener(handleMessage);
  port.onDisconnect.addListener(() => {
    // If port disconnects immediately, the content script isn't there
    if (port) {
      const err = chrome.runtime.lastError;
      if (err) {
        document.getElementById('statusText').textContent =
          'Content script not found. Try refreshing the page (Cmd+Shift+R).';
      }
    }
    port = null;
  });

  // UI: switch to extraction mode
  document.getElementById('startBtn').style.display = 'none';
  document.getElementById('stopBtn').style.display = 'block';
  document.getElementById('progressArea').classList.add('visible');
  document.getElementById('statusText').textContent = 'Starting...';
  document.getElementById('countText').textContent = '';
  document.getElementById('progressFill').style.width = '0%';
  document.getElementById('progressFill').classList.remove('indeterminate');
});

// Stop button
document.getElementById('stopBtn').addEventListener('click', () => {
  if (port) {
    port.postMessage({ action: 'stop' });
  }
  document.getElementById('stopBtn').disabled = true;
  document.getElementById('statusText').textContent = 'Stopping...';
});

function handleMessage(msg) {
  if (msg.action === 'progress') {
    document.getElementById('statusText').textContent = msg.status;
    document.getElementById('countText').textContent =
      `New posts: ${msg.newCount}  |  Scanned: ${msg.totalScanned}`;

    // Indeterminate progress bar (no known total)
    const fill = document.getElementById('progressFill');
    if (!fill.classList.contains('indeterminate')) {
      fill.classList.add('indeterminate');
    }
  }

  if (msg.action === 'done' || msg.action === 'stopped') {
    const isDone = msg.action === 'done';
    const doneFill = document.getElementById('progressFill');
    doneFill.classList.remove('indeterminate');
    doneFill.style.width = '100%';
    document.getElementById('statusText').textContent = isDone
      ? `Done! Extracted ${msg.newCount} new posts.`
      : `Stopped. Extracted ${msg.newCount} posts.`;
    document.getElementById('countText').textContent =
      msg.newCount > 0 ? 'Markdown file download should appear shortly.' : 'No new posts found.';

    // Reset buttons
    document.getElementById('stopBtn').style.display = 'none';
    document.getElementById('stopBtn').disabled = false;
    document.getElementById('startBtn').style.display = 'block';
    document.getElementById('startBtn').disabled = false;
  }
}

function showBadge(text, className) {
  const el = document.getElementById('platformBadge');
  el.innerHTML = `<span class="badge ${className}">${text}</span>`;
}
