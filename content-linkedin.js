// content-linkedin.js — Extract saved posts from linkedin.com/my-items/saved-posts/
// Injected on all linkedin.com pages (LinkedIn is a SPA)

(() => {
  let stopRequested = false;
  let isExtracting = false;
  let port = null;

  console.log('Magpie: content-linkedin.js loaded on', window.location.href);

  chrome.runtime.onConnect.addListener((incomingPort) => {
    if (incomingPort.name !== 'magpie') return;
    console.log('Magpie: popup connected (linkedin)');
    port = incomingPort;

    port.onMessage.addListener((msg) => {
      if (msg.action === 'start' && !isExtracting) {
        startExtraction();
      } else if (msg.action === 'stop') {
        stopRequested = true;
      } else if (msg.action === 'status') {
        port.postMessage({
          action: isExtracting ? 'extracting' : 'idle',
          platform: 'linkedin'
        });
      }
    });

    port.onDisconnect.addListener(() => {
      port = null;
    });
  });

  function sendProgress(status, newCount, totalScanned) {
    const msg = { action: 'progress', platform: 'linkedin', status, newCount, totalScanned };
    if (port) {
      try { port.postMessage(msg); } catch (e) { /* popup closed */ }
    }
  }

  function sendDone(newCount, stopped) {
    const msg = { action: stopped ? 'stopped' : 'done', platform: 'linkedin', newCount };
    if (port) {
      try { port.postMessage(msg); } catch (e) { /* popup closed */ }
    }
  }

  async function startExtraction() {
    // Verify we're on the saved posts page
    if (!window.location.href.includes('/my-items/saved-posts')) {
      sendProgress('Not on saved posts page. Navigate to linkedin.com/my-items/saved-posts first.', 0, 0);
      sendDone(0, true);
      return;
    }

    isExtracting = true;
    stopRequested = false;

    const existingUrls = await getStoredUrls('linkedin');
    const knownUrls = new Set(existingUrls);
    const processedUrls = new Set();
    const extractedPosts = [];
    let totalScanned = 0;

    sendProgress('Starting extraction...', 0, 0);

    let hasMore = true;
    while (hasMore && !stopRequested) {
      // Find the main post list
      const items = findPostItems();
      if (!items || items.length === 0) {
        sendProgress('No posts found on this page.', 0, 0);
        break;
      }

      let foundNewThisRound = false;

      for (const li of items) {
        if (stopRequested) break;

        try {
          const postUrl = extractPostUrl(li);
          if (!postUrl || processedUrls.has(postUrl)) continue;

          processedUrls.add(postUrl);
          totalScanned++;

          if (knownUrls.has(postUrl)) continue;

          const post = extractPost(li, postUrl);
          if (post) {
            extractedPosts.push(post);
            foundNewThisRound = true;
            sendProgress(
              'Collecting posts...',
              extractedPosts.length,
              totalScanned
            );
          }
        } catch (err) {
          console.warn('Magpie: Failed to extract LinkedIn post:', err);
        }
      }

      // Try to load more
      const showMoreBtn = findShowMoreButton();
      if (showMoreBtn && !stopRequested) {
        sendProgress('Loading more posts...', extractedPosts.length, totalScanned);
        showMoreBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(500);
        showMoreBtn.click();
        await sleep(2500);
      } else {
        hasMore = false;
      }

      await sleep(500);
    }

    // Generate markdown and download directly from content script
    // (bypasses service worker — more reliable in MV3)
    if (extractedPosts.length > 0) {
      sendProgress('Generating export...', extractedPosts.length, totalScanned);

      console.log('Magpie: generating markdown for', extractedPosts.length, 'LinkedIn posts');

      const date = new Date().toISOString().slice(0, 10);
      const mdContent = generateLinkedInMarkdown(extractedPosts, date);
      const filename = `magpie_linkedin_${date}.md`;

      console.log('Magpie: markdown generated,', mdContent.length, 'chars. Triggering download...');
      downloadFromContentScript(mdContent, filename);

      const newUrls = extractedPosts.map(p => p['Post URL']);
      await addUrls('linkedin', newUrls);
    }

    sendDone(extractedPosts.length, stopRequested);
    isExtracting = false;
    stopRequested = false;
  }

  function findPostItems() {
    const mainRegion = document.querySelector('main');
    if (!mainRegion) return [];

    const lists = mainRegion.querySelectorAll('ul');
    let bestList = null;
    let bestCount = 0;

    for (const ul of lists) {
      const lis = ul.querySelectorAll(':scope > li');
      const hasProfileLinks = ul.querySelector('a[href*="/in/"], a[href*="/company/"]');
      if (lis.length > bestCount && hasProfileLinks) {
        bestList = ul;
        bestCount = lis.length;
      }
    }

    return bestList ? bestList.querySelectorAll(':scope > li') : [];
  }

  function findShowMoreButton() {
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      const text = btn.textContent.trim().toLowerCase();
      if (text.includes('show more results') || text.includes('show more')) {
        return btn;
      }
    }
    return null;
  }

  function extractPostUrl(li) {
    // Look for activity URL
    const links = li.querySelectorAll('a[href]');
    for (const link of links) {
      const href = link.getAttribute('href');
      if (href && href.includes('urn:li:activity:')) {
        const match = href.match(/(https:\/\/www\.linkedin\.com\/feed\/update\/urn:li:activity:\d+)/);
        if (match) return match[1];
      }
    }

    // Fallback: look for any feed/update link
    for (const link of links) {
      const href = link.getAttribute('href');
      if (href && href.includes('/feed/update/')) {
        return href.split('?')[0];
      }
    }

    return null;
  }

  function extractPost(li, postUrl) {
    const result = {
      'Author Name': '',
      'Author Headline': '',
      'Author Profile URL': '',
      'Post URL': postUrl,
      'Timestamp': '',
      'Post Type': 'post',
      'Is Repost': false,
      'Reposted From': '',
      'Preview Text': '',
      'Attached Article Title': '',
      'Attached Article Domain': ''
    };

    // Author name and profile URL
    const profileLinks = li.querySelectorAll('a[href*="/in/"], a[href*="/company/"]');
    // Use the second profile link if available (first is often the actor image)
    const authorLink = profileLinks.length >= 2 ? profileLinks[1] : profileLinks[0];
    if (authorLink) {
      result['Author Profile URL'] = authorLink.href.split('?')[0];

      // Author name: first meaningful span inside the link
      const spans = authorLink.querySelectorAll('span');
      for (const span of spans) {
        const text = span.textContent.trim();
        if (text &&
            text.length > 1 &&
            !text.toLowerCase().includes('view') &&
            !text.toLowerCase().includes('profile')) {
          result['Author Name'] = text;
          break;
        }
      }

      // Check if company post
      if (authorLink.href.includes('/company/')) {
        result['Post Type'] = 'company_post';
      }
    }

    // Author headline: look for a span with job-title-like content
    const allSpans = li.querySelectorAll('span');
    const titleKeywords = /\b(CEO|CTO|COO|CFO|VP|Director|Manager|Engineer|Developer|Designer|Counsel|Partner|Founder|President|Head|Lead|Analyst|Consultant|Professor|Researcher)\b/i;
    for (const span of allSpans) {
      const text = span.textContent.trim();
      if (text.length >= 15 && text.length <= 200 && titleKeywords.test(text)) {
        result['Author Headline'] = text;
        break;
      }
    }

    // Timestamp: span matching pattern like "3d", "1w", "2mo" followed by content
    for (const span of allSpans) {
      const text = span.textContent.trim();
      // Match patterns like "3d Visible to", "1w •", "2mo", etc.
      const timeMatch = text.match(/^(\d+[hdwmy]o?)\b/);
      if (timeMatch) {
        result['Timestamp'] = timeMatch[1];
        break;
      }
    }

    // Repost detection
    for (const span of allSpans) {
      const text = span.textContent.trim();
      if (text.includes('Reposted from')) {
        result['Is Repost'] = true;
        result['Post Type'] = 'repost';
        const repostMatch = text.match(/Reposted from (.+?)(?:\s*[•·]|$)/);
        if (repostMatch) {
          result['Reposted From'] = repostMatch[1].trim();
        }
        break;
      }
    }

    // Preview text
    const contentEl = li.querySelector('p[class*="content-summary"]');
    if (contentEl) {
      // Get text but exclude the "see more" button text
      let text = '';
      for (const node of contentEl.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          text += node.textContent;
        } else if (node.nodeType === Node.ELEMENT_NODE && node.tagName !== 'BUTTON') {
          text += node.textContent;
        }
      }
      result['Preview Text'] = text.trim()
        .replace(/\.\.\.see more$/i, '')
        .replace(/…see more$/i, '')
        .substring(0, 300);
    }

    // Attached article title and domain
    const activityLinks = li.querySelectorAll('a[href*="urn:li:activity:"]');
    for (const link of activityLinks) {
      if (link.querySelector('img')) {
        const innerText = link.innerText || '';
        const parts = innerText.split('\n').filter(p =>
          p.trim() &&
          !p.trim().includes('Image preview') &&
          !p.trim().includes('View Video')
        );

        if (parts.length > 0) {
          const lastPart = parts[parts.length - 1].trim();
          const isDomain = /^[a-z0-9][-a-z0-9]*\.[a-z]{2,}/i.test(lastPart);

          if (isDomain && parts.length > 1) {
            result['Attached Article Title'] = parts.slice(0, -1).join(' ').trim();
            result['Attached Article Domain'] = lastPart;
          } else {
            result['Attached Article Title'] = parts.join(' ').trim();
          }
        }
        break;
      }
    }

    // Detect article_share if not already categorized
    if (result['Post Type'] === 'post' && result['Attached Article Title']) {
      result['Post Type'] = 'article_share';
    }

    return result;
  }

  // --- Markdown generation (local to content script) ---

  const LINKEDIN_MD_COLUMNS = [
    { header: 'Author', key: 'Author Name' },
    { header: 'Profile', key: 'Author Profile URL' },
    { header: 'Post URL', key: 'Post URL' },
    { header: 'Type', key: 'Post Type' },
    { header: 'Timestamp', key: 'Timestamp' },
    { header: 'Preview', key: 'Preview Text' }
  ];

  function generateLinkedInMarkdown(rows, date) {
    const lines = [];
    lines.push(`# Magpie Export -- LinkedIn Saved Posts`);
    lines.push(`**Exported:** ${date}  `);
    lines.push(`**New bookmarks in this batch:** ${rows.length}`);
    lines.push('');
    lines.push('| ' + LINKEDIN_MD_COLUMNS.map(c => c.header).join(' | ') + ' |');
    lines.push('| ' + LINKEDIN_MD_COLUMNS.map(() => '---').join(' | ') + ' |');
    for (const row of rows) {
      const cells = LINKEDIN_MD_COLUMNS.map(c => escapeMarkdownCell(row[c.key]));
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

  function downloadFromContentScript(content, filename) {
    try {
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      console.log('Magpie: download triggered from content script for', filename);
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 5000);
    } catch (err) {
      console.error('Magpie: content script download failed:', err);
    }
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
})();
