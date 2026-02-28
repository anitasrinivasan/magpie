// background.js — Service worker: Markdown generation and file download

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

// Must register listener synchronously at top level (MV3 requirement)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'downloadExport') {
    handleMarkdownDownload(message.platform, message.data);
    sendResponse({ success: true });
  }
  return true;
});

function handleMarkdownDownload(platform, rows) {
  if (!rows || rows.length === 0) return;

  const columns = platform === 'twitter' ? TWITTER_MD_COLUMNS : LINKEDIN_MD_COLUMNS;
  const title = platform === 'twitter' ? 'Twitter Bookmarks' : 'LinkedIn Saved Posts';
  const date = new Date().toISOString().slice(0, 10);
  const mdContent = generateMarkdown(columns, rows, title, date);
  const filename = `magpie_${platform}_${date}.md`;

  const dataUrl = 'data:text/markdown;charset=utf-8,' + encodeURIComponent(mdContent);
  chrome.downloads.download({
    url: dataUrl,
    filename: filename,
    saveAs: true
  });
}

function generateMarkdown(columns, rows, title, date) {
  const lines = [];

  lines.push(`# Magpie Export -- ${title}`);
  lines.push(`**Exported:** ${date}  `);
  lines.push(`**New bookmarks in this batch:** ${rows.length}`);
  lines.push('');

  // Table header
  lines.push('| ' + columns.map(c => c.header).join(' | ') + ' |');
  lines.push('| ' + columns.map(() => '---').join(' | ') + ' |');

  // Data rows
  for (const row of rows) {
    const cells = columns.map(c => escapeMarkdownCell(row[c.key]));
    lines.push('| ' + cells.join(' | ') + ' |');
  }

  lines.push('');
  lines.push('<!-- Append these rows to your main bookmarks file, or keep as a standalone note. -->');

  return lines.join('\n');
}

function escapeMarkdownCell(val) {
  if (val == null || val === false) return '';
  let str = String(val);
  str = str.replace(/[\r\n]+/g, ' ');
  str = str.replace(/\|/g, '\\|');
  str = str.replace(/\s+/g, ' ').trim();
  return str;
}
