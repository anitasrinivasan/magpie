// popup.js — Popup UI logic: detect platform, control extraction, show progress,
// manage export folder (File System Access API), and write .md files.
// IndexedDB helpers (openDB, saveDirHandle, getDirHandle) are in db.js.

let currentPlatform = null;
let activeTabId = null;
let port = null;
let dirHandle = null; // FileSystemDirectoryHandle for export folder

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

// ─── Markdown file read / write / append ─────────────────────────────────────

function getColumns(platform) {
  return platform === 'twitter' ? TWITTER_MD_COLUMNS : LINKEDIN_MD_COLUMNS;
}

function getFilename(platform) {
  return platform === 'twitter' ? 'magpie_twitter.md' : 'magpie_linkedin.md';
}

function escapeMarkdownCell(val) {
  if (val == null || val === false) return '';
  let str = String(val);
  str = str.replace(/[\r\n]+/g, ' ');
  str = str.replace(/\|/g, '\\|');
  str = str.replace(/\s+/g, ' ').trim();
  return str;
}

/** Read existing .md file from the directory handle. Returns '' if not found. */
async function readExistingFile(handle, filename) {
  try {
    const fileHandle = await handle.getFileHandle(filename);
    const file = await fileHandle.getFile();
    return await file.text();
  } catch {
    return ''; // file doesn't exist yet
  }
}

/** Parse URLs from a markdown table for dedup. URL is always the 3rd column. */
function parseUrlsFromMarkdown(content) {
  if (!content) return [];
  const urls = [];
  const lines = content.split('\n');
  for (const line of lines) {
    if (!line.startsWith('|')) continue;
    // Skip header and separator rows
    if (line.includes('---')) continue;
    const cells = line.split('|').map(c => c.trim()).filter(c => c);
    // URL is the 3rd column (index 2) for both platforms
    if (cells.length > 2) {
      const url = cells[2].trim();
      if (url.startsWith('http')) {
        urls.push(url);
      }
    }
  }
  return urls;
}

/** Build a full markdown file with header + all rows. */
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

/** Parse existing markdown rows back into objects so we can rebuild the file. */
function parseRowsFromMarkdown(content, platform) {
  if (!content) return [];
  const columns = getColumns(platform);
  const rows = [];
  const lines = content.split('\n');
  for (const line of lines) {
    if (!line.startsWith('|')) continue;
    if (line.includes('---')) continue;
    const cells = line.split('|').map(c => c.trim()).filter(c => c);
    // Skip header row (check if first cell matches first column header)
    if (cells[0] === columns[0].header) continue;
    if (cells.length >= columns.length) {
      const row = {};
      columns.forEach((col, i) => {
        row[col.key] = cells[i] || '';
      });
      rows.push(row);
    }
  }
  return rows;
}

/** Append new posts to the existing file, or create it if it doesn't exist. */
async function appendToFile(handle, platform, newPosts) {
  const filename = getFilename(platform);
  const existingContent = await readExistingFile(handle, filename);

  // Parse existing rows
  const existingRows = parseRowsFromMarkdown(existingContent, platform);

  // Combine (existing + new)
  const allRows = [...existingRows, ...newPosts];

  // Rebuild the full file
  const mdContent = buildFullMarkdown(platform, allRows);

  // Write to disk
  const fileHandle = await handle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(mdContent);
  await writable.close();

  console.log('Magpie: wrote', allRows.length, 'total rows to', filename);
  return { total: allRows.length, added: newPosts.length };
}

/** Fallback: download via Blob URL + anchor tag if no dir handle is set. */
function downloadFallback(platform, posts) {
  const columns = getColumns(platform);
  const title = platform === 'twitter' ? 'Twitter Bookmarks' : 'LinkedIn Saved Posts';
  const date = new Date().toISOString().slice(0, 10);

  const lines = [];
  lines.push(`# Magpie Export — ${title}`);
  lines.push(`**Exported:** ${date}  `);
  lines.push(`**New bookmarks in this batch:** ${posts.length}`);
  lines.push('');
  lines.push('| ' + columns.map(c => c.header).join(' | ') + ' |');
  lines.push('| ' + columns.map(() => '---').join(' | ') + ' |');
  for (const row of posts) {
    const cells = columns.map(c => escapeMarkdownCell(row[c.key]));
    lines.push('| ' + cells.join(' | ') + ' |');
  }
  lines.push('');

  const mdContent = lines.join('\n');
  const blob = new Blob([mdContent], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `magpie_${platform}_${date}.md`;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 5000);
}

