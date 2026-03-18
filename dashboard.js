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
            { msg: '[GKE] Connecting to Google Kubernetes Engine cluster…', pct: 15 },
            { msg: '[DATA] Loading portfolio universe (50 assets)…', pct: 25 },
            { msg: '[SRC] Initializing data source tracker (live/delayed/cached/model)…', pct: 35 },
            { msg: '[OHLCV] Generating historical candle data…', pct: 40 },
            { msg: '[CHART] Mounting TradingView Lightweight Charts engine…', pct: 50 },
            { msg: '[IND] Loading technical analysis library (SMA/RSI/MACD/BB/VWAP)…', pct: 60 },
            { msg: '[AGENTS] Spawning 5 forecast agents (LSTM/Transformer/Momentum/Vol/Sentiment)…', pct: 70 },
            { msg: '[BT] Initializing backtesting engine (7 algorithms)…', pct: 78 },
            { msg: '[MC] Initializing Monte Carlo simulation engine…', pct: 85 },
            { msg: '[FINMEM] Connecting to FinMem temporal memory store…', pct: 92 },
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
        await MarketData.init({ mode: 'sim' });
        try { if (typeof OptionsAnalyzer !== 'undefined') OptionsAnalyzer.init(); } catch (e) { }
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
        wireExpiryToggles();
        wireHeaderActions();
        wireBacktestModal();

        // Live mode (Finnhub) — opt-in if a key is present
        initLiveMarketIfConfigured();

        // Run first analysis cycle
        runAnalysisCycle();

        // Start micro-tick loop (1 second)
        microTickInterval = setInterval(() => {
            MarketData.microTick();
            try { if (typeof OptionsAnalyzer !== 'undefined' && OptionsAnalyzer.microTick) OptionsAnalyzer.microTick(); } catch (e) { }
            ChartEngine.updateLive();
            updateWatchlistPrices();
            updateToolbarPrice();
            updateDataSourceBadge();
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

        // Tick market data (synthetic only; live mode ingests via WS)
        MarketData.tick();

        // Tick options data (IV/PCR/GEX/strikes)
        try { if (typeof OptionsAnalyzer !== 'undefined' && OptionsAnalyzer.tick) OptionsAnalyzer.tick(); } catch (e) { }

        // Run original signal agents
        const agentResults = AgentFramework.runCycle();

        // Run forecast agents for selected ticker
        const selectedTicker = ChartEngine.getCurrentTicker();
        const tf = ChartEngine.getCurrentTimeframe();
        const adr = ChartEngine.getADRState(selectedTicker, tf, 20);
        ForecastAgents.generateForecasts(selectedTicker, tf, { adr });

        // Make ADR available to options analyzer (volatility correlation checks)
        try {
            if (typeof OptionsAnalyzer !== 'undefined' && OptionsAnalyzer.setADR) {
                OptionsAnalyzer.setADR(selectedTicker, tf, { value: adr.value, percentage: adr.percentage, period: adr.period });
            }
        } catch (e) { }

        // Update strike surface overlay (expiry horizons)
        try {
            if (typeof OptionsAnalyzer !== 'undefined' && OptionsAnalyzer.getExpiryStrikes) {
                ChartEngine.setExpiryStrikes(OptionsAnalyzer.getExpiryStrikes(selectedTicker));
            }
        } catch (e) { }

        // Update chart forecasts
        ChartEngine.refreshForecasts();

        // Update panels
        updateAgentTable(selectedTicker);
        updateDisagreementPanel(selectedTicker);
        updateLiquidityMini();
        updateAdrMini(selectedTicker, tf, adr);
        updateOptionsMini();
        updateFinMemMini(agentResults);

        // Countdown reset
        resetCountdown();
    }

    // ── Live Market Bootstrap (Finnhub) ─────────────────────────────
    async function initLiveMarketIfConfigured() {
        try {
            const key = (typeof window !== 'undefined' && window.__FINNHUB_API_KEY)
                || ((typeof localStorage !== 'undefined') ? localStorage.getItem('FINNHUB_API_KEY') : null);
            if (!key || typeof LiveMarketConnector === 'undefined') return;

            // Switch to live mode and subscribe all portfolio tickers
            await LiveMarketConnector.init({ apiKey: key, tickers: MarketData.PORTFOLIO, timeframes: [1, 5, 15, 60], bars: 500 });
            LiveMarketConnector.subscribeAll(MarketData.PORTFOLIO);
        } catch (e) { }
    }

    // ── Header Actions (Mode + Cache) ────────────────────────────────
    function wireHeaderActions() {
        const liveBtn = $('mode-live');
        const btBtn = $('mode-backtest');
        if (liveBtn && btBtn) {
            liveBtn.addEventListener('click', () => {
                liveBtn.classList.add('active');
                btBtn.classList.remove('active');
                closeBacktestModal();
            });

            btBtn.addEventListener('click', () => {
                btBtn.classList.add('active');
                liveBtn.classList.remove('active');
                openBacktestModal();
            });
        }

        const clearBtn = $('clear-cache-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', async () => {
                if (confirm('Force clear app cache and reload?\n\nThis will fetch the latest deployed code and wipe local data.')) {
                    clearBtn.style.opacity = '0.5';
                    try {
                        if ('caches' in window) {
                            const keys = await caches.keys();
                            await Promise.all(keys.map(k => caches.delete(k)));
                        }
                        localStorage.clear();
                        sessionStorage.clear();
                        if ('serviceWorker' in navigator) {
                            const regs = await navigator.serviceWorker.getRegistrations();
                            for (let r of regs) await r.unregister();
                        }
                        window.location.reload(true);
                    } catch (e) {
                        console.error('Cache clear failed', e);
                        alert('Force reload executed (CacheStorage failed).');
                        window.location.reload(true);
                    }
                }
            });
        }

        // Keep Ctrl/Cmd+B shortcut
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
                e.preventDefault();
                const modal = $('backtest-modal');
                if (modal.style.display === 'none') {
                    btBtn.click();
                } else {
                    liveBtn.click();
                }
            }
        });
    }

    function openBacktestModal() {
        const modal = $('backtest-modal');
        if (!modal) return;
        modal.style.display = 'flex';

        // Update ticker label to current chart ticker
        const ticker = ChartEngine.getCurrentTicker();
        const tickerLabel = $('bt-ticker-label');
        if (tickerLabel) tickerLabel.textContent = ticker;

        // Populate algorithm grid if empty
        const grid = $('bt-algo-grid');
        if (grid && grid.children.length === 0) {
            _populateAlgoGrid(grid);
        }

        // Reset to config view
        $('bt-config').style.display = 'block';
        $('bt-progress').style.display = 'none';
        $('bt-results').style.display = 'none';
    }

    function closeBacktestModal() {
        const modal = $('backtest-modal');
        if (modal) modal.style.display = 'none';
        try { BacktestCharts.destroy(); } catch (e) { }
        try { BacktestEngine.reset(); } catch (e) { }

        // Ensure mode toggle returns to LIVE
        const liveBtn = $('mode-live');
        const btBtn = $('mode-backtest');
        if (liveBtn) liveBtn.classList.add('active');
        if (btBtn) btBtn.classList.remove('active');
    }

    function _populateAlgoGrid(grid) {
        const algos = BacktestEngine.getAlgorithms();
        algos.forEach((algo, idx) => {
            const card = document.createElement('div');
            card.className = `bt-algo-card${algo.id === 'ensemble' ? ' active' : ''}`;
            card.dataset.algo = algo.id;
            card.innerHTML = `
                <div class="bt-algo-name">${algo.name}</div>
                <div class="bt-algo-type">${algo.type}</div>
            `;
            card.addEventListener('click', () => {
                grid.querySelectorAll('.bt-algo-card').forEach(c => c.classList.remove('active'));
                card.classList.add('active');
            });
            grid.appendChild(card);
        });
    }

    // ── Backtest Modal Wiring ────────────────────────────────────────
    function wireBacktestModal() {
        const closeBtn = $('bt-modal-close');
        const runBtn = $('bt-run-btn');
        const exportBtn = $('bt-export-btn');
        const resetBtn = $('bt-reset-btn');

        if (closeBtn) closeBtn.addEventListener('click', closeBacktestModal);

        // Day picker
        document.querySelectorAll('.bt-day-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.bt-day-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });

        // Tab switching
        document.querySelectorAll('.bt-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.bt-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                const tabName = tab.dataset.tab;
                document.querySelectorAll('.bt-tab-content').forEach(tc => tc.style.display = 'none');
                const target = $(`bt-tab-${tabName}`);
                if (target) target.style.display = 'block';

                // Re-render equity chart on tab show (LightweightCharts needs visible container)
                if (tabName === 'equity' && BacktestEngine.getEquityCurve().length > 0) {
                    setTimeout(() => BacktestCharts.renderEquityCurve('bt-equity-chart'), 50);
                }
            });
        });

        // Run button
        if (runBtn) {
            runBtn.addEventListener('click', async () => {
                const algoCard = document.querySelector('.bt-algo-card.active');
                const dayBtn = document.querySelector('.bt-day-btn.active');
                const algo = algoCard ? algoCard.dataset.algo : 'ensemble';
                const days = dayBtn ? parseInt(dayBtn.dataset.days) : 3;
                const ticker = $('bt-ticker-label')?.textContent || ChartEngine.getCurrentTicker();
                const key = _getApiKey();

                if (!key) {
                    alert('No Finnhub API key found. Please set window.__FINNHUB_API_KEY in config.js');
                    return;
                }

                // Show progress
                $('bt-config').style.display = 'none';
                $('bt-progress').style.display = 'block';
                $('bt-results').style.display = 'none';
                $('bt-progress-pct').textContent = '0%';
                $('bt-progress-fill').style.width = '0%';
                runBtn.disabled = true;

                let loadPct = 0, replayPct = 0;

                const ok = await BacktestEngine.init({
                    algorithm: algo,
                    days,
                    ticker,
                    apiKey: key,
                    onProgress: (p) => {
                        if (p.phase === 'load') loadPct = (p.done / p.total) * 100;
                        else if (p.phase === 'replay') replayPct = (p.done / p.total) * 100;
                        const pct = (loadPct * 0.3 + replayPct * 0.7);
                        $('bt-progress-pct').textContent = `${pct.toFixed(0)}%`;
                        $('bt-progress-fill').style.width = `${pct.toFixed(0)}%`;
                    },
                });

                if (!ok) {
                    $('bt-progress').style.display = 'none';
                    $('bt-config').style.display = 'block';
                    runBtn.disabled = false;
                    alert('Failed to load backtest data. The API may be rate-limited or the ticker has no data.');
                    return;
                }

                await BacktestEngine.run();

                // Show results
                $('bt-progress').style.display = 'none';
                $('bt-results').style.display = 'block';
                runBtn.disabled = false;

                const metrics = BacktestEngine.getMetrics();
                if (metrics) {
                    $('bt-result-algo').textContent = `${metrics.algorithm} — ${metrics.ticker}`;
                    $('bt-result-period').textContent = metrics.period;
                    BacktestCharts.renderMetricsCards('bt-metrics-container');
                    BacktestCharts.renderEquityCurve('bt-equity-chart');
                    BacktestCharts.renderTradeLog('bt-trade-log');
                }
            });
        }

        // Export
        if (exportBtn) {
            exportBtn.addEventListener('click', () => {
                const json = BacktestEngine.exportJSON();
                if (!json) return;
                const blob = new Blob([json], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `backtest_${new Date().toISOString().slice(0, 10)}.json`;
                a.click();
                URL.revokeObjectURL(url);
            });
        }

        // Reset (new test)
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                BacktestCharts.destroy();
                BacktestEngine.reset();
                $('bt-config').style.display = 'block';
                $('bt-results').style.display = 'none';
                $('bt-progress').style.display = 'none';

                // Update ticker
                const ticker = ChartEngine.getCurrentTicker();
                const tickerLabel = $('bt-ticker-label');
                if (tickerLabel) tickerLabel.textContent = ticker;
            });
        }

        // Close on overlay click
        const overlay = $('backtest-modal');
        if (overlay) {
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) closeBacktestModal();
            });
        }
    }

    function _getApiKey() {
        return (typeof window !== 'undefined' && window.__FINNHUB_API_KEY)
            || ((typeof localStorage !== 'undefined') ? localStorage.getItem('FINNHUB_API_KEY') : null);
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
        const tf = ChartEngine.getCurrentTimeframe();
        const adr = ChartEngine.getADRState(ticker, tf, 20);
        ForecastAgents.generateForecasts(ticker, tf, { adr });
        try {
            if (typeof OptionsAnalyzer !== 'undefined' && OptionsAnalyzer.setADR) {
                OptionsAnalyzer.setADR(ticker, tf, { value: adr.value, percentage: adr.percentage, period: adr.period });
            }
        } catch (e) { }

        try {
            if (typeof OptionsAnalyzer !== 'undefined' && OptionsAnalyzer.getExpiryStrikes) {
                ChartEngine.setExpiryStrikes(OptionsAnalyzer.getExpiryStrikes(ticker));
            }
        } catch (e) { }
        ChartEngine.refreshForecasts();
        updateAgentTable(ticker);
        updateDisagreementPanel(ticker);
        updateAdrMini(ticker, tf, adr);
        updateToolbarPrice();
    }

    // ── Toolbar Wiring ──────────────────────────────────────────────
    function wireToolbar() {
        // Timeframe buttons
        document.querySelectorAll('.tf-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const tf = parseInt(btn.dataset.tf);
                ChartEngine.setTimeframe(tf);
                // Regenerate forecasts with new timeframe step interval
                const ticker = ChartEngine.getCurrentTicker();
                const adr = ChartEngine.getADRState(ticker, tf, 20);
                ForecastAgents.generateForecasts(ticker, tf, { adr });
                try {
                    if (typeof OptionsAnalyzer !== 'undefined' && OptionsAnalyzer.setADR) {
                        OptionsAnalyzer.setADR(ticker, tf, { value: adr.value, percentage: adr.percentage, period: adr.period });
                    }
                } catch (e) { }
                try {
                    if (typeof OptionsAnalyzer !== 'undefined' && OptionsAnalyzer.getExpiryStrikes) {
                        ChartEngine.setExpiryStrikes(OptionsAnalyzer.getExpiryStrikes(ticker));
                    }
                } catch (e) { }
                ChartEngine.refreshForecasts();
                updateAdrMini(ticker, tf, adr);
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

    // ── Expiry strike toggles (0DTE / Weekly / Monthly) ─────────────
    function wireExpiryToggles() {
        const map = [
            { id: 'toggle-0dte', horizon: '0dte' },
            { id: 'toggle-weekly', horizon: 'weekly' },
            { id: 'toggle-monthly', horizon: 'monthly' }
        ];

        map.forEach(({ id, horizon }) => {
            const btn = $(id);
            if (!btn) return;
            btn.addEventListener('click', () => {
                btn.classList.toggle('active');
                const visible = btn.classList.contains('active');
                try { ChartEngine.setExpiryVisibility(horizon, visible); } catch (e) { }
            });
        });
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

    // ── Data Source Badge ────────────────────────────────────────────
    function updateDataSourceBadge() {
        const ticker = ChartEngine.getCurrentTicker();
        const badge = $('toolbar-source-badge');
        if (!badge) return;

        const ds = MarketData.getDataSource(ticker);
        const sourceMap = {
            'live':            { icon: '🟢', label: 'LIVE',    cls: 'src-live' },
            'delayed':         { icon: '🟡', label: 'DELAYED', cls: 'src-delayed' },
            'cached':          { icon: '🟠', label: 'CACHED',  cls: 'src-cached' },
            'model-generated': { icon: '⚪', label: 'MODEL',   cls: 'src-model' },
        };
        const info = sourceMap[ds.source] || sourceMap['model-generated'];

        badge.textContent = `${info.icon} ${info.label}`;
        badge.className = `data-source-badge ${info.cls}`;

        // Tooltip with staleness
        const staleSec = Math.round(ds.staleSec);
        badge.title = `Source: ${ds.source} · ${staleSec < 999999 ? staleSec + 's ago' : '—'}`;
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

    // ── ADR Mini ────────────────────────────────────────────────────
    function updateAdrMini(ticker, tf, adrState) {
        const adr = adrState || ChartEngine.getADRState(ticker, tf, 20);
        const badge = $('adr-badge');
        const rangeEl = $('adr-range');
        const trendEl = $('adr-trend');
        if (!badge || !rangeEl || !trendEl) return;

        const value = Number.isFinite(adr.value) ? adr.value : 0;
        const pct = Number.isFinite(adr.percentage) ? adr.percentage : 0;
        rangeEl.textContent = `±$${value.toFixed(2)} (${pct.toFixed(2)}%)`;

        const prev = adr.prevValue;
        const delta = (typeof prev === 'number' && Number.isFinite(prev)) ? (value - prev) : 0;
        const arrow = delta > 1e-6 ? '▲' : delta < -1e-6 ? '▼' : '→';
        const deltaPct = (typeof prev === 'number' && prev > 0) ? (delta / prev) * 100 : 0;
        trendEl.textContent = `${arrow} ${Math.abs(deltaPct).toFixed(1)}%`;

        // High/Normal/Low indicator relative to current candle range vs ADR
        const candles = MarketData.getOHLCV(ticker, tf);
        const last = candles && candles.length ? candles[candles.length - 1] : null;
        const currRange = last ? Math.max(0, (last.high - last.low)) : 0;
        const ratio = value > 0 ? (currRange / value) : 0;
        let state = 'normal';
        let label = 'NORMAL';
        if (ratio > 1.2) { state = 'high'; label = 'HIGH'; }
        else if (ratio < 0.5) { state = 'low'; label = 'LOW'; }

        badge.classList.remove('low', 'normal', 'high');
        badge.classList.add(state);
        badge.textContent = label;
    }

    // ── Options Mini ────────────────────────────────────────────────
    function updateOptionsMini() {
        const events = OptionsAnalyzer.getSpotlightEvents();
        const container = $('options-mini');
        const ticker = ChartEngine.getCurrentTicker();
        const mag = (typeof OptionsAnalyzer !== 'undefined' && OptionsAnalyzer.getStrikeMagnetSignal)
            ? OptionsAnalyzer.getStrikeMagnetSignal(ticker)
            : null;
        const skew = (typeof OptionsAnalyzer !== 'undefined' && OptionsAnalyzer.getExpiryStrikes)
            ? OptionsAnalyzer.getExpiryStrikes(ticker)?.skew
            : null;

        let head = '';
        if (mag) {
            const cls = mag.signal === 'BULLISH' ? 'bullish' : mag.signal === 'BEARISH' ? 'bearish' : 'neutral';
            const dotCls = cls;
            const pin = mag.pinning && mag.nearestStrike ? ` · pinning $${mag.nearestStrike.toFixed(0)}` : '';
            const skewTxt = skew && typeof skew.bias === 'number'
                ? (skew.bias > 0.08 ? ' · call-skew' : skew.bias < -0.08 ? ' · put-skew' : ' · balanced skew')
                : '';
            head = `<div class="opt-row">
                <span class="strike-magnet-signal ${dotCls}">
                    <span class="mag-dot"></span>
                    MAGNET ${mag.signal}
                    <span class="mag-sub">${(mag.strength * 100).toFixed(0)}%${pin}${skewTxt}</span>
                </span>
            </div>`;
        }

        const body = events.slice(0, 6).map(e => {
            const msg = typeof e === 'string' ? e : `${e.ticker}: ${e.message}`;
            const cls = msg.includes('spiking') ? 'bearish' : 'bullish';
            const ticker2 = msg.split(':')[0];
            return `<div class="opt-row"><span class="opt-ticker ${cls}">${ticker2}</span>: ${msg.split(':').slice(1).join(':').trim()}</div>`;
        }).join('');

        const empty = events.length === 0 ? '<div class="opt-row" style="color:var(--text-dim)">No notable events</div>' : '';
        container.innerHTML = head + (body || empty);
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
