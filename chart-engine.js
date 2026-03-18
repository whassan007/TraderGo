/* ══════════════════════════════════════════════════════════════════
   CHART-ENGINE.JS — TradingView Lightweight Charts Integration
   ══════════════════════════════════════════════════════════════════ */

const ChartEngine = (() => {

    let chart = null;
    let candleSeries = null;
    let volumeSeries = null;
    let currentTicker = 'SPY';
    let currentTimeframe = 5;

    // Indicator series references
    let indicatorSeries = {};
    let forecastSeries = {};
    let monteCarloSeries = [];

    // S&R series & DOM overlay
    let srPriceLines = [];
    let srAreaSeries = [];
    let srBreakoutMarkers = [];
    let srOverlayEl = null;

    // ADR overlay state (per ticker+timeframe cached)
    const _adrCache = {}; // { [key]: { adr, lastCandleTime, prevValue } }
    let adrLineSeries = { upper: null, lower: null };
    let adrBandEl = null;
    let adrOverlayEl = null;
    let _adrLastKey = null;

    // Expiry strikes overlay (DOM) + visibility toggles
    let expiryOverlayEl = null;
    let expiryStrikeData = { '0dte': [], weekly: [], monthly: [], skew: null };
    let expiryVisible = { '0dte': true, weekly: true, monthly: false };

    // Active indicators
    let activeIndicators = new Set();

    // ── Indicator colors ────────────────────────────────────────────
    const INDICATOR_COLORS = {
        sma20: '#eab308',
        sma50: '#f97316',
        ema12: '#06b6d4',
        ema26: '#8b5cf6',
        bb_upper: 'rgba(139,92,246,0.3)',
        bb_lower: 'rgba(139,92,246,0.3)',
        bb_mid: 'rgba(139,92,246,0.6)',
        vwap: '#ec4899'
    };

    const ADR_STYLE = {
        lineColor: 'rgba(100, 200, 255, 0.55)',
        bandFill: 'rgba(100, 200, 255, 0.15)'
    };

    // ── Initialize Chart ────────────────────────────────────────────
    function init(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        chart = LightweightCharts.createChart(container, {
            layout: {
                background: { type: 'solid', color: 'transparent' },
                textColor: '#94a3b8',
                fontSize: 11,
                fontFamily: "'JetBrains Mono', monospace"
            },
            grid: {
                vertLines: { color: 'rgba(56, 189, 248, 0.04)' },
                horzLines: { color: 'rgba(56, 189, 248, 0.04)' }
            },
            crosshair: {
                mode: LightweightCharts.CrosshairMode.Normal,
                vertLine: { color: 'rgba(56, 189, 248, 0.3)', width: 1, style: 2 },
                horzLine: { color: 'rgba(56, 189, 248, 0.3)', width: 1, style: 2 }
            },
            rightPriceScale: {
                borderColor: 'rgba(56, 189, 248, 0.1)',
                scaleMargins: { top: 0.1, bottom: 0.2 }
            },
            timeScale: {
                borderColor: 'rgba(56, 189, 248, 0.1)',
                timeVisible: true,
                secondsVisible: false,
                rightOffset: 12,
                barSpacing: 8
            },
            handleScroll: { vertTouchDrag: false },
            handleScale: { axisPressedMouseMove: true }
        });

        // Candlestick series
        candleSeries = chart.addCandlestickSeries({
            upColor: '#22c55e',
            downColor: '#ef4444',
            borderDownColor: '#ef4444',
            borderUpColor: '#22c55e',
            wickDownColor: '#ef4444',
            wickUpColor: '#22c55e'
        });

        // Volume histogram
        volumeSeries = chart.addHistogramSeries({
            priceFormat: { type: 'volume' },
            priceScaleId: 'volume',
            scaleMargins: { top: 0.85, bottom: 0 }
        });

        chart.priceScale('volume').applyOptions({
            scaleMargins: { top: 0.85, bottom: 0 }
        });

        // Responsive
        const ro = new ResizeObserver(() => {
            chart.applyOptions({
                width: container.clientWidth,
                height: container.clientHeight
            });
        });
        ro.observe(container);

        // Load initial data
        loadTicker('SPY', 5);
    }

    // ── Load Ticker ─────────────────────────────────────────────────
    function loadTicker(ticker, timeframe) {
        currentTicker = ticker;
        currentTimeframe = timeframe || currentTimeframe;

        const candles = MarketData.getOHLCV(ticker, currentTimeframe);
        if (!candles || candles.length === 0) return;

        // Set candle data
        candleSeries.setData(candles.map(c => ({
            time: c.time,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close
        })));

        // Set volume data
        volumeSeries.setData(candles.map(c => ({
            time: c.time,
            value: c.volume,
            color: c.close >= c.open
                ? 'rgba(34, 197, 94, 0.25)'
                : 'rgba(239, 68, 68, 0.25)'
        })));

        // Refresh indicators
        _refreshIndicators(candles);

        // Refresh S&R
        if (activeIndicators.has('sr')) _refreshSR(ticker, candles);

        // Refresh ADR
        if (activeIndicators.has('adr')) _refreshADR(ticker, candles);

        // Refresh forecasts
        _refreshForecasts(ticker);

        // Refresh expiry strikes overlay
        _refreshExpiryOverlay();

        chart.timeScale().fitContent();
    }

    // ── Update Live Candle (called from micro-tick loop) ────────────
    function updateLive() {
        const candle = MarketData.getLiveCandle(currentTicker, currentTimeframe);
        if (!candle) return;

        candleSeries.update({
            time: candle.time,
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close
        });

        volumeSeries.update({
            time: candle.time,
            value: candle.volume,
            color: candle.close >= candle.open
                ? 'rgba(34, 197, 94, 0.25)'
                : 'rgba(239, 68, 68, 0.25)'
        });

        // ADR band follows live price updates
        if (activeIndicators.has('adr')) {
            const candles = MarketData.getOHLCV(currentTicker, currentTimeframe);
            _refreshADR(currentTicker, candles, { liveOnly: true });
        }

        // Strike magnet layer (animate when near)
        _refreshExpiryOverlay({ liveOnly: true });
    }

    // ── Indicator Management ────────────────────────────────────────
    function toggleIndicator(name) {
        if (activeIndicators.has(name)) {
            activeIndicators.delete(name);
            _removeIndicator(name);
        } else {
            activeIndicators.add(name);
        }
        const candles = MarketData.getOHLCV(currentTicker, currentTimeframe);
        _refreshIndicators(candles);

        // S&R toggle
        if (name === 'sr') {
            if (activeIndicators.has('sr')) {
                _refreshSR(currentTicker, candles);
            } else {
                _clearSR();
            }
        }

        // ADR toggle
        if (name === 'adr') {
            if (activeIndicators.has('adr')) {
                _refreshADR(currentTicker, candles);
            } else {
                _clearADR();
            }
        }
    }

    function _removeIndicator(name) {
        if (name === 'macd') {
            ['macd_line', 'macd_signal', 'macd_hist'].forEach(k => {
                if (indicatorSeries[k]) { chart.removeSeries(indicatorSeries[k]); delete indicatorSeries[k]; }
            });
        } else if (name === 'bb') {
            ['bb_upper', 'bb_lower', 'bb_mid'].forEach(k => {
                if (indicatorSeries[k]) { chart.removeSeries(indicatorSeries[k]); delete indicatorSeries[k]; }
            });
        } else if (name === 'adr') {
            _clearADR();
        } else {
            if (indicatorSeries[name]) {
                chart.removeSeries(indicatorSeries[name]);
                delete indicatorSeries[name];
            }
        }
    }

    function _refreshIndicators(candles) {
        if (!candles || candles.length < 5) return;

        // Remove inactive
        Object.keys(indicatorSeries).forEach(key => {
            const base = key.replace(/_.*$/, '');
            const indicator = key === 'bb_upper' || key === 'bb_lower' || key === 'bb_mid' ? 'bb'
                : key === 'macd_line' || key === 'macd_signal' || key === 'macd_hist' ? 'macd'
                    : key;
            if (!activeIndicators.has(indicator)) {
                chart.removeSeries(indicatorSeries[key]);
                delete indicatorSeries[key];
            }
        });

        // SMA 20
        if (activeIndicators.has('sma20') && !indicatorSeries.sma20) {
            indicatorSeries.sma20 = chart.addLineSeries({
                color: INDICATOR_COLORS.sma20, lineWidth: 1, priceLineVisible: false, lastValueVisible: false
            });
        }
        if (activeIndicators.has('sma20')) {
            indicatorSeries.sma20.setData(Indicators.sma(candles, 20));
        }

        // SMA 50
        if (activeIndicators.has('sma50') && !indicatorSeries.sma50) {
            indicatorSeries.sma50 = chart.addLineSeries({
                color: INDICATOR_COLORS.sma50, lineWidth: 1, priceLineVisible: false, lastValueVisible: false
            });
        }
        if (activeIndicators.has('sma50')) {
            indicatorSeries.sma50.setData(Indicators.sma(candles, 50));
        }

        // EMA 12
        if (activeIndicators.has('ema12') && !indicatorSeries.ema12) {
            indicatorSeries.ema12 = chart.addLineSeries({
                color: INDICATOR_COLORS.ema12, lineWidth: 1, priceLineVisible: false, lastValueVisible: false
            });
        }
        if (activeIndicators.has('ema12')) {
            indicatorSeries.ema12.setData(Indicators.ema(candles, 12));
        }

        // EMA 26
        if (activeIndicators.has('ema26') && !indicatorSeries.ema26) {
            indicatorSeries.ema26 = chart.addLineSeries({
                color: INDICATOR_COLORS.ema26, lineWidth: 1, priceLineVisible: false, lastValueVisible: false
            });
        }
        if (activeIndicators.has('ema26')) {
            indicatorSeries.ema26.setData(Indicators.ema(candles, 26));
        }

        // Bollinger Bands
        if (activeIndicators.has('bb')) {
            const bb = Indicators.bollingerBands(candles, 20, 2);
            if (!indicatorSeries.bb_upper) {
                indicatorSeries.bb_upper = chart.addLineSeries({
                    color: INDICATOR_COLORS.bb_upper, lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false
                });
                indicatorSeries.bb_lower = chart.addLineSeries({
                    color: INDICATOR_COLORS.bb_lower, lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false
                });
                indicatorSeries.bb_mid = chart.addLineSeries({
                    color: INDICATOR_COLORS.bb_mid, lineWidth: 1, priceLineVisible: false, lastValueVisible: false
                });
            }
            indicatorSeries.bb_upper.setData(bb.upper);
            indicatorSeries.bb_lower.setData(bb.lower);
            indicatorSeries.bb_mid.setData(bb.middle);
        }

        // VWAP
        if (activeIndicators.has('vwap') && !indicatorSeries.vwap) {
            indicatorSeries.vwap = chart.addLineSeries({
                color: INDICATOR_COLORS.vwap, lineWidth: 2, lineStyle: 0, priceLineVisible: false, lastValueVisible: false
            });
        }
        if (activeIndicators.has('vwap')) {
            indicatorSeries.vwap.setData(Indicators.vwap(candles));
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    //  ADR RENDERING ENGINE
    // ═══════════════════════════════════════════════════════════════════

    function _adrKey(ticker, tf, period = 20) {
        return `${ticker}__${tf}__${period}`;
    }

    function _getADR(ticker, tf, candles, period = 20) {
        const key = _adrKey(ticker, tf, period);
        const lastTime = candles && candles.length ? candles[candles.length - 1].time : 0;
        const cached = _adrCache[key];
        if (cached && cached.lastCandleTime === lastTime) return { key, ...cached };

        const prevValue = cached?.adr?.value ?? null;
        const adr = Indicators.adr(candles || [], period);
        _adrCache[key] = { adr, lastCandleTime: lastTime, prevValue };
        return { key, adr, lastCandleTime: lastTime, prevValue };
    }

    function _clearADR() {
        // Remove dashed line series
        try { if (adrLineSeries.upper) chart.removeSeries(adrLineSeries.upper); } catch (e) { }
        try { if (adrLineSeries.lower) chart.removeSeries(adrLineSeries.lower); } catch (e) { }
        adrLineSeries = { upper: null, lower: null };

        // Remove band DOM element
        if (adrBandEl) {
            adrBandEl.remove();
            adrBandEl = null;
        }

        // Remove overlay legend
        if (adrOverlayEl) {
            adrOverlayEl.remove();
            adrOverlayEl = null;
        }

        _adrLastKey = null;
    }

    function _ensureADRSeries() {
        if (!adrLineSeries.upper) {
            adrLineSeries.upper = chart.addLineSeries({
                color: ADR_STYLE.lineColor,
                lineWidth: 1,
                lineStyle: 2, // dashed
                priceLineVisible: false,
                lastValueVisible: false,
                crosshairMarkerVisible: false
            });
        }
        if (!adrLineSeries.lower) {
            adrLineSeries.lower = chart.addLineSeries({
                color: ADR_STYLE.lineColor,
                lineWidth: 1,
                lineStyle: 2, // dashed
                priceLineVisible: false,
                lastValueVisible: false,
                crosshairMarkerVisible: false
            });
        }
    }

    function _ensureADRBandEl() {
        const container = document.getElementById('chart-container');
        if (!container) return;
        if (!adrBandEl) {
            adrBandEl = document.createElement('div');
            adrBandEl.className = 'adr-band';
            container.appendChild(adrBandEl);
        }
    }

    function _ensureADRLegendEl() {
        const container = document.getElementById('chart-container');
        if (!container) return;
        if (!adrOverlayEl) {
            adrOverlayEl = document.createElement('div');
            adrOverlayEl.className = 'adr-overlay';
            container.appendChild(adrOverlayEl);
        }
        // If S&R overlay is also present, stack ADR below it
        try {
            if (srOverlayEl && adrOverlayEl) {
                const h = srOverlayEl.getBoundingClientRect().height || 0;
                adrOverlayEl.style.top = `${8 + Math.min(260, h) + 6}px`;
            } else if (adrOverlayEl) {
                adrOverlayEl.style.top = '8px';
            }
        } catch (e) { }
    }

    function _refreshADR(ticker, candles, opts = {}) {
        if (!candles || candles.length < 2) return;

        const period = 20;
        const { key, adr, prevValue } = _getADR(ticker, currentTimeframe, candles, period);
        _adrLastKey = key;

        const firstTime = candles[0].time;
        const lastTime = candles[candles.length - 1].time;
        const lastClose = candles[candles.length - 1].close;

        const upper = lastClose + adr.value;
        const lower = lastClose - adr.value;

        _ensureADRSeries();
        adrLineSeries.upper.setData([{ time: firstTime, value: upper }, { time: lastTime, value: upper }]);
        adrLineSeries.lower.setData([{ time: firstTime, value: lower }, { time: lastTime, value: lower }]);

        // DOM band fill (uses price scale coordinates)
        _ensureADRBandEl();
        if (adrBandEl && candleSeries && typeof candleSeries.priceToCoordinate === 'function') {
            const yUpper = candleSeries.priceToCoordinate(upper);
            const yLower = candleSeries.priceToCoordinate(lower);
            if (typeof yUpper === 'number' && typeof yLower === 'number') {
                const top = Math.min(yUpper, yLower);
                const height = Math.max(2, Math.abs(yLower - yUpper));
                adrBandEl.style.top = `${top}px`;
                adrBandEl.style.height = `${height}px`;
            }
        }

        // S&R-style overlay legend (top-left)
        if (!opts.liveOnly) {
            _ensureADRLegendEl();
        }
        if (adrOverlayEl) {
            const delta = (typeof prevValue === 'number' && Number.isFinite(prevValue))
                ? adr.value - prevValue
                : 0;
            const arrow = delta > 1e-6 ? '▲' : delta < -1e-6 ? '▼' : '→';
            const deltaPct = (typeof prevValue === 'number' && prevValue > 0)
                ? (delta / prevValue) * 100
                : 0;

            adrOverlayEl.innerHTML = `
                <div class="adr-overlay-header">ADR (${adr.period})</div>
                <div class="adr-overlay-row">
                    <span>Range</span>
                    <span class="adr-val">±$${adr.value.toFixed(2)} (${adr.percentage.toFixed(2)}%)</span>
                </div>
                <div class="adr-overlay-row">
                    <span>Trend</span>
                    <span class="adr-val">${arrow} ${Math.abs(deltaPct).toFixed(1)}%</span>
                </div>
            `;
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    //  EXPIRY STRIKES (0DTE / WEEKLY / MONTHLY) OVERLAY
    // ═══════════════════════════════════════════════════════════════════

    function _ensureExpiryOverlayEl() {
        const container = document.getElementById('chart-container');
        if (!container) return;
        if (!expiryOverlayEl) {
            expiryOverlayEl = document.createElement('div');
            expiryOverlayEl.className = 'expiry-strikes';
            container.appendChild(expiryOverlayEl);
        }
    }

    function setExpiryVisibility(horizon, isVisible) {
        if (!['0dte', 'weekly', 'monthly'].includes(horizon)) return;
        expiryVisible[horizon] = !!isVisible;
        _refreshExpiryOverlay();
    }

    function setExpiryStrikes(surface) {
        expiryStrikeData = surface || { '0dte': [], weekly: [], monthly: [], skew: null };
        _refreshExpiryOverlay();
    }

    function _refreshExpiryOverlay({ liveOnly = false } = {}) {
        _ensureExpiryOverlayEl();
        if (!expiryOverlayEl || !candleSeries || typeof candleSeries.priceToCoordinate !== 'function') return;

        // Keep surface current on analysis cycles / ticker changes
        if (!liveOnly) {
            try {
                if (typeof OptionsAnalyzer !== 'undefined' && OptionsAnalyzer.getExpiryStrikes) {
                    expiryStrikeData = OptionsAnalyzer.getExpiryStrikes(currentTicker);
                }
            } catch (e) { }
        }

        const spot = MarketData.getPrice(currentTicker)
            || (MarketData.getOHLCV(currentTicker, currentTimeframe)?.slice(-1)[0]?.close)
            || 0;

        const mag = (() => {
            try {
                if (typeof OptionsAnalyzer !== 'undefined' && OptionsAnalyzer.getStrikeMagnetSignal) {
                    return OptionsAnalyzer.getStrikeMagnetSignal(currentTicker);
                }
            } catch (e) { }
            return null;
        })();

        const majorStrikes = new Set();
        if (mag?.horizons) {
            Object.values(mag.horizons).forEach(arr => (arr || []).forEach(s => majorStrikes.add(s.strike)));
        } else {
            ['0dte', 'weekly', 'monthly'].forEach(h => (expiryStrikeData?.[h] || []).forEach(s => majorStrikes.add(s.strike)));
        }

        // Build render list (avoid clutter)
        const toRender = [];
        ['0dte', 'weekly', 'monthly'].forEach(h => {
            if (!expiryVisible[h]) return;
            (expiryStrikeData?.[h] || []).forEach(s => {
                if (!s || typeof s.strike !== 'number') return;
                if (majorStrikes.has(s.strike) || (s.oi && s.oi >= 80_000)) {
                    toRender.push({ ...s, horizon: h });
                }
            });
        });

        // De-dupe by strike (keep the strongest OI)
        const byStrike = new Map();
        toRender.forEach(s => {
            const prev = byStrike.get(s.strike);
            if (!prev || (s.oi || 0) > (prev.oi || 0)) byStrike.set(s.strike, s);
        });

        const list = [...byStrike.values()].sort((a, b) => a.strike - b.strike);

        expiryOverlayEl.innerHTML = '';
        list.forEach(s => {
            const y = candleSeries.priceToCoordinate(s.strike);
            if (typeof y !== 'number') return;

            const distPct = spot > 0 ? Math.abs(s.strike - spot) / spot : 1;
            const isPinning = distPct <= 0.01; // within 1%
            const isNear = distPct <= 0.005;   // within 0.5%

            const row = document.createElement('div');
            row.className = `expiry-strike expiry-${s.horizon}` +
                (isPinning ? ' pinning-zone' : '') +
                (isNear ? ' near-strike' : '');
            row.style.top = `${Math.round(y)}px`;

            const label = document.createElement('div');
            label.className = 'strike-label';
            const oiK = s.oi ? `${Math.round(s.oi / 1000)}K` : '—';
            label.textContent = `${s.horizon.toUpperCase()} $${s.strike.toFixed(0)} · ${oiK}`;
            row.appendChild(label);

            expiryOverlayEl.appendChild(row);
        });
    }

    // ── Forecast Overlay ────────────────────────────────────────────
    function _refreshForecasts(ticker) {
        // Clear previous forecast series
        Object.values(forecastSeries).forEach(s => {
            if (s.line) chart.removeSeries(s.line);
            if (s.upper) chart.removeSeries(s.upper);
            if (s.lower) chart.removeSeries(s.lower);
        });
        forecastSeries = {};
        monteCarloSeries.forEach(s => chart.removeSeries(s));
        monteCarloSeries = [];

        const allForecasts = ForecastAgents.getForecasts(ticker);
        if (!allForecasts || Object.keys(allForecasts).length === 0) return;

        // Use last candle's time AND close price as anchor
        // (each timeframe has its own price level from independent random walks)
        const candles = MarketData.getOHLCV(ticker, currentTimeframe);
        const lastCandle = candles && candles.length > 0 ? candles[candles.length - 1] : null;
        const anchorTime = lastCandle ? lastCandle.time : Math.floor(Date.now() / 1000);
        const price = lastCandle ? lastCandle.close : MarketData.getPrice(ticker);

        // Draw each agent's forecast
        Object.values(allForecasts).forEach(f => {
            if (!f?.projections?.length) return;

            // Projection line starts from current price at anchor time
            const lineData = [{ time: anchorTime, value: price }];

            // Forecasts already have correctly-aligned times from forecast-agents.js
            f.projections.forEach(p => {
                if (p.time > anchorTime) {
                    lineData.push({ time: p.time, value: p.value });
                }
            });

            // Deduplicate times
            const seen = new Set();
            const dedupedLine = lineData.filter(d => {
                if (seen.has(d.time)) return false;
                seen.add(d.time);
                return true;
            });

            if (dedupedLine.length < 2) return;

            const line = chart.addLineSeries({
                color: f.color,
                lineWidth: f.agent_id === 'ensemble' ? 3 : 2,
                lineStyle: f.agent_id === 'ensemble' ? 0 : 2,
                priceLineVisible: false,
                lastValueVisible: true,
                crosshairMarkerVisible: false
            });
            line.setData(dedupedLine);

            // Confidence bands (ensemble only)
            const bands = ForecastAgents.getConfidenceBands(ticker, f.agent_id);
            let upper = null, lower = null;

            if (bands.upper.length > 0 && f.agent_id === 'ensemble') {
                const upperData = [{ time: anchorTime, value: price }];
                const lowerData = [{ time: anchorTime, value: price }];
                bands.upper.forEach(b => {
                    if (b.time > anchorTime) upperData.push({ time: b.time, value: b.value });
                });
                bands.lower.forEach(b => {
                    if (b.time > anchorTime) lowerData.push({ time: b.time, value: b.value });
                });

                const seenU = new Set(), seenL = new Set();
                const dedupU = upperData.filter(d => { if (seenU.has(d.time)) return false; seenU.add(d.time); return true; });
                const dedupL = lowerData.filter(d => { if (seenL.has(d.time)) return false; seenL.add(d.time); return true; });

                if (dedupU.length > 1) {
                    upper = chart.addLineSeries({
                        color: 'rgba(6, 182, 212, 0.15)', lineWidth: 1, lineStyle: 2,
                        priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false
                    });
                    upper.setData(dedupU);
                }
                if (dedupL.length > 1) {
                    lower = chart.addLineSeries({
                        color: 'rgba(6, 182, 212, 0.15)', lineWidth: 1, lineStyle: 2,
                        priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false
                    });
                    lower.setData(dedupL);
                }
            }

            forecastSeries[f.agent_id] = { line, upper, lower };
        });

        // Monte Carlo paths (thin, transparent)
        const mcPaths = ForecastAgents.getMonteCarlo(ticker);
        const maxMC = Math.min(20, mcPaths.length);
        for (let i = 0; i < maxMC; i++) {
            const pathData = [{ time: anchorTime, value: price }];
            const seen2 = new Set();
            seen2.add(anchorTime);
            mcPaths[i].forEach(p => {
                if (p.time > anchorTime && !seen2.has(p.time)) {
                    pathData.push({ time: p.time, value: p.value });
                    seen2.add(p.time);
                }
            });
            if (pathData.length > 1) {
                const s = chart.addLineSeries({
                    color: 'rgba(148, 163, 184, 0.08)', lineWidth: 1,
                    priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false
                });
                s.setData(pathData);
                monteCarloSeries.push(s);
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    //  S&R RENDERING ENGINE
    // ═══════════════════════════════════════════════════════════════════

    function _clearSR() {
        // Remove price lines from candle series
        srPriceLines.forEach(pl => {
            try { candleSeries.removePriceLine(pl); } catch (e) { }
        });
        srPriceLines = [];

        // Remove area series (consolidation range shading)
        srAreaSeries.forEach(s => {
            try { chart.removeSeries(s); } catch (e) { }
        });
        srAreaSeries = [];

        // Remove breakout markers
        srBreakoutMarkers = [];

        // Remove overlay
        if (srOverlayEl) {
            srOverlayEl.remove();
            srOverlayEl = null;
        }
    }

    function _refreshSR(ticker, candles) {
        _clearSR();
        if (!candles || candles.length < 10) return;

        const sr = Indicators.advancedSR(ticker, candles, currentTimeframe);
        if (!sr) return;

        const firstTime = candles[0].time;
        const lastTime = candles[candles.length - 1].time;

        // ── Draw S&R horizontal price lines ─────────────────────────
        sr.levels.forEach(level => {
            const info = Indicators.getSRRenderInfo(level);
            const pl = candleSeries.createPriceLine({
                price: level.value,
                color: info.color,
                lineWidth: info.lineWidth,
                lineStyle: info.isNew ? 0 : 0,  // solid
                axisLabelVisible: true,
                title: `${info.tfLabel} ${info.label}`,
            });
            srPriceLines.push(pl);
        });

        // ── Draw consolidation range shading ─────────────────────────
        sr.ranges.forEach(range => {
            // Upper bound (dashed line via a separate thin series)
            const upperLine = chart.addLineSeries({
                color: Indicators.SR_COLORS.rangeBorder,
                lineWidth: 1,
                lineStyle: 2,  // dashed
                priceLineVisible: false,
                lastValueVisible: false,
                crosshairMarkerVisible: false,
            });
            upperLine.setData([
                { time: firstTime, value: range.upper },
                { time: lastTime, value: range.upper }
            ]);
            srAreaSeries.push(upperLine);

            const lowerLine = chart.addLineSeries({
                color: Indicators.SR_COLORS.rangeBorder,
                lineWidth: 1,
                lineStyle: 2,
                priceLineVisible: false,
                lastValueVisible: false,
                crosshairMarkerVisible: false,
            });
            lowerLine.setData([
                { time: firstTime, value: range.lower },
                { time: lastTime, value: range.lower }
            ]);
            srAreaSeries.push(lowerLine);

            // Shaded fill between upper and lower via two area series
            // Upper area (fills down to the range midpoint)
            // We'll use a baselineSeries to shade between levels
            try {
                const shadeSeries = chart.addAreaSeries({
                    topColor: Indicators.SR_COLORS.rangeShade,
                    bottomColor: 'transparent',
                    lineColor: 'transparent',
                    lineWidth: 0,
                    priceLineVisible: false,
                    lastValueVisible: false,
                    crosshairMarkerVisible: false,
                    priceScaleId: 'right',
                });
                // Fill at upper bound (area fills down)
                shadeSeries.setData([
                    { time: firstTime, value: range.upper },
                    { time: lastTime, value: range.upper }
                ]);
                srAreaSeries.push(shadeSeries);
            } catch (e) { /* older LW Charts versions may not support */ }
        });

        // ── Draw breakout markers ────────────────────────────────────
        if (sr.breakouts.length > 0) {
            const markers = sr.breakouts.map(bo => ({
                time: bo.time,
                position: bo.direction === 'up' ? 'belowBar' : 'aboveBar',
                color: bo.direction === 'up'
                    ? Indicators.SR_COLORS.breakoutUp
                    : Indicators.SR_COLORS.breakoutDn,
                shape: bo.direction === 'up' ? 'arrowUp' : 'arrowDown',
                text: bo.label,
                size: bo.strength === 'strong' ? 3 : 2
            }));

            // Merge with any existing markers and sort by time
            srBreakoutMarkers = markers;
            try {
                candleSeries.setMarkers(
                    markers.sort((a, b) => a.time - b.time)
                );
            } catch (e) { }
        } else {
            try { candleSeries.setMarkers([]); } catch (e) { }
        }

        // ── Create info overlay (breakout signals legend) ───────────
        _createSROverlay(sr);
    }

    function _createSROverlay(sr) {
        if (srOverlayEl) srOverlayEl.remove();

        const container = document.getElementById('chart-container');
        if (!container) return;

        srOverlayEl = document.createElement('div');
        srOverlayEl.className = 'sr-overlay';

        let html = '<div class="sr-overlay-header">S&R LEVELS</div>';

        sr.levels.forEach(level => {
            const info = Indicators.getSRRenderInfo(level);
            const dotStyle = `width:8px;height:8px;border-radius:50%;background:${info.color};flex-shrink:0;`;
            const isNewClass = info.isNew ? ' sr-new-pulse' : '';
            html += `<div class="sr-level-row${isNewClass}">
                <span style="${dotStyle}"></span>
                <span class="sr-level-label">${info.label}</span>
                <span class="sr-level-tf">[${info.tfLabel}]</span>
                <span class="sr-level-touches">${level.touches}×</span>
            </div>`;
        });

        if (sr.ranges.length > 0) {
            sr.ranges.forEach(r => {
                html += `<div class="sr-range-row">📐 Range: $${r.lower.toFixed(2)} — $${r.upper.toFixed(2)} (${(r.width * 100).toFixed(1)}%)</div>`;
            });
        }

        if (sr.breakouts.length > 0) {
            sr.breakouts.forEach(bo => {
                const icon = bo.direction === 'up' ? '🟢' : '🔴';
                html += `<div class="sr-breakout-row">${icon} ${bo.label} @ $${bo.price.toFixed(2)}</div>`;
            });
        }

        srOverlayEl.innerHTML = html;
        container.appendChild(srOverlayEl);
    }

    // ── Get state ───────────────────────────────────────────────────
    function getCurrentTicker() { return currentTicker; }
    function getCurrentTimeframe() { return currentTimeframe; }
    function getActiveIndicators() { return new Set(activeIndicators); }

    function getADRState(ticker = currentTicker, timeframe = currentTimeframe, period = 20) {
        const candles = MarketData.getOHLCV(ticker, timeframe);
        const { adr, prevValue } = _getADR(ticker, timeframe, candles || [], period);
        return { ...adr, prevValue };
    }

    function setTimeframe(tf) {
        currentTimeframe = tf;
        loadTicker(currentTicker, tf);
    }

    // ── Refresh forecasts on chart (called after forecast cycle) ────
    function refreshForecasts() {
        _refreshForecasts(currentTicker);
    }

    return {
        init, loadTicker, updateLive, toggleIndicator, setTimeframe,
        refreshForecasts,
        getCurrentTicker, getCurrentTimeframe, getActiveIndicators,
        getADRState,
        setExpiryStrikes,
        setExpiryVisibility
    };
})();
