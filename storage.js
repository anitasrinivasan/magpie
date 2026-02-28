// storage.js — Shared chrome.storage.local wrapper for deduplication

const STORAGE_KEYS = {
  twitter: {
    urls: 'magpie_twitter_urls',
    lastRun: 'magpie_twitter_last_run',
    total: 'magpie_twitter_total_count'
  },
  linkedin: {
    urls: 'magpie_linkedin_urls',
    lastRun: 'magpie_linkedin_last_run',
    total: 'magpie_linkedin_total_count'
  }
};

async function getStoredUrls(platform) {
  const key = STORAGE_KEYS[platform].urls;
  const result = await chrome.storage.local.get(key);
  return result[key] || [];
}

async function addUrls(platform, newUrls) {
  const keys = STORAGE_KEYS[platform];
  const existing = await getStoredUrls(platform);
  const urlSet = new Set(existing);
  let added = 0;

  for (const url of newUrls) {
    if (!urlSet.has(url)) {
      urlSet.add(url);
      added++;
    }
  }

  const allUrls = Array.from(urlSet);

  try {
    await chrome.storage.local.set({
      [keys.urls]: allUrls,
      [keys.lastRun]: new Date().toISOString(),
      [keys.total]: allUrls.length
    });
  } catch (err) {
    if (err.message && err.message.includes('QUOTA')) {
      throw new Error('Storage full. Consider clearing old data from Magpie settings.');
    }
    throw err;
  }

  return { added, total: allUrls.length };
}

async function getStats(platform) {
  const keys = STORAGE_KEYS[platform];
  const result = await chrome.storage.local.get([keys.total, keys.lastRun]);
  return {
    totalExtracted: result[keys.total] || 0,
    lastRun: result[keys.lastRun] || null
  };
}

async function clearStorage(platform) {
  const keys = STORAGE_KEYS[platform];
  await chrome.storage.local.remove([keys.urls, keys.lastRun, keys.total]);
}
