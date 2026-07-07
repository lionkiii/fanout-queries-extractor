(() => {
    if (window.__aiUrlExtractorCaptureBridgeInstalled) return;
    window.__aiUrlExtractorCaptureBridgeInstalled = true;

    const SOURCE = 'ai-url-extractor-capture';

    function sendCapturedPayload(payload) {
        if (!payload || payload.source !== SOURCE || payload.type !== 'CAPTURED_RESPONSE') return;
        chrome.runtime.sendMessage({
            type: 'CAPTURED_RESPONSE',
            payload
        }).catch(() => {
            // The popup/background may be reloading; the page hook also keeps a session copy.
        });
    }

    window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        sendCapturedPayload(event.data);
    });

    try {
        const stored = sessionStorage.getItem('aiUrlExtractorCapturedPayload');
        if (stored) sendCapturedPayload(JSON.parse(stored));
    } catch {
        // Session storage is a best-effort backup.
    }
})();
