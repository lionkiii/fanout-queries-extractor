# Fanout Queries Extractor — ChatGPT & Claude

A Chrome extension that extracts cited URLs from ChatGPT and Claude conversations. Click the extension on an open conversation to capture the full conversation JSON during a reload, or paste a raw JSON response copied from DevTools Network as a fallback. The extension parses every cited URL, ranks domains, and shows source-type / freshness / search-intent analytics — all locally in your browser.

## Features

- Extracts cited URLs from both ChatGPT and Claude conversation JSON
- User-triggered full JSON capture from the active ChatGPT or Claude conversation tab
- Manual paste workflow remains available as a fallback
- Per-question grouping with search intent and search-query metadata
- Top-cited-domain leaderboard
- Source-type breakdown (news / search / academia / reddit / youtube)
- Content freshness analysis based on publication dates
- "Your domain" tracking — see your citation share across all extracted conversations
- CSV / JSON / clipboard export
- Automatic light + dark theme that follows your system preference
- 100% local processing: no telemetry, no account, and no extension-owned servers

## Install

### From the Chrome Web Store

_(Pending publication — install link will appear here once approved.)_

### Unpacked (development)

1. `git clone` (or download) this folder
2. Open `chrome://extensions`
3. Toggle **Developer mode** (top right)
4. Click **Load unpacked** and select the `chatgpt-url-extractor` folder
5. Pin the extension from the Chrome toolbar menu for easy access

## How to use

The extension supports two workflows:

- **Capture full JSON** — open a ChatGPT or Claude conversation, click the extension, then click **Capture Full JSON**. The tab reloads once; reopen the popup after the page finishes loading to import the captured JSON.
- **Manual paste fallback** — copy the conversation JSON from DevTools Network, paste it into the textarea, then click **Extract URLs from JSON**.

The extension does not run always-on capture. It only arms the active ChatGPT/Claude tab after you click the extension.

### From ChatGPT

1. Open the ChatGPT conversation you want to extract from in your browser
2. Open the extension popup
3. Click **Capture Full JSON**
4. Wait for the tab to reload, then reopen the extension popup
5. If capture fails, use the manual paste fallback: DevTools → Network → find the conversation JSON response → copy JSON → paste it into the extension

### From Claude

1. Open the Claude conversation in your browser
2. Open the extension popup
3. Click **Capture Full JSON**
4. Wait for the tab to reload, then reopen the extension popup
5. If capture fails, use the manual paste fallback: DevTools → Network → find the request that returns the full conversation JSON with `chat_messages` → copy JSON → paste it into the extension

### Export

- **Copy** — copies a tab-separated table to the clipboard, ready to paste into Excel or Google Sheets
- **CSV** — downloads a comma-separated file
- **JSON** — downloads the full structured data

### Track your domain

In the **Analytics Dashboard**, enter your domain (e.g. `example.com`) and click **Track**. The extension counts how often that domain (or any of its subdomains) appears across all stored extractions and shows your citation share.

## What data is stored

Everything stays in `chrome.storage.local` on your device. Automatic capture uses your current active ChatGPT or Claude tab only after you click the extension. See [PRIVACY.md](./PRIVACY.md) for the full disclosure.

| Stored | Purpose |
| --- | --- |
| Extracted URLs, titles, snippets, domains, publication dates | Render the URL table and analytics |
| Conversation title and ID from fetched or pasted JSON | Group URLs per conversation |
| Optional tracked-domain string | Compute your citation share |

Click **Clear** in the popup to wipe everything.

## Permissions

The extension declares these permissions:

- `storage` — to persist extracted URLs between popup opens
- `scripting` — to inject the user-triggered capture scripts into the active ChatGPT or Claude conversation tab

- Host permissions for `chatgpt.com`, `chat.openai.com`, and `claude.ai` — to arm capture on those specific sites only after you click the extension

It does **not** request browsing history, `webRequest`, `debugger`, or `cookies`.

## Support

If this extension is useful to you, there's an optional **☕ Buy me a coffee** button in the popup header that opens a [Razorpay](https://razorpay.me/@ishort) tip page in a new tab. It's entirely voluntary — every feature is free and nothing is gated behind it.

## Troubleshooting

**Nothing happens when I click Extract.** Make sure the textarea contains valid JSON. Open DevTools → Console (with the popup focused, right-click the popup → Inspect) for the parser's error toast.

**Capture says the Chrome scripting API is unavailable.** Reload the unpacked extension from `chrome://extensions` after updating it. Chrome only applies new permissions such as `scripting` after the extension is reloaded.

**Capture does not import anything after reload.** Reopen the popup after the conversation finishes loading. If it still does not import, use manual paste; the site may have changed its response format or loaded the conversation before the capture hook was armed.

**The conversation parsed but no URLs were found.** The conversation may not have triggered a web search. ChatGPT only shows citations when the search tool ran; Claude only includes `web_search` tool results when that tool fired.

**Wrong domain counted in "Your domain".** Domain matching uses exact match or subdomain suffix match — `example.com` will match `www.example.com` and `blog.example.com` but **not** `notexample.com`.

## Technical details

- Manifest V3
- User-triggered background service worker for capture-on-reload
- Host permission scoped only to ChatGPT/Claude capture
- Active-tab script injection only after a user click
- Pure vanilla JavaScript, no build step, no external dependencies
- All UI styled with system fonts and CSS custom properties for theming
- Automatic dark mode via `prefers-color-scheme`

## Privacy

See [PRIVACY.md](./PRIVACY.md). Short version: fetched conversations are processed locally and nothing is sent to extension-owned servers or third-party analytics.

## License

MIT (or specify your preferred license here).
