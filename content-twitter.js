// content-twitter.js — Extract bookmarked tweets from x.com/i/bookmarks
// Injected on all x.com pages (Twitter is a SPA, so we need broad matching)

(() => {
  let stopRequested = false;
  let isExtracting = false;
  let port = null;

  console.log('Magpie: content-twitter.js loaded on', window.location.href);

  // Listen for port connections from popup
  chrome.runtime.onConnect.addListener((incomingPort) => {
    if (incomingPort.name !== 'magpie') return;
    console.log('Magpie: popup connected');
    port = incomingPort;

    port.onMessage.addListener((msg) => {
      console.log('Magpie: received message', msg);
      if (msg.action === 'start' && !isExtracting) {
        startExtraction();
      } else if (msg.action === 'stop') {
        stopRequested = true;
      } else if (msg.action === 'status') {
        port.postMessage({
          action: isExtracting ? 'extracting' : 'idle',
          platform: 'twitter'
        });
      }
    });

    port.onDisconnect.addListener(() => {
      port = null;
    });
  });

  function sendProgress(status, newCount, totalScanned) {
    const msg = { action: 'progress', platform: 'twitter', status, newCount, totalScanned };
    if (port) {
      try { port.postMessage(msg); } catch (e) { /* popup closed */ }
    }
  }

  function sendDone(newCount, stopped) {
    const msg = { action: stopped ? 'stopped' : 'done', platform: 'twitter', newCount };
    if (port) {
      try { port.postMessage(msg); } catch (e) { /* popup closed */ }
    }
  }

  async function startExtraction() {
    // Verify we're on the bookmarks page
    if (!window.location.href.includes('/i/bookmarks')) {
      sendProgress('Not on bookmarks page. Navigate to x.com/i/bookmarks first.', 0, 0);
      sendDone(0, true);
      return;
    }

    isExtracting = true;
    stopRequested = false;

    console.log('Magpie: starting extraction');

    const existingUrls = await getStoredUrls('twitter');
    const knownUrls = new Set(existingUrls);
    const processedUrls = new Set();
    const extractedPosts = [];
    let noNewRounds = 0;
    let totalScanned = 0;

    sendProgress('Starting extraction...', 0, 0);

    while (noNewRounds < 5 && !stopRequested) {
      const articles = document.querySelectorAll('article');
      let foundNew = false;

      for (const article of articles) {
        if (stopRequested) break;

        try {
          const tweetUrl = extractTweetUrl(article);
          if (!tweetUrl || processedUrls.has(tweetUrl)) continue;

          processedUrls.add(tweetUrl);
          totalScanned++;

          // Skip if already in storage (dedup)
          if (knownUrls.has(tweetUrl)) continue;

          const post = extractTweet(article, tweetUrl);
          if (post) {
            extractedPosts.push(post);
            foundNew = true;
            sendProgress(
              `Collecting tweets...`,
              extractedPosts.length,
              totalScanned
            );
          }
        } catch (err) {
          console.warn('Magpie: Failed to extract tweet:', err);
        }
      }

      if (!foundNew) {
        noNewRounds++;
        console.log('Magpie: no new tweets this round, noNewRounds =', noNewRounds);
      } else {
        noNewRounds = 0;
      }

      if (noNewRounds >= 5 || stopRequested) break;

      // Scroll down for more tweets
      sendProgress('Scrolling for more tweets...', extractedPosts.length, totalScanned);
      scrollDown();
      await sleep(1500);

      // Small delay between rounds
      await sleep(500);
    }

    console.log('Magpie: extraction loop finished. Extracted:', extractedPosts.length);

    // Send data to background for download
    if (extractedPosts.length > 0) {
      sendProgress('Generating export...', extractedPosts.length, totalScanned);

      chrome.runtime.sendMessage({
        action: 'downloadExport',
        platform: 'twitter',
        data: extractedPosts
      });

      // Save new URLs to storage for dedup on next run
      const newUrls = extractedPosts.map(p => p['Tweet URL']);
      await addUrls('twitter', newUrls);
    }

    sendDone(extractedPosts.length, stopRequested);
    isExtracting = false;
    stopRequested = false;
  }

  function scrollDown() {
    // Try multiple scroll methods — Twitter's layout can vary
    // Method 1: scroll the primary column container
    const primaryColumn = document.querySelector('[data-testid="primaryColumn"]');
    if (primaryColumn) {
      const scrollable = primaryColumn.closest('[style*="overflow"]') ||
                         primaryColumn.parentElement;
      if (scrollable && scrollable.scrollHeight > scrollable.clientHeight) {
        scrollable.scrollTop = scrollable.scrollHeight;
        return;
      }
    }

    // Method 2: standard window scroll
    window.scrollTo(0, document.body.scrollHeight);

    // Method 3: also try scrolling the document element
    document.documentElement.scrollTop = document.documentElement.scrollHeight;
  }

  function extractTweetUrl(article) {
    // Find the status link that has a <time> child — this is the main tweet permalink
    const statusLinks = article.querySelectorAll('a[href*="/status/"]');
    for (const link of statusLinks) {
      if (link.querySelector('time')) {
        const href = link.getAttribute('href');
        return href.startsWith('http') ? href : 'https://x.com' + href;
      }
    }
    // Fallback: first status link
    if (statusLinks.length > 0) {
      const href = statusLinks[0].getAttribute('href');
      return href.startsWith('http') ? href : 'https://x.com' + href;
    }
    return null;
  }

  function extractTweet(article, tweetUrl) {
    const result = {
      'Author Name': '',
      'Author Handle': '',
      'Tweet URL': tweetUrl,
      'Tweet Type': 'original',
      'Quoted Tweet URL': '',
      'Is Thread': false,
      'Timestamp': '',
      'Preview Text': ''
    };

    // Author name and handle from [data-testid="User-Name"]
    const userNameEl = article.querySelector('[data-testid="User-Name"]');
    if (userNameEl) {
      // Handle is in an anchor whose href starts with /
      const handleLinks = userNameEl.querySelectorAll('a[href^="/"]');
      for (const link of handleLinks) {
        const href = link.getAttribute('href');
        if (href && href.match(/^\/[a-zA-Z0-9_]+$/)) {
          result['Author Handle'] = '@' + href.slice(1);
          break;
        }
      }

      // Display name: first span that isn't the handle or a symbol
      const spans = userNameEl.querySelectorAll('span');
      for (const span of spans) {
        const text = span.textContent.trim();
        if (text &&
            !text.startsWith('@') &&
            !text.includes('·') &&
            text !== '·' &&
            text.length > 0 &&
            span.closest('[data-testid="User-Name"]') === userNameEl) {
          if (span.querySelector('span') === null || span.children.length === 0) {
            result['Author Name'] = text;
            break;
          }
        }
      }
    }

    // Tweet text
    const tweetTextEl = article.querySelector('[data-testid="tweetText"]');
    if (tweetTextEl) {
      result['Preview Text'] = tweetTextEl.textContent.trim().substring(0, 500);
    }

    // Timestamp
    const timeEl = article.querySelector('time[datetime]');
    if (timeEl) {
      result['Timestamp'] = timeEl.getAttribute('datetime');
    }

    // Tweet type detection
    const hasQuote = article.querySelector('[data-testid="quoteTweet"]') !== null;
    const hasReplyTo = article.textContent.includes('Replying to');
    const articleText = article.textContent;
    const isThread = articleText.includes('Show this thread');
    result['Is Thread'] = isThread;

    if (hasReplyTo && hasQuote) {
      result['Tweet Type'] = 'quote+reply';
    } else if (hasQuote) {
      result['Tweet Type'] = 'quote';
    } else if (hasReplyTo) {
      result['Tweet Type'] = 'reply';
    } else if (isThread) {
      result['Tweet Type'] = 'thread';
    } else {
      result['Tweet Type'] = 'original';
    }

    // Quoted tweet URL
    if (hasQuote) {
      const quoteContainer = article.querySelector('[data-testid="quoteTweet"]');
      if (quoteContainer) {
        const quoteLink = quoteContainer.querySelector('a[href*="/status/"]');
        if (quoteLink) {
          const href = quoteLink.getAttribute('href');
          result['Quoted Tweet URL'] = href.startsWith('http') ? href : 'https://x.com' + href;
        }
      }
    }

    return result;
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
})();
