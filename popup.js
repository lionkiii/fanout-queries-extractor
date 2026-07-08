// AI URL Extractor — popup script

document.addEventListener('DOMContentLoaded', async () => {
    await loadUrls();
    await importCapturedPayloadIfAvailable(true);

    document.getElementById('fetchCurrentTabBtn')?.addEventListener('click', fetchFromCurrentTab);
    document.getElementById('extractFromJsonBtn').addEventListener('click', extractFromJson);
    document.getElementById('copyTableBtn').addEventListener('click', copyTable);
    document.getElementById('exportCsvBtn').addEventListener('click', exportCsv);
    document.getElementById('exportJsonBtn').addEventListener('click', exportJson);
    document.getElementById('clearBtn').addEventListener('click', clearUrls);

    document.getElementById('trackDomainBtn')?.addEventListener('click', trackYourDomain);
    document.getElementById('toggleAnalytics')?.addEventListener('click', toggleAnalytics);

    // Keyboard shortcut: Cmd/Ctrl + Enter inside the textarea triggers extraction
    document.getElementById('jsonInput')?.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            extractFromJson();
        }
    });
});

// ---------- Helpers ----------

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML;
}

function show(el) {
    if (el) el.hidden = false;
}

function hide(el) {
    if (el) el.hidden = true;
}

// Flattens a value into a single spreadsheet-safe line: collapses newlines,
// tabs and repeated whitespace, optionally truncating with an ellipsis.
function sanitizeField(value, maxLength = 0) {
    let text = value == null ? '' : String(value);
    text = text.replace(/\s+/g, ' ').trim();
    if (maxLength > 0 && text.length > maxLength) {
        text = text.slice(0, maxLength - 1).trimEnd() + '…';
    }
    return text;
}

// Safely derive a hostname from a URL, falling back to a provided value.
function getDomain(url, fallback = 'unknown') {
    try {
        return new URL(url).hostname.replace(/^www\./, '');
    } catch {
        return fallback ? String(fallback).replace(/^www\./, '') : 'unknown';
    }
}

// Classify a source into a GEO-relevant bucket from its domain.
// Buckets are intentionally marketer-facing (community, video, social, review…)
// rather than the raw ref types ChatGPT exposes.
const SOURCE_TYPE_RULES = [
    { type: 'reddit', test: (d) => d === 'reddit.com' || d.endsWith('.reddit.com') },
    { type: 'youtube', test: (d) => d === 'youtube.com' || d.endsWith('.youtube.com') || d === 'youtu.be' || d === 'vimeo.com' },
    {
        type: 'social',
        test: (d) => /(^|\.)(x\.com|twitter\.com|linkedin\.com|facebook\.com|instagram\.com|tiktok\.com|threads\.net|pinterest\.com|medium\.com)$/.test(d)
    },
    {
        type: 'forum',
        test: (d) => /(^|\.)(quora\.com|stackoverflow\.com|stackexchange\.com|news\.ycombinator\.com|ycombinator\.com|discord\.com|trustpilot\.com)$/.test(d)
    },
    {
        type: 'review',
        test: (d) => /(^|\.)(g2\.com|capterra\.com|getapp\.com|softwareadvice\.com|producthunt\.com|gartner\.com|sourceforge\.net)$/.test(d)
    },
    {
        type: 'reference',
        test: (d) => /(^|\.)(wikipedia\.org|wikimedia\.org|britannica\.com)$/.test(d)
    },
    {
        type: 'academia',
        test: (d) => d.endsWith('.edu') || /(^|\.)(arxiv\.org|scholar\.google\.com|ncbi\.nlm\.nih\.gov|pubmed\.ncbi\.nlm\.nih\.gov|researchgate\.net|jstor\.org|sciencedirect\.com|springer\.com|nature\.com|wiley\.com|ssrn\.com)$/.test(d)
    },
    {
        type: 'news',
        test: (d) => /(^|\.)(nytimes\.com|wsj\.com|washingtonpost\.com|theguardian\.com|bbc\.com|bbc\.co\.uk|cnn\.com|reuters\.com|bloomberg\.com|forbes\.com|businessinsider\.com|techcrunch\.com|theverge\.com|wired\.com|cnbc\.com|ft\.com|economist\.com|apnews\.com|axios\.com|mashable\.com|engadget\.com|venturebeat\.com)$/.test(d)
    }
];

// Human-readable labels for the marketer-facing source buckets.
const SOURCE_TYPE_LABELS = {
    reddit: 'Reddit',
    forum: 'Forum',
    youtube: 'Video',
    social: 'Social',
    review: 'Review',
    news: 'News',
    reference: 'Reference',
    academia: 'Academia',
    other: 'Web'
};

// Render the Cited / Retrieved status plus the source-type tag for a URL row.
function citationBadge(urlData) {
    const sourceType = urlData.sourceType || classifySourceType(urlData.domain);
    const typeLabel = SOURCE_TYPE_LABELS[sourceType] || 'Web';
    // `cited` undefined (legacy data) is treated as cited so we never hide data.
    const isCited = urlData.cited !== false;
    const statusClass = isCited ? 'citation-badge--cited' : 'citation-badge--retrieved';
    const statusLabel = isCited ? 'Cited' : 'Retrieved';
    return `<span class="citation-badge ${statusClass}">${statusLabel}</span>`
        + `<span class="source-tag source-tag--${sourceType}">${escapeHtml(typeLabel)}</span>`;
}

function classifySourceType(domain) {
    const d = String(domain || '').toLowerCase().replace(/^www\./, '');
    if (!d) return 'other';
    for (const rule of SOURCE_TYPE_RULES) {
        if (rule.test(d)) return rule.type;
    }
    return 'other';
}

// Add a URL to a question's list, deduping by URL. If the same URL is seen as
// both retrieved (search pool) and cited (surfaced in the answer), the cited
// status wins — being cited is the stronger GEO signal.
function addUrl(list, seen, urlObj) {
    if (!urlObj || !urlObj.url) return;
    const existing = seen.get(urlObj.url);
    if (existing) {
        if (urlObj.cited && !existing.cited) {
            existing.cited = true;
        }
        if (!existing.snippet && urlObj.snippet) existing.snippet = urlObj.snippet;
        if (!existing.title && urlObj.title) existing.title = urlObj.title;
        if (existing.pubDate == null && urlObj.pubDate != null) existing.pubDate = urlObj.pubDate;
        return;
    }
    seen.set(urlObj.url, urlObj);
    list.push(urlObj);
}

