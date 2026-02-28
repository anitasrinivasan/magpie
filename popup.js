// popup.js — Popup UI logic: detect platform, control extraction, show progress,
// generate complete markdown files (all posts), and trigger Save As downloads.

let currentPlatform = null;
let activeTabId = null;
let port = null;

// ─── Markdown column definitions ─────────────────────────────────────────────

const TWITTER_MD_COLUMNS = [
  { header: 'Author', key: 'Author Name' },
  { header: 'Handle', key: 'Author Handle' },
  { header: 'URL', key: 'Tweet URL' },
  { header: 'Type', key: 'Tweet Type' },
  { header: 'Timestamp', key: 'Timestamp' },
  { header: 'Preview', key: 'Preview Text' }
];

const LINKEDIN_MD_COLUMNS = [
  { header: 'Author', key: 'Author Name' },
  { header: 'Profile', key: 'Author Profile URL' },
  { header: 'Post URL', key: 'Post URL' },
  { header: 'Type', key: 'Post Type' },
  { header: 'Timestamp', key: 'Timestamp' },
  { header: 'Preview', key: 'Preview Text' }
];

function getColumns(platform) {
  return platform === 'twitter' ? TWITTER_MD_COLUMNS : LINKEDIN_MD_COLUMNS;
}

function getUrlKey(platform) {
  return platform === 'twitter' ? 'Tweet URL' : 'Post URL';
}

// ─── Markdown generation ─────────────────────────────────────────────────────

function escapeMarkdownCell(val) {
  if (val == null || val === false) return '';
  let str = String(val);
  str = str.replace(/[\r\n]+/g, ' ');
  str = str.replace(/\|/g, '\\|');
  str = str.replace(/\s+/g, ' ').trim();
  return str;
}

function buildFullMarkdown(platform, allRows) {
  const columns = getColumns(platform);
  const title = platform === 'twitter' ? 'Twitter Bookmarks' : 'LinkedIn Saved Posts';
  const date = new Date().toISOString().slice(0, 10);

  const lines = [];
  lines.push(`# Magpie — ${title}`);
  lines.push(`**Last updated:** ${date}  `);
  lines.push(`**Total bookmarks:** ${allRows.length}`);
  lines.push('');
  lines.push('| ' + columns.map(c => c.header).join(' | ') + ' |');
  lines.push('| ' + columns.map(() => '---').join(' | ') + ' |');
  for (const row of allRows) {
    const cells = columns.map(c => escapeMarkdownCell(row[c.key]));
    lines.push('| ' + cells.join(' | ') + ' |');
  }
  lines.push('');
  return lines.join('\n');
}

// ─── Import: parse existing .md file to recover posts ────────────────────────

function parsePostsFromMarkdown(content, platform) {
  if (!content) return [];
  const columns = getColumns(platform);
  const posts = [];
  const lines = content.split('\n');
  for (const line of lines) {
    if (!line.startsWith('|')) continue;
    if (line.includes('---')) continue;
    const cells = line.split('|').map(c => c.trim()).filter(c => c);
    if (cells[0] === columns[0].header) continue; // skip header row
    if (cells.length >= columns.length) {
      const post = {};
      columns.forEach((col, i) => {
        post[col.key] = cells[i] || '';
      });
      posts.push(post);
    }
  }
  return posts;
}

function detectPlatformFromMarkdown(content) {
  if (content.includes('Twitter Bookmarks')) return 'twitter';
  if (content.includes('LinkedIn Saved Posts')) return 'linkedin';
  return null;
}

// ─── Download via Save As ────────────────────────────────────────────────────

function triggerDownload(platform, allPosts) {
  const mdContent = buildFullMarkdown(platform, allPosts);
  const filename = platform === 'twitter' ? 'magpie_twitter.md' : 'magpie_linkedin.md';

  // Use chrome.downloads API with saveAs for consistent Save As dialog
  const dataUrl = 'data:text/plain;charset=utf-8,' + encodeURIComponent(mdContent);
  chrome.downloads.download({
    url: dataUrl,
    filename: filename,
    saveAs: true
  }, (downloadId) => {
    if (chrome.runtime.lastError) {
      console.error('Magpie: download failed:', chrome.runtime.lastError.message);
      // Fallback: anchor tag download
      const blob = new Blob([mdContent], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 5000);
    } else {
      console.log('Magpie: download started, id:', downloadId);
    }
  });
}

// ─── Main popup logic ────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
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
      `<br><span class="action-link" id="clearBtn">Clear history</span>` +
      ` · <span class="action-link" id="importBtn">Import existing file</span>` +
      `<span id="importStatus"></span>`;

    document.getElementById('clearBtn').addEventListener('click', async () => {
      await clearStorage(currentPlatform);
      statsEl.textContent = 'History cleared.';
    });
    setupImport();
  } else {
    statsEl.innerHTML =
      'No previous extractions.' +
      `<br><span class="action-link" id="importBtn">Import existing file</span>` +
      `<span id="importStatus"></span>`;
    setupImport();
  }
});

function setupImport() {
  const importBtn = document.getElementById('importBtn');
  const importFile = document.getElementById('importFile');

  importBtn.addEventListener('click', () => {
    importFile.click();
  });

  importFile.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const statusEl = document.getElementById('importStatus');
    statusEl.textContent = 'Importing...';

    try {
      const content = await file.text();
      const detectedPlatform = detectPlatformFromMarkdown(content);

      if (!detectedPlatform) {
        statusEl.textContent = 'Could not detect platform from file.';
        return;
      }

      const posts = parsePostsFromMarkdown(content, detectedPlatform);
      if (posts.length === 0) {
        statusEl.textContent = 'No bookmarks found in file.';
        return;
      }

      // Store posts and URLs
      const urlKey = getUrlKey(detectedPlatform);
      const urls = posts.map(p => p[urlKey]).filter(u => u);
      await setStoredPosts(detectedPlatform, posts);
      await addUrls(detectedPlatform, urls);

      statusEl.textContent = `Imported ${posts.length} ${detectedPlatform} bookmarks.`;
    } catch (err) {
      console.error('Magpie: import error:', err);
      statusEl.textContent = 'Import failed: ' + err.message;
    }
  });
}

// Start button
document.getElementById('startBtn').addEventListener('click', async () => {
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

async function handleMessage(msg) {
  if (msg.action === 'progress') {
    document.getElementById('statusText').textContent = msg.status;
    document.getElementById('countText').textContent =
      `New posts: ${msg.newCount}  |  Scanned: ${msg.totalScanned}`;

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

    const newPosts = msg.posts || [];

    if (newPosts.length > 0) {
      try {
        document.getElementById('statusText').textContent = 'Preparing download...';

        // Load stored posts, combine with new, store everything
        const storedPosts = await getStoredPosts(currentPlatform);
        const allPosts = [...storedPosts, ...newPosts];
        await setStoredPosts(currentPlatform, allPosts);

        // Generate complete file and trigger Save As download
        triggerDownload(currentPlatform, allPosts);

        document.getElementById('statusText').textContent = isDone
          ? `Done! ${newPosts.length} new posts (${allPosts.length} total).`
          : `Stopped. ${newPosts.length} new posts (${allPosts.length} total).`;
        document.getElementById('countText').textContent =
          'Save the file to your Obsidian vault.';
      } catch (err) {
        console.error('Magpie: download error:', err);
        document.getElementById('statusText').textContent =
          `Error: ${err.message}`;
      }
    } else {
      document.getElementById('statusText').textContent = isDone
        ? 'Done! No new posts found.'
        : 'Stopped. No new posts collected yet.';
      document.getElementById('countText').textContent = '';
    }

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
