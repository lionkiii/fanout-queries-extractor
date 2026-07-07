// Analytics rendering for the popup dashboard.
// All values are computed locally from chrome.storage.local — no network.

function populateAnalytics(extractedUrls, typeCounts, totalUrls, citedUrls = 0) {
    displayCitationRate(totalUrls, citedUrls);
    displaySourceTypes(typeCounts, totalUrls);
    displayFreshnessStats(extractedUrls);
    displaySearchIntentStats(extractedUrls);
}

// Cited vs. retrieved is the core GEO metric: of every source the model pulled,
// how many did it actually surface in the answer.
function displayCitationRate(totalUrls, citedUrls) {
    const container = document.getElementById('citationStats');
    if (!container) return;

    const cited = citedUrls || 0;
    const retrieved = Math.max(totalUrls - cited, 0);
    const rate = totalUrls > 0 ? (cited / totalUrls * 100).toFixed(0) : '0';

    container.innerHTML = `
        <div class="stat-item intent-high">
            <div class="stat-value">${cited}</div>
            <div class="stat-desc">Cited in answer</div>
        </div>
        <div class="stat-item">
            <div class="stat-value">${retrieved}</div>
            <div class="stat-desc">Retrieved only</div>
        </div>
        <div class="stat-item">
            <div class="stat-value">${rate}%</div>
            <div class="stat-desc">Citation rate</div>
        </div>
        <div class="stat-item">
            <div class="stat-value">${totalUrls}</div>
            <div class="stat-desc">Total sources</div>
        </div>
    `;
}

// Colors for the Source Type Distribution progress bars in the analytics card.
// Buckets are marketer-facing and only rendered when present in the data.
const SOURCE_TYPES = [
    { name: 'Reddit', key: 'reddit', color: '#ff4500' },
    { name: 'Forums', key: 'forum', color: '#f59e0b' },
    { name: 'Video', key: 'youtube', color: '#ef4444' },
    { name: 'Social', key: 'social', color: '#0ea5e9' },
    { name: 'Review sites', key: 'review', color: '#8b5cf6' },
    { name: 'News', key: 'news', color: '#dc2626' },
    { name: 'Reference', key: 'reference', color: '#14b8a6' },
    { name: 'Academia', key: 'academia', color: '#059669' },
    { name: 'Other web', key: 'other', color: '#6b7280' }
];

function displaySourceTypes(typeCounts, totalUrls) {
    const container = document.getElementById('sourceTypeChart');
    if (!container) return;

    let html = '<div class="type-bars">';
    SOURCE_TYPES.forEach(type => {
        const count = typeCounts[type.key] || 0;
        if (count === 0) return;
        const percentage = totalUrls > 0 ? (count / totalUrls * 100).toFixed(1) : 0;
        html += `
            <div class="type-bar-item">
                <div class="type-bar-label">
                    <span>${type.name}</span>
                    <span><strong>${count}</strong> (${percentage}%)</span>
                </div>
                <div class="progress-bar">
                    <div class="progress-fill" style="width: ${percentage}%; background-color: ${type.color};"></div>
                </div>
            </div>
        `;
    });
    html += '</div>';

    container.innerHTML = totalUrls > 0 ? html : '<div class="no-data">No sources yet</div>';
}

function displayFreshnessStats(extractedUrls) {
    const container = document.getElementById('freshnessStats');
    if (!container) return;

    const now = Date.now() / 1000;
    let totalWithDates = 0;
    let fresh24h = 0, fresh7d = 0, fresh30d = 0, older = 0;
    let totalAge = 0;

    extractedUrls.forEach(conversation => {
        if (!conversation.questions) return;
        conversation.questions.forEach(question => {
            question.urls.forEach(url => {
                if (url.pubDate) {
                    totalWithDates++;
                    const ageSeconds = now - url.pubDate;
                    totalAge += ageSeconds;

                    if (ageSeconds < 86400) fresh24h++;
                    else if (ageSeconds < 604800) fresh7d++;
                    else if (ageSeconds < 2592000) fresh30d++;
                    else older++;
                }
            });
        });
    });

    if (totalWithDates === 0) {
        container.innerHTML = '<div class="no-data">No publication dates available</div>';
        return;
    }

    const avgAgeDays = Math.floor(totalAge / totalWithDates / 86400);

    container.innerHTML = `
        <div class="stat-item">
            <div class="stat-value">${fresh24h}</div>
            <div class="stat-desc">Last 24 hours</div>
        </div>
        <div class="stat-item">
            <div class="stat-value">${fresh7d}</div>
            <div class="stat-desc">Last week</div>
        </div>
        <div class="stat-item">
            <div class="stat-value">${fresh30d}</div>
            <div class="stat-desc">Last month</div>
        </div>
        <div class="stat-item">
            <div class="stat-value">${avgAgeDays}d</div>
            <div class="stat-desc">Average age</div>
        </div>
    `;
}