function getConversationPlatform(conversation) {
    for (const question of conversation.questions || []) {
        for (const urlData of question.urls || []) {
            if (urlData.source === 'claude_json') return 'Claude';
            if (urlData.source === 'chatgpt_json') return 'ChatGPT';
        }
        if (question.searchIntent || (question.searchQueries && question.searchQueries.length > 0)) {
            return 'ChatGPT';
        }
    }
    return '';
}

const TOAST_DEFAULT_MS = 2800;
let toastTimer = null;

function showToast(message, type = 'info', durationMs = TOAST_DEFAULT_MS) {
    const host = document.getElementById('toast');
    if (!host) return;
    host.textContent = message;
    host.dataset.type = type;
    host.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        host.hidden = true;
        delete host.dataset.type;
    }, durationMs);
}

function getRelativeTime(timestamp) {
    if (!timestamp) return null;
    const now = Date.now() / 1000;
    const diffSeconds = now - timestamp;
    if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`;
    if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)}h ago`;
    if (diffSeconds < 604800) return `${Math.floor(diffSeconds / 86400)}d ago`;
    if (diffSeconds < 2592000) return `${Math.floor(diffSeconds / 604800)}w ago`;
    return `${Math.floor(diffSeconds / 2592000)}mo ago`;
}

function getSearchIntentInfo(searchIntent) {
    if (!searchIntent) return null;

    const totalSearchProb = searchIntent.simple_search_prob + searchIntent.complex_search_prob;
    const maxProb = Math.max(
        searchIntent.simple_search_prob,
        searchIntent.complex_search_prob,
        searchIntent.no_search_prob
    );

    let cls, label;
    if (maxProb === searchIntent.no_search_prob) {
        cls = 'intent-badge--none';
        label = 'No Search';
    } else if (totalSearchProb > 0.7) {
        cls = 'intent-badge--high';
        label = 'High Search Prob';
    } else {
        cls = 'intent-badge--medium';
        label = 'Medium Search Prob';
    }

    return {
        cls,
        label,
        percentage: (maxProb * 100).toFixed(1),
        triggered: searchIntent.search_decision
    };
}

function toggleAnalytics() {
    const body = document.getElementById('analyticsBody');
    const btn = document.getElementById('toggleAnalytics');
    if (!body || !btn) return;
    const isHidden = body.hidden;
    body.hidden = !isHidden;
    btn.textContent = isHidden ? 'Hide' : 'Show';
    btn.setAttribute('aria-expanded', String(isHidden));
}

// ---------- Shared tabular export ----------

// Copy and CSV share one column set so they always produce identical fields;
// only the delimiter/escaping differs (TSV vs quoted CSV). JSON export keeps the
// full nested object separately.
const EXPORT_HEADER = [
    'Conversation', 'Platform', 'Q#', 'Question', 'Has Search', 'Search Intent',
    'Search Queries', 'Cited Count', 'Citation Rate', 'Cited?', 'Type', 'Content Angle',
    'Ref Type', 'Position', 'Has Snippet', 'Content Age (days)', 'Freshness',
    'Domain', 'Attribution', 'Title', 'URL', 'Published', 'Snippet'
];

// Render a pub_date (unix seconds) as an ISO date, or '' when absent.
function formatPubDate(ts) {
    if (!ts) return '';
    try {
        return new Date(ts * 1000).toISOString().slice(0, 10);
    } catch {
        return '';
    }
}

// Flatten the search-intent classification into one human-readable cell.
function formatSearchIntent(searchIntent) {
    const info = getSearchIntentInfo(searchIntent);
    if (!info) return '';
    return `${info.label} ${info.percentage}%${info.triggered ? ' (search triggered)' : ''}`;
}

function urlTypeLabel(urlData) {
    return SOURCE_TYPE_LABELS[urlData.sourceType || classifySourceType(urlData.domain)] || 'Web';
}

// --- AI-optimization metrics (grounded in Google's AI optimization guide) ---
// All computed locally from fields already stored, per the extension's privacy model.

// Guide: reward a unique first-hand perspective over commodity content. The angle a
// content writer should know the AI rewarded for this query.
function contentAngle(urlData) {
    const t = urlData.sourceType || classifySourceType(urlData.domain);
    if (t === 'reddit' || t === 'forum' || t === 'social') return 'First-hand / Community';
    if (t === 'review') return 'Third-party Review';
    if (t === 'news' || t === 'reference' || t === 'academia') return 'Editorial / Authority';
    if (t === 'youtube') return 'Multimodal / Video';
    return 'Brand / Other';
}

// Days since publication; '' when the data carries no date.
function contentAgeDays(ts) {
    if (!ts) return '';
    const days = Math.floor((Date.now() / 1000 - ts) / 86400);
    return days >= 0 ? String(days) : '';
}

// Guide: freshness matters. Buckets tuned for content research; 'Unknown' when no date.
function freshnessBucket(ts) {
    if (!ts) return 'Unknown';
    const days = (Date.now() / 1000 - ts) / 86400;
    if (days <= 90) return 'Fresh';
    if (days <= 365) return 'Recent';
    return 'Older';
}

// Guide: content must be eligible to be shown with a snippet.
function hasSnippet(urlData) {
    return urlData.snippet && String(urlData.snippet).trim() ? 'Yes' : 'No';
}

