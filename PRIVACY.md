# Privacy Policy — Fanout Queries Extractor (ChatGPT & Claude)

_Last updated: 2026-07-06_

## Summary

AI URL Extractor is a privacy-respecting Chrome extension. It does **not** collect, sell, or transmit data to extension-owned servers or analytics services. All extraction and analytics processing happens locally in your browser.

## What the extension does

You can either click **Capture Full JSON** on an open ChatGPT or Claude conversation, or manually paste a JSON response copied from your own browser's DevTools Network tab into the extension popup. Full capture is user-triggered: the extension arms the active tab, reloads it once, captures conversation-shaped JSON responses from that page, then parses the captured JSON locally.

The popup also includes an optional **"Buy me a coffee"** button. Clicking it simply opens an external Razorpay-hosted payment page (`razorpay.me`) in a new browser tab. The extension makes no payment API calls and never sees, receives, or stores any payment or card details — the entire transaction is handled by Razorpay on their own page. The button is purely a voluntary tip; no feature of the extension is gated behind it.

## What data is stored

The extension uses Chrome's `chrome.storage.local` API to save the following data **on your device only**:

| Data | Purpose |
| --- | --- |
| Extracted URLs, titles, snippets, domains, publication dates | Display the URL table and analytics |
| Conversation title and conversation ID from fetched or pasted JSON | Group URLs by conversation |
| Optional "tracked domain" string you enter | Show your domain's citation share |

This data never leaves your computer.

## What data is NOT collected

- No telemetry or usage analytics
- No crash reporting
- No advertising identifiers
- No cookie collection, no separate login, no account with this extension
- No personally identifiable information beyond what is already inside the JSON you choose to capture or paste
- No always-on network monitoring
- No network requests to external services controlled by this extension. Automatic capture only observes the open ChatGPT or Claude site after you click the extension.

## Permissions explained

The extension requests these permissions:

- **`storage`** — required so that extracted URLs persist between popup opens. This permission only grants access to the extension's own private storage area on your device. It does not provide access to your browsing history, cookies, or any other websites' data.
- **`activeTab`** — grants temporary access to the active browser tab only after you click the extension. Access is limited to that user-triggered session.
- **`scripting`** — lets the extension inject capture scripts into the active ChatGPT or Claude conversation tab after you click the extension.

The extension also declares host permissions for `chatgpt.com`, `chat.openai.com`, and `claude.ai`. These are limited to the supported sites and are used to arm full capture after you click the extension. The extension does **not** request `webRequest`, `debugger`, `cookies`, browsing history, or always-on background access.

## Clearing your data

Open the extension popup and click **Clear**. This deletes everything the extension has stored. You can also remove all stored data by uninstalling the extension from `chrome://extensions`.

## Open source

The full source code is available so anyone can verify these claims.

## Contact

Questions or concerns about this privacy policy: **aashish.m@zohocorp.com**

## Changes

If this policy materially changes, the updated date at the top will reflect that and the new version will ship with the next extension update on the Chrome Web Store.