function displaySearchIntentStats(extractedUrls) {
    const container = document.getElementById('searchIntentStats');
    if (!container) return;

    let totalQuestions = 0;
    let highSearch = 0, mediumSearch = 0, noSearch = 0;
    let triggered = 0;

    extractedUrls.forEach(conversation => {
        if (!conversation.questions) return;
        conversation.questions.forEach(question => {
            totalQuestions++;

            if (question.searchIntent) {
                const totalSearchProb = question.searchIntent.simple_search_prob + question.searchIntent.complex_search_prob;
                const maxProb = Math.max(
                    question.searchIntent.simple_search_prob,
                    question.searchIntent.complex_search_prob,
                    question.searchIntent.no_search_prob
                );

                if (maxProb === question.searchIntent.no_search_prob) {
                    noSearch++;
                } else if (totalSearchProb > 0.7) {
                    highSearch++;
                } else {
                    mediumSearch++;
                }

                if (question.searchIntent.search_decision) {
                    triggered++;
                }
            }
        });
    });

    if (totalQuestions === 0) {
        container.innerHTML = '<div class="no-data">No search intent data available</div>';
        return;
    }

    const searchRate = (triggered / totalQuestions * 100).toFixed(0);

    container.innerHTML = `
        <div class="stat-item intent-high">
            <div class="stat-value">${highSearch}</div>
            <div class="stat-desc">High search prob</div>
        </div>
        <div class="stat-item intent-medium">
            <div class="stat-value">${mediumSearch}</div>
            <div class="stat-desc">Medium prob</div>
        </div>
        <div class="stat-item intent-none">
            <div class="stat-value">${noSearch}</div>
            <div class="stat-desc">No search</div>
        </div>
        <div class="stat-item">
            <div class="stat-value">${searchRate}%</div>
            <div class="stat-desc">Search trigger rate</div>
        </div>
    `;
}

// Exact-or-subdomain match: "example.com" matches "example.com" and "www.example.com"
// but NOT "notexample.com" or "examplecom".
function domainMatches(candidate, target) {
    if (!candidate || !target) return false;
    const c = String(candidate).toLowerCase();
    const t = String(target).toLowerCase().replace(/^\./, '');
    return c === t || c.endsWith('.' + t);
}

async function trackYourDomain() {
    const domainInput = document.getElementById('yourDomainInput');
    const statsContainer = document.getElementById('yourDomainStats');

    if (!domainInput || !statsContainer) return;

    const raw = domainInput.value.trim().toLowerCase();
    if (!raw) {
        showToast('Please enter a domain (e.g. example.com).', 'error');
        return;
    }

    // Strip protocol and trailing path/slash to be forgiving with user input
    const domain = raw
        .replace(/^https?:\/\//, '')
        .replace(/\/.*$/, '')
        .replace(/^www\./, '');

    if (!domain || !domain.includes('.')) {
        showToast('That does not look like a valid domain.', 'error');
        return;
    }

    await chrome.storage.local.set({ trackedDomain: domain });

    const { extractedUrls = [] } = await chrome.storage.local.get('extractedUrls');

    let yourMentions = 0;   // appears anywhere (retrieved or cited)
    let yourCited = 0;      // actually surfaced in an answer
    let totalUrls = 0;
    let totalCited = 0;

    const isCited = (url) => url.cited !== false;

    extractedUrls.forEach(conversation => {
        const questions = conversation.questions || (conversation.urls ? [{ urls: conversation.urls }] : []);
        questions.forEach(question => {
            (question.urls || []).forEach(url => {
                totalUrls++;
                if (isCited(url)) totalCited++;
                if (domainMatches(url.domain, domain)) {
                    yourMentions++;
                    if (isCited(url)) yourCited++;
                }
            });
        });
    });

    // Share of voice on the citation layer is the metric that matters for GEO:
    // your cited mentions vs. everyone's cited mentions.
    const citationShare = totalCited > 0 ? (yourCited / totalCited * 100).toFixed(1) : '0.0';
    const mentionShare = totalUrls > 0 ? (yourMentions / totalUrls * 100).toFixed(1) : '0.0';

    let html = `
        <div class="domain-perf-header"><strong>${escapeHtml(domain)}</strong></div>
        <div class="stat-item intent-high">
            <div class="stat-value">${yourCited}</div>
            <div class="stat-desc">Cited</div>
        </div>
        <div class="stat-item">
            <div class="stat-value">${yourMentions}</div>
            <div class="stat-desc">Total mentions</div>
        </div>
        <div class="stat-item">
            <div class="stat-value">${citationShare}%</div>
            <div class="stat-desc">Citation share</div>
        </div>
        <div class="stat-item">
            <div class="stat-value">${mentionShare}%</div>
            <div class="stat-desc">Mention share</div>
        </div>
    `;

    if (yourMentions === 0) {
        html += '<div class="alert-warning">Your domain was not found in the extracted results.</div>';
    } else if (yourCited === 0) {
        html += '<div class="alert-warning">Retrieved but never cited — the model saw you but did not surface you.</div>';
    } else if (Number(citationShare) > 20) {
        html += '<div class="alert-success">Strong citation share across these conversations.</div>';
    }

    statsContainer.innerHTML = html;
    statsContainer.hidden = false;
}