// Build the flat row set (header + one row per URL) consumed by Copy and CSV.
// Per-question fields (intent, queries, cited count) repeat on each URL row so the
// table stays filterable/pivotable in a spreadsheet.
function buildExportRows(extractedUrls) {
    const rows = [EXPORT_HEADER.slice()];

    // Per-question performance metric: share of retrieved sources the AI actually cited.
    const citationRate = (urls) => {
        const total = urls.length;
        if (!total) return '';
        const cited = urls.filter(u => u.cited !== false).length;
        return `${Math.round(cited / total * 100)}% (${cited}/${total})`;
    };

    const urlRow = (convTitle, platform, qNumber, questionText, hasSearch, searchIntent, searchQueries, citedCount, rate, urlData) => [
        convTitle,
        platform,
        qNumber,
        questionText,
        hasSearch,
        searchIntent,
        searchQueries,
        citedCount,
        rate,
        urlData.cited === false ? 'No' : 'Yes',
        urlTypeLabel(urlData),
        contentAngle(urlData),
        urlData.refType || '',
        urlData.position || '',
        hasSnippet(urlData),
        contentAgeDays(urlData.pubDate),
        freshnessBucket(urlData.pubDate),
        urlData.domain || '',
        urlData.attribution || '',
        urlData.title || '',
        urlData.url || '',
        formatPubDate(urlData.pubDate),
        urlData.snippet || ''
    ];

    for (const conversation of extractedUrls) {
        const convTitle = conversation.conversationTitle || conversation.conversationId;
        const platform = getConversationPlatform(conversation);

        if (conversation.questions) {
            conversation.questions.forEach((question, questionIndex) => {
                const qNumber = `Q${questionIndex + 1}`;
                const searchIntent = formatSearchIntent(question.searchIntent);
                const searchQueries = (question.searchQueries || []).join('; ');
                const citedCount = question.citedCount != null ? String(question.citedCount) : '';
                const rate = citationRate(question.urls || []);

                if (!question.urls || question.urls.length === 0) {
                    rows.push([
                        convTitle, platform, qNumber, question.questionText || '', 'No',
                        searchIntent, searchQueries, citedCount, '',
                        '', '', '', '', '', '', '', '', '', '', '', '', '', ''
                    ]);
                } else {
                    for (const urlData of question.urls) {
                        rows.push(urlRow(convTitle, platform, qNumber, question.questionText || '', 'Yes', searchIntent, searchQueries, citedCount, rate, urlData));
                    }
                }
            });
        } else if (conversation.urls) {
            const rate = citationRate(conversation.urls);
            for (const urlData of conversation.urls) {
                rows.push(urlRow(convTitle, platform, '', 'Legacy Data', 'Yes', '', '', '', rate, urlData));
            }
        }
    }

    return rows;
}

// ---------- Copy to clipboard ----------

async function copyTable() {
    const { extractedUrls = [] } = await chrome.storage.local.get('extractedUrls');

    if (extractedUrls.length === 0) {
        showToast('No URLs to copy.', 'error');
        return;
    }

    const rows = buildExportRows(extractedUrls);
    const text = rows.map(row => row.map(cell => sanitizeField(cell)).join('\t')).join('\n') + '\n';

    try {
        await navigator.clipboard.writeText(text);
        showToast('Table copied to clipboard.', 'success');
    } catch (error) {
        showToast('Failed to copy: ' + error.message, 'error');
    }
}

// ---------- Extraction entry point ----------

async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.id) {
        throw new Error('No active browser tab found.');
    }

    return tab;
}

function getSupportedPageInfo(urlValue) {
    let url;

    try {
        url = new URL(urlValue);
    } catch {
        throw new Error('Open a ChatGPT or Claude conversation tab first.');
    }

    const host = url.hostname.replace(/^www\./, '');

    if (host === 'chatgpt.com' || host === 'chat.openai.com') {
        return {
            platform: 'chatgpt',
            originPattern: `${url.origin}/*`
        };
    }

    if (host === 'claude.ai') {
        return {
            platform: 'claude',
            originPattern: `${url.origin}/*`
        };
    }

    throw new Error('Open a ChatGPT or Claude conversation tab first.');
}

async function importCapturedPayloadIfAvailable(silent = false) {
    if (!chrome.runtime?.sendMessage || !chrome.tabs?.query) return false;

    let tab;
    try {
        tab = await getActiveTab();
    } catch {
        return false;
    }

    let response;
    try {
        response = await chrome.runtime.sendMessage({
            type: 'GET_CAPTURED_PAYLOAD',
            tabId: tab.id
        });
    } catch {
        response = null;
    }

    let payload = response?.ok ? response.payload : null;
    if (!payload?.payloadText) {
        payload = await getPageSessionCapture(tab.id);
    }

    if (!payload?.payloadText) return false;

    try {
        const data = JSON.parse(payload.payloadText);
        const platform = payload.platform || getSupportedPageInfo(payload.pageUrl || tab.url).platform;
        setSelectedPlatform(platform);
        await extractConversationData(platform, data);
        try {
            await chrome.runtime.sendMessage({
                type: 'CLEAR_CAPTURED_PAYLOAD',
                tabId: tab.id
            });
        } catch {
            // The session copy is cleared below.
        }
        await clearPageSessionCapture(tab.id);

        if (!silent) {
            showToast('Imported captured full JSON from the reloaded tab.', 'success', 5000);
        }
        return true;
    } catch (error) {
        showToast(`Captured JSON could not be parsed: ${error.message}`, 'error', 7000);
        return false;
    }
}

async function getPageSessionCapture(tabId) {
    try {
        const [injection] = await chrome.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            func: () => {
                const raw = sessionStorage.getItem('aiUrlExtractorCapturedPayload');
                return raw ? JSON.parse(raw) : null;
            }
        });

        return injection?.result || null;
    } catch {
        return null;
    }
}

async function clearPageSessionCapture(tabId) {
    try {
        await chrome.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            func: () => {
                sessionStorage.removeItem('aiUrlExtractorCaptureArmed');
                sessionStorage.removeItem('aiUrlExtractorCapturedPayload');
            }
        });
    } catch {
        // The page may already be closed or no longer eligible for injection.
    }
}

async function startReloadCapture(tab, pageInfo) {
    const response = await chrome.runtime.sendMessage({
        type: 'START_FULL_CAPTURE',
        tabId: tab.id,
        originPattern: pageInfo.originPattern,
        platform: pageInfo.platform
    });

    if (!response?.ok) {
        throw new Error(response?.error || 'Could not start capture-on-reload.');
    }

    const reloadNote = response.reloaded
        ? 'The conversation tab is reloading now.'
        : 'Reload the conversation tab manually.';
    showToast(`${reloadNote} Reopen this popup after it finishes loading to import full JSON.`, 'info', 9000);
}