// ─── Folder picker UI ────────────────────────────────────────────────────────

async function initFolderUI() {
  try {
    dirHandle = await getDirHandle();
    if (dirHandle) {
      // Verify we still have permission (read-only check, no user gesture needed)
      const perm = await dirHandle.queryPermission({ mode: 'readwrite' });
      if (perm === 'granted') {
        showFolderPath(dirHandle.name);
      } else {
        // We have a handle but no permission yet — will request on Start click
        showFolderPath(dirHandle.name + ' (click Start to re-authorize)');
      }
    }
  } catch (err) {
    console.warn('Magpie: could not load dir handle:', err);
    dirHandle = null;
  }
}

function showFolderPath(name) {
  const el = document.getElementById('folderPath');
  el.textContent = name;
  el.classList.remove('not-set');
}

// ─── Main popup logic ────────────────────────────────────────────────────────

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
    document.getElementById('folderSection').style.display = 'none';
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

  // Init folder UI
  await initFolderUI();
});

// Folder picker button
document.getElementById('folderPickBtn').addEventListener('click', async () => {
  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    dirHandle = handle;
    await saveDirHandle(handle);
    showFolderPath(handle.name);
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.error('Magpie: folder pick error:', err);
      document.getElementById('folderPath').textContent = 'Error: ' + err.message;
      document.getElementById('folderPath').classList.remove('not-set');
    }
  }
});

// Start button
document.getElementById('startBtn').addEventListener('click', async () => {
  if (!activeTabId || !currentPlatform) return;

  // If we have a dir handle, ensure read/write permission (this is a user gesture)
  if (dirHandle) {
    try {
      const perm = await dirHandle.requestPermission({ mode: 'readwrite' });
      if (perm !== 'granted') {
        dirHandle = null;
        showFolderPath('Permission denied — will download instead');
      }
    } catch (err) {
      console.warn('Magpie: dir permission error:', err);
      dirHandle = null;
    }
  }

  // Seed dedup from existing file (if dir handle is set)
  if (dirHandle) {
    try {
      const filename = getFilename(currentPlatform);
      const content = await readExistingFile(dirHandle, filename);
      if (content) {
        const urls = parseUrlsFromMarkdown(content);
        if (urls.length > 0) {
          await addUrls(currentPlatform, urls);
          console.log('Magpie: seeded', urls.length, 'URLs from existing file');
        }
      }
    } catch (err) {
      console.warn('Magpie: could not seed dedup from file:', err);
    }
  }

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

    const posts = msg.posts || [];

    if (posts.length > 0) {
      // Write to file or download
      try {
        if (dirHandle) {
          document.getElementById('statusText').textContent = 'Writing to file...';
          const result = await appendToFile(dirHandle, currentPlatform, posts);
          document.getElementById('statusText').textContent = isDone
            ? `Done! Added ${result.added} new posts (${result.total} total).`
            : `Stopped. Added ${result.added} posts (${result.total} total).`;
          document.getElementById('countText').textContent =
            `Saved to ${getFilename(currentPlatform)}`;
        } else {
          // Fallback: download file
          downloadFallback(currentPlatform, posts);
          document.getElementById('statusText').textContent = isDone
            ? `Done! Extracted ${posts.length} new posts.`
            : `Stopped. Extracted ${posts.length} posts.`;
          document.getElementById('countText').textContent =
            'Markdown file download should appear shortly.';
        }
      } catch (err) {
        console.error('Magpie: file write/download error:', err);
        // Try fallback download if file write failed
        try { downloadFallback(currentPlatform, posts); } catch (e) { /* give up */ }
        document.getElementById('statusText').textContent = isDone
          ? `Done! Extracted ${posts.length} new posts (file write failed, downloaded instead).`
          : `Stopped. Extracted ${posts.length} posts (file write failed, downloaded instead).`;
        document.getElementById('countText').textContent =
          'Markdown file download should appear shortly.';
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
