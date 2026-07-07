(() => {
    if (window.__aiUrlExtractorCaptureHookInstalled) return;
    window.__aiUrlExtractorCaptureHookInstalled = true;

    const ARMED_KEY = 'aiUrlExtractorCaptureArmed';
    const PAYLOAD_KEY = 'aiUrlExtractorCapturedPayload';
    const SOURCE = 'ai-url-extractor-capture';
    const MAX_SCAN_OBJECTS = 50000;

    function getArmedState() {
        try {
            const raw = sessionStorage.getItem(ARMED_KEY);
            if (!raw) return null;

            const state = JSON.parse(raw);
            if (state.expiresAt && state.expiresAt < Date.now()) {
                sessionStorage.removeItem(ARMED_KEY);
                return null;
            }

            return state;
        } catch {
            return null;
        }
    }

    function inspectPayload(data) {
        const seen = new WeakSet();
        const stack = [data];
        const stats = {
            hasMapping: false,
            hasConversationMapping: false,
            hasChatMessages: false,
            hasWrappedChatMessages: false,
            searchGroupCount: 0,
            searchQueryCount: 0,
            scanned: 0
        };

        while (stack.length > 0 && stats.scanned < MAX_SCAN_OBJECTS) {
            const item = stack.pop();
            if (!item || typeof item !== 'object') continue;
            if (seen.has(item)) continue;
            seen.add(item);
            stats.scanned += 1;

            if (item.mapping && typeof item.mapping === 'object') stats.hasMapping = true;
            if (item.conversation?.mapping && typeof item.conversation.mapping === 'object') {
                stats.hasConversationMapping = true;
            }
            if (Array.isArray(item.chat_messages)) stats.hasChatMessages = true;
            if (Array.isArray(item.chat_conversation?.chat_messages)) {
                stats.hasWrappedChatMessages = true;
            }
            if (Array.isArray(item.search_result_groups)) {
                stats.searchGroupCount += item.search_result_groups.length;
            }
            if (Array.isArray(item.search_model_queries?.queries)) {
                stats.searchQueryCount += item.search_model_queries.queries.length;
            }

            if (
                stats.hasMapping
                && stats.searchGroupCount > 0
                && stats.searchQueryCount > 0
            ) {
                break;
            }

            if (Array.isArray(item)) {
                item.forEach((child) => {
                    if (child && typeof child === 'object') stack.push(child);
                });
            } else {
                Object.keys(item).forEach((key) => {
                    const child = item[key];
                    if (child && typeof child === 'object') stack.push(child);
                });
            }
        }

        const isChatGPT = stats.hasMapping || stats.hasConversationMapping || stats.searchGroupCount > 0 || stats.searchQueryCount > 0;
        const isClaude = stats.hasChatMessages || stats.hasWrappedChatMessages;
        const score =
            (stats.hasMapping ? 6000 : 0)
            + (stats.hasConversationMapping ? 5500 : 0)
            + (stats.hasChatMessages ? 5000 : 0)
            + (stats.hasWrappedChatMessages ? 4800 : 0)
            + (stats.searchGroupCount * 30)
            + (stats.searchQueryCount * 100);

        return {
            match: isChatGPT || isClaude,
            platform: isClaude && !isChatGPT ? 'claude' : 'chatgpt',
            score,
            stats
        };
    }

    function maybeCapture(url, text) {
        const state = getArmedState();
        if (!state || !text || text.length < 20) return;

        let data;
        try {
            data = JSON.parse(text);
        } catch {
            return;
        }

        const inspected = inspectPayload(data);
        if (!inspected.match) return;

        const payload = {
            source: SOURCE,
            type: 'CAPTURED_RESPONSE',
            version: 1,
            platform: state.platform || inspected.platform,
            url: String(url || location.href),
            pageUrl: location.href,
            capturedAt: new Date().toISOString(),
            score: inspected.score + Math.min(Math.floor(text.length / 100000), 50),
            stats: inspected.stats,
            payloadText: text
        };

        try {
            const existing = sessionStorage.getItem(PAYLOAD_KEY);
            if (!existing || Number(JSON.parse(existing).score || 0) <= payload.score) {
                sessionStorage.setItem(PAYLOAD_KEY, JSON.stringify(payload));
            }
        } catch {
            // Large conversations may exceed session storage. The bridge still sends the payload.
        }

        window.postMessage(payload, location.origin);
    }

    const originalFetch = window.fetch;
    if (typeof originalFetch === 'function') {
        window.fetch = async function patchedFetch(...args) {
            const response = await originalFetch.apply(this, args);

            try {
                // Only inspect bodies while the user-armed capture window is open.
                // Once it expires/disarms we do zero reading of page traffic.
                if (!getArmedState()) return response;

                const request = args[0];
                const url = typeof request === 'string' ? request : request?.url;
                const contentType = response.headers?.get?.('content-type') || '';
                const looksRelevant =
                    contentType.includes('json')
                    || String(url || '').includes('conversation')
                    || String(url || '').includes('chat_messages')
                    || String(url || '').includes('backend-api')
                    || String(url || '').includes('/api/');

                if (looksRelevant) {
                    response.clone().text().then((text) => maybeCapture(url, text)).catch(() => {});
                }
            } catch {
                // Do not interfere with the host page.
            }

            return response;
        };
    }

    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function patchedOpen(method, url, ...rest) {
        this.__aiUrlExtractorRequestUrl = url;
        return originalOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function patchedSend(...args) {
        try {
            this.addEventListener('loadend', () => {
                try {
                    if (!getArmedState()) return;
                    if (this.responseType && this.responseType !== 'text') return;
                    maybeCapture(this.__aiUrlExtractorRequestUrl, this.responseText);
                } catch {
                    // Do not interfere with the host page.
                }
            });
        } catch {
            // Do not interfere with the host page.
        }

        return originalSend.apply(this, args);
    };
})();