async function fetchFromCurrentTab() {
    const fetchBtn = document.getElementById('fetchCurrentTabBtn');
    const originalLabel = fetchBtn?.textContent || 'Capture Full JSON';

    if (fetchBtn) {
        fetchBtn.disabled = true;
        fetchBtn.textContent = 'Checking...';
    }

    try {
        if (!chrome.scripting?.executeScript) {
            throw new Error('Chrome scripting API is unavailable. Reload the extension in chrome://extensions so the new permission takes effect.');
        }

        if (!chrome.tabs?.query) {
            throw new Error('Chrome tabs API is unavailable. Open this from the installed extension popup.');
        }

        const imported = await importCapturedPayloadIfAvailable(false);
        if (imported) {
            return;
        }

        const tab = await getActiveTab();
        const pageInfo = getSupportedPageInfo(tab.url);

        fetchBtn.textContent = 'Trying direct...';
        const [injection] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            world: 'MAIN',
            func: fetchConversationJsonFromPage
        });

        const result = injection?.result;
        if (result?.ok) {
            setSelectedPlatform(result.platform);
            await extractConversationData(result.platform, result.data);
            return;
        }

        fetchBtn.textContent = 'Arming capture...';
        await startReloadCapture(tab, pageInfo);
    } catch (error) {
        showToast(`Capture failed: ${error.message}`, 'error', 7000);
    } finally {
        if (fetchBtn) {
            fetchBtn.disabled = false;
            fetchBtn.textContent = originalLabel;
        }
    }
}

function setSelectedPlatform(platform) {
    const radio = document.querySelector(`input[name="platform"][value="${platform}"]`);
    if (radio) radio.checked = true;
}

async function extractFromJson() {
    const jsonInput = document.getElementById('jsonInput').value.trim();

    if (!jsonInput) {
        showToast('Please paste the Network response JSON first.', 'error');
        return;
    }

    const platform = document.querySelector('input[name="platform"]:checked').value;

    try {
        const data = JSON.parse(jsonInput);
        await extractConversationData(platform, data);
    } catch (error) {
        showToast('Invalid JSON: ' + error.message, 'error');
    }
}

async function extractConversationData(platform, data) {
    if (platform === 'claude') {
        if (!data.chat_messages && Array.isArray(data.chat_conversation?.chat_messages)) {
            data = data.chat_conversation;
        }
        await extractFromClaude(data);
    } else {
        if (!data.mapping && data.conversation?.mapping) {
            data = data.conversation;
        }
        await extractFromChatGPT(data);
    }
}

async function fetchConversationJsonFromPage() {
    try {
        const host = location.hostname.replace(/^www\./, '');

        const fetchJson = async (url) => {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 20000);

            try {
                const response = await fetch(url, {
                    credentials: 'include',
                    headers: {
                        accept: 'application/json'
                    },
                    signal: controller.signal
                });
                const text = await response.text();

                if (!response.ok) {
                    throw new Error(`${response.status} ${response.statusText}`.trim() || `HTTP ${response.status}`);
                }

                try {
                    return JSON.parse(text);
                } catch {
                    throw new Error('The site returned non-JSON content. You may be logged out or the endpoint changed.');
                }
            } finally {
                clearTimeout(timeoutId);
            }
        };

        const getSameOriginResourceUrls = (predicate) => {
            const urls = new Set();

            try {
                performance.getEntriesByType('resource').forEach((entry) => {
                    const url = new URL(entry.name, location.href);
                    if (url.origin === location.origin && predicate(url)) {
                        urls.add(`${url.pathname}${url.search}`);
                    }
                });
            } catch {
                // Performance entries are only a discovery hint.
            }

            return [...urls];
        };

        const tryFetchJsonUrls = async (urls, isExpectedData) => {
            const errors = [];
            const seen = new Set();

            for (const url of urls) {
                if (!url || seen.has(url)) continue;
                seen.add(url);

                try {
                    const data = await fetchJson(url);
                    if (!isExpectedData || isExpectedData(data)) {
                        return { data, url };
                    }
                    errors.push(`${url}: unexpected JSON shape`);
                } catch (error) {
                    errors.push(`${url}: ${error.message}`);
                }
            }

            throw new Error(errors.slice(0, 3).join('; ') || 'No candidate JSON endpoint worked.');
        };

        const uuidPattern = /^[a-zA-Z0-9_-]{12,}$/;
        const getPathSegmentAfter = (segmentName) => {
            const segments = location.pathname.split('/').filter(Boolean);
            const index = segments.indexOf(segmentName);
            if (index === -1 || !segments[index + 1]) return null;
            return decodeURIComponent(segments[index + 1]);
        };

        if (host === 'chatgpt.com' || host === 'chat.openai.com') {
            const conversationId = getPathSegmentAfter('c');

            if (!conversationId || !uuidPattern.test(conversationId)) {
                return {
                    ok: false,
                    error: 'Open a ChatGPT conversation URL like /c/<conversation-id> first.'
                };
            }

            const encodedId = encodeURIComponent(conversationId);
            const discoveredUrls = getSameOriginResourceUrls((url) => (
                url.href.includes(conversationId)
                && (
                    url.pathname.includes('/conversation')
                    || url.pathname.includes('/backend-api/')
                    || url.pathname.includes('/api/')
                )
            ));
            const candidateUrls = [
                ...discoveredUrls,
                `/backend-api/conversation/${encodedId}`,
                `/backend-api/conversation/${encodedId}?include_browser_features=true`,
                `/backend-api/f/conversation/${encodedId}`,
                `/backend-api/f/conversation/${encodedId}?include_browser_features=true`
            ];
            try {
                const { data } = await tryFetchJsonUrls(candidateUrls, (json) => Boolean(json?.mapping || json?.conversation?.mapping));

                return {
                    ok: true,
                    platform: 'chatgpt',
                    conversationId,
                    data
                };
            } catch (error) {
                return {
                    ok: false,
                    error: error.message || 'ChatGPT direct JSON endpoint was unavailable.'
                };
            }
        }

        if (host === 'claude.ai') {
            const conversationId = getPathSegmentAfter('chat');

            if (!conversationId || !uuidPattern.test(conversationId)) {
                return {
                    ok: false,
                    error: 'Open a Claude conversation URL like /chat/<conversation-id> first.'
                };
            }

            const organizationIds = new Set();
            const discoveredConversationUrls = getSameOriginResourceUrls((url) => (
                url.href.includes(conversationId)
                && url.pathname.includes('/chat_conversations/')
            ));

            try {
                const organizations = await fetchJson('/api/organizations');
                const orgList = Array.isArray(organizations)
                    ? organizations
                    : organizations.organizations || organizations.data || [];

                orgList.forEach((org) => {
                    const id = org?.uuid || org?.id;
                    if (id) organizationIds.add(String(id));
                });
            } catch {
                // Some Claude builds keep the active organization only in local storage.
            }

            try {
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    const value = localStorage.getItem(key) || '';
                    const matches = value.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi) || [];
                    matches.forEach((id) => {
                        if (id !== conversationId) organizationIds.add(id);
                    });
                }
            } catch {
                // Local storage is a best-effort fallback for Claude organization discovery.
            }

            if (organizationIds.size === 0) {
                return {
                    ok: false,
                    error: 'Could not find the Claude organization ID for this conversation.'
                };
            }

            const errors = [];
            if (discoveredConversationUrls.length > 0) {
                try {
                    const { data } = await tryFetchJsonUrls(
                        discoveredConversationUrls,
                        (json) => Array.isArray(json?.chat_messages || json?.chat_conversation?.chat_messages)
                    );
                    return {
                        ok: true,
                        platform: 'claude',
                        conversationId,
                        data
                    };
                } catch (error) {
                    errors.push(error.message);
                }
            }

            for (const organizationId of organizationIds) {
                const encodedOrgId = encodeURIComponent(organizationId);
                const encodedConversationId = encodeURIComponent(conversationId);
                const candidateUrls = [
                    `/api/organizations/${encodedOrgId}/chat_conversations/${encodedConversationId}`,
                    `/api/organizations/${encodedOrgId}/chat_conversations/${encodedConversationId}?tree=True`,
                    `/api/organizations/${encodedOrgId}/chat_conversations/${encodedConversationId}?rendering_mode=messages`
                ];

                try {
                    const { data } = await tryFetchJsonUrls(
                        candidateUrls,
                        (json) => Array.isArray(json?.chat_messages || json?.chat_conversation?.chat_messages)
                    );
                    return {
                        ok: true,
                        platform: 'claude',
                        conversationId,
                        data
                    };
                } catch (error) {
                    errors.push(error.message);
                }
            }

            return {
                ok: false,
                error: `Claude conversation fetch failed. ${errors[0] || 'Use manual paste for this conversation.'}`
            };
        }

        return {
            ok: false,
            error: 'Open a ChatGPT or Claude conversation tab first.'
        };
    } catch (error) {
        const message = error.name === 'AbortError'
            ? 'The conversation request timed out.'
            : error.message;
        return {
            ok: false,
            error: message
        };
    }
}

