const CAPTURE_BRIDGE_SCRIPT_ID = 'ai-url-extractor-capture-bridge';
const CAPTURE_HOOK_SCRIPT_ID = 'ai-url-extractor-capture-hook';
const CAPTURE_PAYLOAD_PREFIX = 'aiUrlExtractorCapturePayload:';

function getCapturePayloadKey(tabId) {
    return `${CAPTURE_PAYLOAD_PREFIX}${tabId}`;
}

async function unregisterCaptureScripts() {
    try {
        await chrome.scripting.unregisterContentScripts({
            ids: [CAPTURE_BRIDGE_SCRIPT_ID, CAPTURE_HOOK_SCRIPT_ID]
        });
    } catch {
        // The scripts may not be registered yet.
    }
}

async function registerCaptureScripts(originPattern) {
    await unregisterCaptureScripts();
    await chrome.scripting.registerContentScripts([
        {
            id: CAPTURE_BRIDGE_SCRIPT_ID,
            matches: [originPattern],
            js: ['capture-bridge.js'],
            runAt: 'document_start',
            persistAcrossSessions: false
        },
        {
            id: CAPTURE_HOOK_SCRIPT_ID,
            matches: [originPattern],
            js: ['capture-hook.js'],
            runAt: 'document_start',
            world: 'MAIN',
            persistAcrossSessions: false
        }
    ]);
}

async function injectCaptureScriptsNow(tabId) {
    await chrome.scripting.executeScript({
        target: { tabId },
        files: ['capture-bridge.js']
    });
    await chrome.scripting.executeScript({
        target: { tabId },
        files: ['capture-hook.js'],
        world: 'MAIN'
    });
}

async function armPageCapture(tabId, platform) {
    await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        args: [platform],
        func: (capturePlatform) => {
            sessionStorage.setItem('aiUrlExtractorCaptureArmed', JSON.stringify({
                platform: capturePlatform,
                armedAt: Date.now(),
                expiresAt: Date.now() + 3 * 60 * 1000
            }));
            sessionStorage.removeItem('aiUrlExtractorCapturedPayload');
        }
    });
}

async function storeCapturedPayload(tabId, payload) {
    const key = getCapturePayloadKey(tabId);
    const existing = (await chrome.storage.local.get(key))[key];

    if (existing && Number(existing.score || 0) > Number(payload.score || 0)) {
        return;
    }

    await chrome.storage.local.set({
        [key]: {
            ...payload,
            tabId,
            storedAt: new Date().toISOString()
        }
    });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
        if (message?.type === 'START_FULL_CAPTURE') {
            const { tabId, originPattern, platform } = message;

            if (!tabId || !originPattern || !platform) {
                throw new Error('Missing tab, origin, or platform for capture.');
            }

            await registerCaptureScripts(originPattern);
            await armPageCapture(tabId, platform);
            await injectCaptureScriptsNow(tabId);

            let reloadError = null;
            try {
                await chrome.tabs.reload(tabId);
            } catch (error) {
                reloadError = error.message;
            }

            return {
                ok: true,
                reloaded: !reloadError,
                reloadError
            };
        }

        if (message?.type === 'CAPTURED_RESPONSE') {
            const tabId = sender.tab?.id;
            if (!tabId) {
                throw new Error('Captured response did not include a tab.');
            }

            await storeCapturedPayload(tabId, message.payload);

            // Privacy: once we have the conversation payload we no longer need the
            // capture scripts to re-inject on future navigations. The instance already
            // running in the current page keeps refining the stored payload (its
            // fetch/XHR patch stays live for this page load), but unregistering here
            // guarantees capture is not "always-on" across later page loads.
            await unregisterCaptureScripts();
            return { ok: true };
        }

        if (message?.type === 'GET_CAPTURED_PAYLOAD') {
            const key = getCapturePayloadKey(message.tabId);
            const payload = (await chrome.storage.local.get(key))[key] || null;
            return { ok: true, payload };
        }

        if (message?.type === 'CLEAR_CAPTURED_PAYLOAD') {
            await chrome.storage.local.remove(getCapturePayloadKey(message.tabId));
            await unregisterCaptureScripts();
            return { ok: true };
        }

        return { ok: false, error: 'Unknown message type.' };
    })()
        .then((response) => sendResponse(response))
        .catch((error) => sendResponse({ ok: false, error: error.message }));

    return true;
});
