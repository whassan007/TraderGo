/* ══════════════════════════════════════════════════════════════════
   DASHBOARD.JS — TradingView-Style Dashboard Orchestrator
   ══════════════════════════════════════════════════════════════════ */

(function () {
    'use strict';

    let cycleCount = 0;
    let countdownSec = 300;
    let countdownInterval = null;
    let microTickInterval = null;

    const $ = id => document.getElementById(id);

    // ── Boot Sequence ───────────────────────────────────────────────
    async function runBootSequence() {
        const overlay = $('boot-overlay');
        const bar = $('boot-progress-bar');
        const log = $('boot-log');

        const steps = [
            { msg: '[SYS] Initializing cloud-native trading infrastructure…', pct: 10 },
            { msg: '[GKE] Connecting to Google Kubernetes Engine cluster…', pct: 20 },
            { msg: '[DATA] Loading portfolio universe (50 assets)…', pct: 30 },
            { msg: '[OHLCV] Generating historical candle data…', pct: 40 },
            { msg: '[CHART] Mounting TradingView Lightweight Charts engine…', pct: 50 },
            { msg: '[IND] Loading technical analysis library (SMA/RSI/MACD/BB/VWAP)…', pct: 60 },
            { msg: '[AGENTS] Spawning 5 forecast agents (LSTM/Transformer/Momentum/Vol/Sentiment)…', pct: 70 },
            { msg: '[MC] Initializing Monte Carlo simulation engine…', pct: 80 },
            { msg: '[FINMEM] Connecting to FinMem temporal memory store…', pct: 90 },
            { msg: '[READY] All systems nominal. Launching platform…', pct: 100 },
        ];

        for (const step of steps) {
            bar.style.width = step.pct + '%';
            const line = document.createElement('div');
            line.textContent = step.msg;
            log.appendChild(line);
            log.scrollTop = log.scrollHeight;
            await _sleep(280);
        }

        await _sleep(400);

        // Initialize everything
        MarketData.init();
        initDashboard();

        overlay.classList.add('hidden');
        setTimeout(() => overlay.style.display = 'none', 800);
    }

    // ── Initialize Dashboard ────────────────────────────────────────
    function initDashboard() {
        // Mount chart
        ChartEngine.init('chart-container');

        // Build watchlist
        buildWatchlist();

        // Wire toolbar events
        wireToolbar();

        // Run first analysis cycle
        runAnalysisCycle();

        // Start micro-tick loop (1 second)
        microTickInterval = setInterval(() => {
            MarketData.microTick();
            ChartEngine.updateLive();
            updateWatchlistPrices();
            updateToolbarPrice();
        }, 1000);

        // Start 5-min cycle loop
        setInterval(runAnalysisCycle, 300_000);

        // Clock
        updateClock();
        setInterval(updateClock, 1000);

        // Countdown
        resetCountdown();
        startCountdown();

        // Market hours
        updateMarketHours();
        setInterval(updateMarketHours, 60_000);

        $('header-status').textContent = 'ACTIVE';
    }

    // ── Analysis Cycle (every 5 min) ────────────────────────────────
    function runAnalysisCycle() {
        cycleCount++;
        $('cycle-number').textContent = cycleCount;

        // Tick market data (full 5-min step for agents)
        MarketData.tick();

        // Run original signal agents
        const agentResults = AgentFramework.runCycle();

        // Run forecast agents for selected ticker
        const selectedTicker = ChartEngine.getCurrentTicker();
        ForecastAgents.generateForecasts(selectedTicker);

        // Update chart forecasts
        ChartEngine.refreshForecasts();

        // Update panels
        updateAgentTable(selectedTicker);
        updateDisagreementPanel(selectedTicker);
        updateLiquidityMini();
        updateOptionsMini();
        updateFinMemMini(agentResults);

        // Countdown reset
        resetCountdown();
    }

    // ── Build Watchlist ─────────────────────────────────────────────
    function buildWatchlist() {
        const container = $('watchlist-list');
        container.innerHTML = '';

        MarketData.PORTFOLIO.forEach(ticker => {
            const item = document.createElement('div');
            item.className = `wl-item${ticker === 'SPY' ? ' active' : ''}`;
            item.dataset.ticker = ticker;
            item.innerHTML = `
                <span class="wl-ticker">${ticker}</span>
                <span class="wl-price" id="wl-p-${_cssId(ticker)}">—</span>
                <span class="wl-change flat" id="wl-c-${_cssId(ticker)}">0.00%</span>
            `;
            item.addEventListener('click', () => selectTicker(ticker));
            container.appendChild(item);
        });

        updateWatchlistPrices();
    }

    function updateWatchlistPrices() {
        MarketData.PORTFOLIO.forEach(ticker => {
            const price = MarketData.getPrice(ticker);
            const change = MarketData.getChangePercent(ticker);
            const pEl = $(`wl-p-${_cssId(ticker)}`);
            const cEl = $(`wl-c-${_cssId(ticker)}`);
            if (pEl && price) {
                pEl.textContent = price < 1 ? price.toFixed(4) : price < 20 ? price.toFixed(2) : price.toFixed(2);
            }
            if (cEl) {
                const sign = change >= 0 ? '+' : '';
                cEl.textContent = `${sign}${change.toFixed(2)}%`;
                cEl.className = `wl-change ${change > 0.01 ? 'up' : change < -0.01 ? 'down' : 'flat'}`;
            }
        });
    }

    function selectTicker(ticker) {
        // Update active class
        document.querySelectorAll('.wl-item').forEach(el => el.classList.remove('active'));
        const target = document.querySelector(`.wl-item[data-ticker="${ticker}"]`);
        if (target) target.classList.add('active');

        // Load chart
        ChartEngine.loadTicker(ticker, ChartEngine.getCurrentTimeframe());

        // Generate & display forecasts
        ForecastAgents.generateForecasts(ticker);
        ChartEngine.refreshForecasts();
        updateAgentTable(ticker);
        updateDisagreementPanel(ticker);
        updateToolbarPrice();
    }

    // ── Toolbar Wiring ──────────────────────────────────────────────
    function wireToolbar() {
        // Timeframe buttons
        document.querySelectorAll('.tf-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                ChartEngine.setTimeframe(parseInt(btn.dataset.tf));
            });
        });

        // Indicator toggles
        document.querySelectorAll('.ind-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                btn.classList.toggle('active');
                ChartEngine.toggleIndicator(btn.dataset.ind);
            });
        });

        // Watchlist search
        const search = $('wl-search');
        if (search) {
            search.addEventListener('input', () => {
                const q = search.value.toUpperCase();
                document.querySelectorAll('.wl-item').forEach(item => {
                    item.style.display = item.dataset.ticker.includes(q) ? '' : 'none';
                });
            });
        }
    }

    function updateToolbarPrice() {
        const ticker = ChartEngine.getCurrentTicker();
        const price = MarketData.getPrice(ticker);
        const change = MarketData.getChangePercent(ticker);
        $('toolbar-ticker').textContent = ticker;
        if (price) $('toolbar-price').textContent = `$${price.toFixed(2)}`;
        if (change !== undefined) {
            const el = $('toolbar-change');
            const sign = change >= 0 ? '+' : '';
            el.textContent = `${sign}${change.toFixed(2)}%`;
            el.className = `ticker-change ${change > 0 ? 'up' : change < 0 ? 'down' : ''}`;
        }
    }

    // ── Agent Forecast Table ────────────────────────────────────────
    function updateAgentTable(ticker) {
        const tbody = $('agent-tbody');
        const allForecasts = ForecastAgents.getForecasts(ticker);
        if (!allForecasts || Object.keys(allForecasts).length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="placeholder-cell">Awaiting forecasts…</td></tr>';
            return;
        }

        let html = '';
        const agents = [...ForecastAgents.AGENTS, { id: 'ensemble', name: 'Ensemble', color: ForecastAgents.ENSEMBLE_COLOR }];

        agents.forEach(agent => {
            const f = allForecasts[agent.id];
            if (!f) return;
            const isEnsemble = agent.id === 'ensemble';
            const dirClass = f.direction === 'BULLISH' ? 'bullish' : f.direction === 'BEARISH' ? 'bearish' : 'neutral';
            const dirIcon = f.direction === 'BULLISH' ? '▲' : f.direction === 'BEARISH' ? '▼' : '—';

            html += `<tr class="${isEnsemble ? 'ensemble-row' : ''}">
                <td><div class="agent-name-cell">
                    <span class="agent-dot" style="background:${agent.color}"></span>
                    <span class="agent-name">${agent.name}</span>
                </div></td>
                <td class="agent-price">$${f.predicted_price?.toFixed(2) || '—'}</td>
                <td class="agent-conf">${(f.confidence_score * 100).toFixed(0)}%</td>
                <td class="agent-dir ${dirClass}">${dirIcon} ${f.direction?.substring(0, 4) || '—'}</td>
            </tr>`;
        });

        tbody.innerHTML = html;
    }

    // ── Disagreement Panel ──────────────────────────────────────────
    function updateDisagreementPanel(ticker) {
        const d = ForecastAgents.getDisagreement(ticker);
        $('disagree-score').textContent = d.score.toFixed(2) + '%';
        const scoreEl = $('disagree-score');
        scoreEl.style.color = d.score > 0.5 ? 'var(--red)' : d.score > 0.2 ? 'var(--yellow)' : 'var(--green)';
        scoreEl.style.background = d.score > 0.5 ? 'rgba(239,68,68,0.1)' : d.score > 0.2 ? 'rgba(234,179,8,0.1)' : 'rgba(34,197,94,0.1)';

        const grid = $('heatmap-grid');
        let html = '';
        const entries = Object.entries(d.details || {});
        entries.forEach(([key, val]) => {
            const cls = val > 0.5 ? 'high' : val > 0.2 ? 'mid' : 'low';
            html += `<div class="heatmap-cell ${cls}" title="${key}">${key.replace(' vs ', '\n')}\n${val.toFixed(2)}%</div>`;
        });
        grid.innerHTML = html || '<div class="heatmap-cell" style="grid-column:1/-1;color:var(--text-dim)">No data yet</div>';
    }

    // ── Liquidity Mini ──────────────────────────────────────────────
    function updateLiquidityMini() {
        $('liq-score-mini').textContent = MarketData.getLiquidityScore().toFixed(1);
        $('liq-spread').textContent = MarketData.getSpreadStatus();
        $('liq-vol').textContent = MarketData.getVolumeRunRate() + ' vs avg';
        $('liq-vix').textContent = MarketData.getVIX().toFixed(2);
    }

    // ── Options Mini ────────────────────────────────────────────────
    function updateOptionsMini() {
        const events = OptionsAnalyzer.getSpotlightEvents();
        const container = $('options-mini');
        if (events.length === 0) {
            container.innerHTML = '<div class="opt-row" style="color:var(--text-dim)">No notable events</div>';
            return;
        }
        container.innerHTML = events.slice(0, 6).map(e => {
            const cls = e.includes('spiking') ? 'bearish' : 'bullish';
            const ticker = e.split(':')[0];
            return `<div class="opt-row"><span class="opt-ticker ${cls}">${ticker}</span>: ${e.split(':').slice(1).join(':').trim()}</div>`;
        }).join('');
    }

    // ── FinMem Mini ─────────────────────────────────────────────────
    function updateFinMemMini(results) {
        const recall = AgentFramework.getMemoryRecall();
        const risk = AgentFramework.getRiskAlert(results);

        // getMemoryRecall returns an array
        const recallText = Array.isArray(recall) ? recall[0] : (recall || 'No strong pattern matches.');
        $('memory-recall-mini').textContent = recallText;

        const riskEl = $('risk-alert-mini');
        const badge = $('anomaly-badge');

        // getRiskAlert returns { level, message }
        const riskMsg = typeof risk === 'object' ? risk.message : risk;
        const riskLevel = typeof risk === 'object' ? risk.level : 'nominal';

        if (riskLevel !== 'nominal') {
            riskEl.textContent = '⚠️ ' + riskMsg;
            riskEl.style.color = 'var(--red)';
            badge.textContent = 'ALERT';
            badge.classList.add('alert');
        } else {
            riskEl.textContent = '🟢 All systems nominal';
            riskEl.style.color = 'var(--green)';
            badge.textContent = 'NOMINAL';
            badge.classList.remove('alert');
        }
    }

    // ── Clock & Countdown ───────────────────────────────────────────
    function updateClock() {
        const now = new Date();
        const y = now.getFullYear();
        const mo = String(now.getMonth() + 1).padStart(2, '0');
        const d = String(now.getDate()).padStart(2, '0');
        const h = String(now.getHours()).padStart(2, '0');
        const mi = String(now.getMinutes()).padStart(2, '0');
        const s = String(now.getSeconds()).padStart(2, '0');
        $('header-timestamp').textContent = `${y}-${mo}-${d} ${h}:${mi}:${s}`;
    }

    function startCountdown() {
        countdownInterval = setInterval(() => {
            countdownSec--;
            if (countdownSec < 0) countdownSec = 300;
            updateCountdownDisplay();
        }, 1000);
    }

    function resetCountdown() {
        countdownSec = 300;
        updateCountdownDisplay();
    }

    function updateCountdownDisplay() {
        const m = Math.floor(countdownSec / 60);
        const s = countdownSec % 60;
        $('countdown-timer').textContent = `${m}:${String(s).padStart(2, '0')}`;
    }

    function updateMarketHours() {
        const status = MarketData.getMarketStatus();
        const el = $('market-hours-status');
        const icons = { OPEN: '🟢', 'PRE-MARKET': '🟡', 'AFTER-HOURS': '🟠', CLOSED: '○' };
        el.textContent = `${icons[status] || '○'} MARKET ${status}`;
    }

    // ── Helpers ──────────────────────────────────────────────────────
    function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
    function _cssId(ticker) { return ticker.replace('.', '_'); }

    // ── Launch ──────────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', runBootSequence);

})();