// ---------- Claude ----------

async function extractFromClaude(data) {
    if (!data.chat_messages || !Array.isArray(data.chat_messages)) {
        showToast('Invalid Claude JSON: missing chat_messages array.', 'error');
        return;
    }

    const conversationId = data.uuid || 'claude-' + Date.now();
    const conversationTitle = data.name || 'Untitled Conversation';
    const questions = [];

    for (let i = 0; i < data.chat_messages.length; i++) {
        const message = data.chat_messages[i];

        if (message.sender === 'human' && message.content && message.content.length > 0) {
            const questionText = message.content
                .filter(c => c.type === 'text')
                .map(c => c.text)
                .join(' ')
                .trim();

            if (!questionText) continue;

            const questionUrls = [];
            const searchQueries = [];
            const seenUrls = new Set();

            // Treat anything that looks like a search/fetch tool as a fan-out source.
            // Claude has shipped this tool under a few names ("web_search", and the
            // integration-prefixed variants), so match on intent rather than one string.
            const isSearchTool = (name) => {
                const n = String(name || '').toLowerCase();
                return n.includes('search') || n.includes('web_fetch') || n.includes('browse');
            };

            const pushQuery = (raw) => {
                const s = (typeof raw === 'string' ? raw : (raw && (raw.query || raw.q)) || '').trim();
                if (s && !searchQueries.includes(s)) searchQueries.push(s);
            };

            const pushUrl = (result) => {
                if (!result || typeof result !== 'object') return;
                const url = result.url || result.link || result.source_url;
                if (!url || seenUrls.has(url)) return;
                seenUrls.add(url);
                const domain = getDomain(url, result.metadata?.site_domain || result.site_domain);
                questionUrls.push({
                    url,
                    title: result.title || result.metadata?.title || result.page_title || '',
                    snippet: result.snippet || result.description || result.text || '',
                    domain,
                    sourceType: classifySourceType(domain),
                    cited: true,
                    source: 'claude_json'
                });
            };

            const collectFromContent = (content) => {
                if (!content || typeof content !== 'object') return;

                // Fan-out queries: Claude stores each search call as a `tool_use` or —
                // for server-side tools like web search — a `server_tool_use` block.
                // The input carries either a single `query` or an array of `queries`.
                const isToolCall = content.type === 'tool_use' || content.type === 'server_tool_use';
                if (isToolCall && isSearchTool(content.name)) {
                    const input = content.input || {};
                    if (input.query != null) pushQuery(input.query);
                    if (Array.isArray(input.queries)) input.queries.forEach(pushQuery);
                } else if (isToolCall && content.input && typeof content.input.query === 'string') {
                    // Unknown tool name carrying a query-shaped input — collect it and
                    // surface the name so future renames are visible instead of silent.
                    console.debug('[FanoutExtractor] query from unrecognized tool:', content.name);
                    pushQuery(content.input.query);
                }

                // Search results: Claude has used several shapes — a tool_result whose
                // `.content` holds `knowledge` items, a `web_search_tool_result` block,
                // or bare `knowledge` / `web_search_result` content blocks. Grab any item
                // that carries a URL so a type/field rename can't silently drop results.
                const isResultBlock =
                    (content.type === 'tool_result' && isSearchTool(content.name))
                    || content.type === 'web_search_tool_result'
                    || content.type === 'knowledge'
                    || content.type === 'web_search_result';

                if (isResultBlock) {
                    const items = Array.isArray(content.content)
                        ? content.content
                        : (content.url ? [content] : []);
                    items.forEach(pushUrl);
                }

                // Search calls and results can be nested inside container blocks
                // (tool_result content, thinking / research structures). Recurse into
                // any child that looks like a content block so nested searches are
                // collected too. pushQuery/pushUrl dedupe, so re-visits are harmless.
                for (const key of Object.keys(content)) {
                    if (key === 'input') continue; // tool inputs handled above
                    const val = content[key];
                    if (Array.isArray(val)) {
                        val.forEach((child) => {
                            if (child && typeof child === 'object' && (child.type || child.content)) {
                                collectFromContent(child);
                            }
                        });
                    } else if (val && typeof val === 'object' && val.type) {
                        collectFromContent(val);
                    }
                }
            };

            // Attribute every assistant/tool message up to the next human turn
            // to this question, so multi-message responses (clarifying replies,
            // long research runs) keep their URLs grouped under it.
            for (let j = i + 1; j < data.chat_messages.length; j++) {
                const followUp = data.chat_messages[j];
                if (followUp.sender === 'human') break;
                if (Array.isArray(followUp.content)) {
                    followUp.content.forEach(collectFromContent);
                }
            }

            questions.push({
                questionText,
                hasSearch: questionUrls.length > 0,
                citedCount: questionUrls.filter(u => u.cited).length,
                searchQueries,
                urls: questionUrls
            });
        }
    }

    if (questions.length === 0) {
        showToast('No user questions found in Claude JSON.', 'error');
        return;
    }

    await saveExtractedData(conversationId, conversationTitle, questions);
}

