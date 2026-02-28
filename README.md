# Magpie

A Chrome extension that exports your saved/bookmarked posts from Twitter/X and LinkedIn as Markdown files — perfect for your Obsidian vault or any note-taking system.

## Features

- **Twitter/X Bookmarks** — Extracts all bookmarked tweets with author, handle, URL, type, timestamp, and preview text
- **LinkedIn Saved Posts** — Extracts all saved posts with author, profile URL, post URL, type, timestamp, and preview text
- **Markdown output** — Generates clean `.md` files with a sortable table format
- **Incremental extraction** — Only collects new bookmarks since your last run (deduplication via URL matching)
- **Import existing files** — Re-import a previously exported `.md` file to restore history after reinstalling
- **Stop and resume** — Stop extraction at any time and get a partial export

## Install

### From source (developer mode)

1. Clone this repo:
   ```
   git clone https://github.com/anitasrinivasan/magpie.git
   ```
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** (toggle in top right)
4. Click **Load unpacked** and select the `magpie` folder

## Usage

1. Navigate to one of the supported pages:
   - **Twitter/X:** `x.com/i/bookmarks`
   - **LinkedIn:** `linkedin.com/my-items/saved-posts`
2. Click the Magpie extension icon to open the popup
3. Click **Start Extraction**
4. When complete, a Save As dialog appears — save the `.md` file to your preferred location
5. On subsequent runs, Magpie stops as soon as it reaches a previously seen bookmark, so only new posts are collected

### Importing existing data

If you reinstall the extension or want to seed from a previous export:

1. Open the Magpie popup on a supported page
2. Click **Import existing file**
3. Select a previously exported `.md` file
4. Run extraction — Magpie will only collect bookmarks newer than what's in the import

## Output format

Magpie generates a Markdown table:

```markdown
# Magpie — Twitter Bookmarks
**Last updated:** 2026-02-28
**Total bookmarks:** 142

| Author | Handle | URL | Type | Timestamp | Preview |
| --- | --- | --- | --- | --- | --- |
| Jane Doe | @janedoe | https://x.com/janedoe/status/123 | original | 2026-02-28T10:00:00.000Z | This is the tweet text... |
```

## Permissions

- **activeTab** — Access the current tab to extract bookmarks
- **storage** — Store bookmark data locally for deduplication
- **downloads** — Trigger the Save As dialog for exporting files

## License

MIT