// ---------- ChatGPT ----------

async function extractFromChatGPT(data) {
    let conversationId = data.conversation_id || data.id;
    let conversationTitle = data.title || 'Untitled Conversation';

    if (!conversationId && data.title) {
        conversationId = data.title.substring(0, 30).replace(/[^a-zA-Z0-9]/g, '-');
    }
    if (!conversationId) {
        conversationId = 'chatgpt-' + Date.now();
    }

    const questions = [];

    if (data.mapping) {
        const messageMap = data.mapping;

        const traverseMessages = (nodeId) => {
            const node = messageMap[nodeId];
            if (!node) return;

            const message = node.message;

            if (message && message.author && message.author.role === 'user' && message.content && message.content.parts) {
                const questionText = message.content.parts.join(' ').trim();

                if (questionText) {
                    const questionUrls = [];
                    const seenUrls = new Map();
                    const searchQueries = [];
                    const seenQueries = new Set();
                    let searchIntent = null;

                    // A single source entry, either retrieved (search pool) or
                    // cited (surfaced in the visible answer). `cited` is the key
                    // GEO signal: it means ChatGPT actually used the source.
                    const buildUrlObj = (entry, group, { cited }) => {
                        const domainRaw = entry.attribution || (group && group.domain) || entry.url;
                        const domain = getDomain(entry.url, domainRaw);
                        let refType = cited ? 'cited' : 'search';
                        if (entry.ref_id && entry.ref_id.ref_type) {
                            refType = entry.ref_id.ref_type;
                        }
                        return {
                            url: entry.url,
                            title: entry.title || '',
                            snippet: entry.snippet || '',
                            domain,
                            sourceType: classifySourceType(domain),
                            cited: !!cited,
                            refType,
                            pubDate: entry.pub_date || null,
                            attribution: entry.attribution || domain,
                            source: 'chatgpt_json'
                        };
                    };

                    const extractUrlsFromNode = (obj) => {
                        if (!obj || typeof obj !== 'object') return;

                        if (obj.sonic_classification_result && !searchIntent) {
                            searchIntent = {
                                simple_search_prob: obj.sonic_classification_result.simple_search_prob || 0,
                                complex_search_prob: obj.sonic_classification_result.complex_search_prob || 0,
                                no_search_prob: obj.sonic_classification_result.no_search_prob || 0,
                                search_decision: obj.sonic_classification_result.search_decision || false
                            };
                        }

                        // Fan-out queries — the sub-queries the model generates from
                        // the prompt. They arrive in multiple tool-message blocks, so
                        // accumulate across all of them (deduped) instead of overwriting.
                        // Both keys carry the same queries in different shapes.
                        const addQuery = (q) => {
                            const s = (typeof q === 'string' ? q : (q && q.q) || '').trim();
                            if (s && !seenQueries.has(s)) {
                                seenQueries.add(s);
                                searchQueries.push(s);
                            }
                        };
                        if (obj.search_model_queries && Array.isArray(obj.search_model_queries.queries)) {
                            obj.search_model_queries.queries.forEach(addQuery);
                        }
                        if (Array.isArray(obj.search_queries)) {
                            obj.search_queries.forEach(addQuery);
                        }

                        // Retrieved candidate pool — everything the search step returned.
                        if (obj.search_result_groups && Array.isArray(obj.search_result_groups)) {
                            obj.search_result_groups.forEach(group => {
                                if (group.entries && Array.isArray(group.entries)) {
                                    group.entries.forEach(entry => {
                                        if (entry.url && entry.type === 'search_result') {
                                            addUrl(questionUrls, seenUrls, buildUrlObj(entry, group, { cited: false }));
                                        }
                                    });
                                }
                            });
                        }

                        // Citation layer — URLs ChatGPT actually surfaced in its
                        // answer (footnotes / inline citations). These are the
                        // highest-value GEO signal and live OUTSIDE the search pool,
                        // which is why links like cited Reddit threads were missed.
                        if (obj.content_references && Array.isArray(obj.content_references)) {
                            obj.content_references.forEach(ref => {
                                if (!ref || typeof ref !== 'object') return;
                                // grouped_webpages: inline citations with rich items.
                                (ref.items || []).forEach(item => {
                                    if (item && item.url) {
                                        addUrl(questionUrls, seenUrls, buildUrlObj(item, null, { cited: true }));
                                    }
                                    (item.supporting_websites || []).forEach(sw => {
                                        if (sw && sw.url) {
                                            addUrl(questionUrls, seenUrls, buildUrlObj(sw, null, { cited: true }));
                                        }
                                    });
                                });
                                // sources_footnote: the canonical "Sources" list.
                                (ref.sources || []).forEach(src => {
                                    if (src && src.url) {
                                        addUrl(questionUrls, seenUrls, buildUrlObj(src, null, { cited: true }));
                                    }
                                });
                            });
                        }

                        for (const key in obj) {
                            if (Object.prototype.hasOwnProperty.call(obj, key) && typeof obj[key] === 'object') {
                                extractUrlsFromNode(obj[key]);
                            }
                        }
                    };

                    const searchDescendants = (ancestorId) => {
                        const ancestorNode = messageMap[ancestorId];
                        if (!ancestorNode || !ancestorNode.children) return;

                        ancestorNode.children.forEach(childId => {
                            const childNode = messageMap[childId];
                            if (!childNode) return;
                            extractUrlsFromNode(childNode);
                            searchDescendants(childId);
                        });
                    };

                    searchDescendants(nodeId);

                    // Assign a stable retrieval position for ranking analysis.
                    questionUrls.forEach((u, idx) => { u.position = idx + 1; });

                    questions.push({
                        questionText,
                        hasSearch: questionUrls.length > 0,
                        citedCount: questionUrls.filter(u => u.cited).length,
                        searchQueries,
                        searchIntent,
                        urls: questionUrls
                    });
                }
            }

            if (node.children && node.children.length > 0) {
                node.children.forEach(childId => traverseMessages(childId));
            }
        };

        traverseMessages('client-created-root');
    }

    await saveExtractedData(conversationId, conversationTitle, questions);
}

// ---------- Persist ----------

async function saveExtractedData(conversationId, conversationTitle, questions) {
    const totalUrls = questions.reduce((sum, q) => sum + q.urls.length, 0);

    if (totalUrls > 0 || questions.length > 0) {
        const { extractedUrls = [] } = await chrome.storage.local.get('extractedUrls');

        const existsIndex = extractedUrls.findIndex(item => item.conversationId === conversationId);
        const entry = {
            conversationId,
            conversationTitle,
            timestamp: new Date().toISOString(),
            questions
        };

        if (existsIndex >= 0) {
            extractedUrls[existsIndex] = entry;
        } else {
            extractedUrls.push(entry);
        }

        await chrome.storage.local.set({ extractedUrls });
        await loadUrls();

        document.getElementById('jsonInput').value = '';

        const plural = questions.length === 1 ? 'question' : 'questions';
        showToast(`Extracted ${questions.length} ${plural} (${totalUrls} URLs).`, 'success');
    } else {
        showToast('No questions or URLs found in the JSON.', 'error');
    }
}

// ---------- Render ----------

async function loadUrls() {
    const { extractedUrls = [] } = await chrome.storage.local.get('extractedUrls');

    let totalUrls = 0;
    let citedUrls = 0;
    const totalConversations = extractedUrls.length;
    const domainCounts = {};
    const typeCounts = { reddit: 0, forum: 0, youtube: 0, social: 0, review: 0, news: 0, reference: 0, academia: 0, other: 0 };

    const countUrl = (url) => {
        const domain = url.domain || 'Unknown';
        domainCounts[domain] = (domainCounts[domain] || 0) + 1;
        if (url.cited) citedUrls++;
        // Classify by domain. Older stored data has no sourceType, so derive it.
        const sourceType = url.sourceType || classifySourceType(url.domain);
        if (Object.prototype.hasOwnProperty.call(typeCounts, sourceType)) {
            typeCounts[sourceType]++;
        } else {
            typeCounts.other++;
        }
    };

    extractedUrls.forEach(conversation => {
        if (conversation.questions) {
            conversation.questions.forEach(question => {
                totalUrls += question.urls.length;
                question.urls.forEach(countUrl);
            });
        } else if (conversation.urls) {
            totalUrls += conversation.urls.length;
            conversation.urls.forEach(countUrl);
        }
    });

    document.getElementById('urlCount').textContent = totalUrls;
    document.getElementById('conversationCount').textContent = totalConversations;

    const leaderboard = document.getElementById('domainLeaderboard');
    const domainList = document.getElementById('domainList');

    if (totalUrls > 0) {
        const sortedDomains = Object.entries(domainCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);

        if (sortedDomains.length > 0) {
            show(leaderboard);
            domainList.innerHTML = sortedDomains.map(([domain, count], index) => {
                const percentage = ((count / totalUrls) * 100).toFixed(1);
                const rank = `${index + 1}.`;
                return `
                    <div class="domain-item">
                        <span class="domain-rank">${rank}</span>
                        <span class="domain-name">${escapeHtml(domain)}</span>
                        <span class="domain-count">${count} <small>(${percentage}%)</small></span>
                    </div>
                `;
            }).join('');
        } else {
            hide(leaderboard);
        }
    } else {
        hide(leaderboard);
    }

    const analyticsDashboard = document.getElementById('analyticsDashboard');
    if (totalUrls > 0) {
        show(analyticsDashboard);
        populateAnalytics(extractedUrls, typeCounts, totalUrls, citedUrls);
    } else {
        hide(analyticsDashboard);
    }

    const urlList = document.getElementById('urlList');

    if (extractedUrls.length === 0) {
        urlList.innerHTML = `
      <div class="placeholder">
        <p>No URLs extracted yet.</p>
        <p class="hint">Capture a conversation or paste JSON to begin.</p>
      </div>
    `;
        return;
    }

    const tableHead = `
    <thead>
      <tr>
        <th>Question</th>
        <th>Domain</th>
        <th>Citation</th>
        <th>Title</th>
        <th>URL</th>
        <th>Published</th>
      </tr>
    </thead>
  `;

    let html = '<div class="conversations">';

    for (const conversation of [...extractedUrls].reverse()) {
        html += `
      <section class="conversation-block">
        <header class="conversation-header-card">
          <div class="conversation-title">${escapeHtml(conversation.conversationTitle || conversation.conversationId)}</div>
          <div class="conversation-meta">
            <span>${escapeHtml(new Date(conversation.timestamp).toLocaleString())}</span>
            <span class="conversation-id">${escapeHtml(String(conversation.conversationId).substring(0, 12))}...</span>
          </div>
        </header>
        <table class="url-table">
          ${tableHead}
          <tbody>
    `;

        if (conversation.questions) {
            for (const [questionIndex, question] of conversation.questions.entries()) {
                const qBadge = `<span class="q-number">Q${questionIndex + 1}</span>`;
                if (question.urls.length === 0) {
                    const intentInfo = getSearchIntentInfo(question.searchIntent);
                    html += `
            <tr class="no-search-row">
              <td class="question-cell">
                <div class="question-text">${qBadge}${escapeHtml(question.questionText)}</div>
                ${intentInfo ? `<div class="intent-badge ${intentInfo.cls}">${escapeHtml(intentInfo.label)} (${intentInfo.percentage}%)</div>` : ''}
                ${question.searchQueries && question.searchQueries.length > 0 ? `
                  <div class="search-queries">
                    <strong>Queries:</strong>
                    <ul>
                      ${question.searchQueries.map(q => `<li>${escapeHtml(q)}</li>`).join('')}
                    </ul>
                  </div>
                ` : ''}
                <div class="no-search-badge">No web search</div>
              </td>
              <td colspan="5" class="no-data">—</td>
            </tr>
          `;
                } else {
                    question.urls.forEach((urlData, urlIndex) => {
                        html += '<tr>';

                        if (urlIndex === 0) {
                            const intentInfo = getSearchIntentInfo(question.searchIntent);
                            html += `
                <td rowspan="${question.urls.length}" class="question-cell">
                  <div class="question-text">${qBadge}${escapeHtml(question.questionText)}</div>
                  ${intentInfo ? `<div class="intent-badge ${intentInfo.cls}">${escapeHtml(intentInfo.label)} (${intentInfo.percentage}%)</div>` : ''}
                  ${question.searchQueries && question.searchQueries.length > 0 ? `
                    <div class="search-queries">
                      <strong>Queries:</strong>
                      <ul>
                        ${question.searchQueries.map(q => `<li>${escapeHtml(q)}</li>`).join('')}
                      </ul>
                    </div>
                  ` : ''}
                  <div class="url-count-badge">${question.urls.length} URL${question.urls.length > 1 ? 's' : ''}</div>
                </td>
              `;
                        }

                        html += `<td class="domain-cell">${escapeHtml(urlData.domain) || 'Unknown'}</td>`;
                        html += `<td class="citation-cell">${citationBadge(urlData)}</td>`;
                        html += `<td class="title-cell">${urlData.title ? escapeHtml(urlData.title) : '<em>No title</em>'}</td>`;
                        html += `
              <td class="url-cell">
                <a href="${escapeHtml(urlData.url)}" target="_blank" rel="noopener noreferrer" class="url-link" title="${escapeHtml(urlData.url)}">${escapeHtml(urlData.url)}</a>
              </td>
            `;
                        const relativeTime = getRelativeTime(urlData.pubDate);
                        html += `<td class="date-cell">${relativeTime ? `<span class="date-badge">${escapeHtml(relativeTime)}</span>` : '—'}</td>`;
                        html += '</tr>';
                    });
                }
            }
        } else if (conversation.urls) {
            const questionNum = 'Legacy Data';
            conversation.urls.forEach((urlData, urlIndex) => {
                html += '<tr>';
                if (urlIndex === 0) {
                    html += `
            <td rowspan="${conversation.urls.length}" class="question-cell">
              <div class="question-text">${escapeHtml(questionNum)}</div>
              <div class="url-count-badge">${conversation.urls.length} URL${conversation.urls.length > 1 ? 's' : ''}</div>
            </td>
          `;
                }
                html += `<td class="domain-cell">${escapeHtml(urlData.domain) || 'Unknown'}</td>`;
                html += `<td class="citation-cell">${citationBadge(urlData)}</td>`;
                html += `<td class="title-cell">${urlData.title ? escapeHtml(urlData.title) : '<em>No title</em>'}</td>`;
                html += `
          <td class="url-cell">
            <a href="${escapeHtml(urlData.url)}" target="_blank" rel="noopener noreferrer" class="url-link" title="${escapeHtml(urlData.url)}">${escapeHtml(urlData.url)}</a>
          </td>
          <td class="date-cell">—</td>
        `;
                html += '</tr>';
            });
        }

        html += `
          </tbody>
        </table>
      </section>
    `;
    }

    html += '</div>';
    urlList.innerHTML = html;
}

// ---------- Export ----------

async function exportCsv() {
    const { extractedUrls = [] } = await chrome.storage.local.get('extractedUrls');

    if (extractedUrls.length === 0) {
        showToast('No URLs to export.', 'error');
        return;
    }

    const csvCell = (value) => `"${sanitizeField(value).replace(/"/g, '""')}"`;
    const rows = buildExportRows(extractedUrls);

    const csv = rows.map(row => row.map(csvCell).join(',')).join('\n') + '\n';

    triggerDownload(csv, 'text/csv', `ai-urls-${Date.now()}.csv`);
    showToast('CSV download started.', 'success');
}

async function exportJson() {
    const { extractedUrls = [] } = await chrome.storage.local.get('extractedUrls');

    if (extractedUrls.length === 0) {
        showToast('No URLs to export.', 'error');
        return;
    }

    triggerDownload(JSON.stringify(extractedUrls, null, 2), 'application/json', `ai-urls-${Date.now()}.json`);
    showToast('JSON download started.', 'success');
}

function triggerDownload(content, mime, filename) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ---------- Clear ----------

async function clearUrls() {
    if (!confirm('This will delete all extracted URLs. Are you sure?')) return;

    await chrome.storage.local.set({ extractedUrls: [], trackedDomain: '' });

    hide(document.getElementById('analyticsDashboard'));
    hide(document.getElementById('domainLeaderboard'));
    hide(document.getElementById('yourDomainStats'));

    const domainInput = document.getElementById('yourDomainInput');
    if (domainInput) domainInput.value = '';

    await loadUrls();
    showToast('All data cleared.', 'success');
}
