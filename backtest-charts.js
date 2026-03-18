/* ══════════════════════════════════════════════════════════════════
   BACKTEST-CHARTS.JS — Equity Curve & Trade Visualization
   Uses Lightweight Charts (already loaded via CDN)
   ══════════════════════════════════════════════════════════════════ */

const BacktestCharts = (() => {
    'use strict';

    let _equityChart = null;
    let _equitySeries = null;
    let _bhSeries = null;
    let _tradeMarkers = [];

    // ── Render Equity Curve ─────────────────────────────────────────
    function renderEquityCurve(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = '';

        const curve = BacktestEngine.getEquityCurve();
        if (!curve || curve.length === 0) return;

        _equityChart = LightweightCharts.createChart(container, {
            width: container.clientWidth,
            height: container.clientHeight || 280,
            layout: {
                background: { type: 'solid', color: 'transparent' },
                textColor: '#94a3b8',
                fontSize: 10,
                fontFamily: "'JetBrains Mono', monospace",
            },
            grid: {
                vertLines: { color: 'rgba(56,189,248,0.04)' },
                horzLines: { color: 'rgba(56,189,248,0.04)' },
            },
            rightPriceScale: {
                borderColor: 'rgba(56,189,248,0.1)',
                scaleMargins: { top: 0.1, bottom: 0.1 },
            },
            timeScale: {
                borderColor: 'rgba(56,189,248,0.1)',
                timeVisible: true,
                secondsVisible: false,
            },
            crosshair: {
                mode: LightweightCharts.CrosshairMode.Normal,
                vertLine: { color: 'rgba(56,189,248,0.3)', width: 1, style: 2 },
                horzLine: { color: 'rgba(56,189,248,0.3)', width: 1, style: 2 },
            },
        });

        // Strategy equity
        _equitySeries = _equityChart.addAreaSeries({
            lineColor: '#06b6d4',
            topColor: 'rgba(6,182,212,0.25)',
            bottomColor: 'rgba(6,182,212,0.02)',
            lineWidth: 2,
            title: 'Strategy',
        });

        _equitySeries.setData(curve.map(p => ({
            time: p.time,
            value: p.equity,
        })));

        // Buy & hold equity
        _bhSeries = _equityChart.addLineSeries({
            color: 'rgba(148,163,184,0.5)',
            lineWidth: 1,
            lineStyle: 2, // dashed
            title: 'Buy & Hold',
        });

        _bhSeries.setData(curve.map(p => ({
            time: p.time,
            value: p.buyHoldEquity,
        })));

        // Trade markers
        const trades = BacktestEngine.getTradeLog();
        const markers = [];
        trades.forEach(t => {
            markers.push({
                time: t.entryTime,
                position: 'belowBar',
                color: '#22c55e',
                shape: 'arrowUp',
                text: 'BUY',
            });
            markers.push({
                time: t.exitTime,
                position: 'aboveBar',
                color: t.pnl >= 0 ? '#22c55e' : '#ef4444',
                shape: 'arrowDown',
                text: t.pnl >= 0 ? 'WIN' : 'LOSS',
            });
        });
        if (markers.length > 0) {
            markers.sort((a, b) => a.time - b.time);
            _equitySeries.setMarkers(markers);
        }

        _equityChart.timeScale().fitContent();

        // Resize observer
        const ro = new ResizeObserver(() => {
            _equityChart.applyOptions({ width: container.clientWidth, height: container.clientHeight || 280 });
        });
        ro.observe(container);
    }

    // ── Render Trade Log Table ──────────────────────────────────────
    function renderTradeLog(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        const trades = BacktestEngine.getTradeLog();
        if (!trades || trades.length === 0) {
            container.innerHTML = '<div class="bt-empty">No trades executed during this period.</div>';
            return;
        }

        let html = `<table class="bt-trade-table">
            <thead><tr>
                <th>#</th><th>Entry</th><th>Exit</th><th>Shares</th>
                <th>Entry $</th><th>Exit $</th><th>P/L $</th><th>P/L %</th><th>Bars</th>
            </tr></thead><tbody>`;

        trades.forEach((t, idx) => {
            const cls = t.pnl >= 0 ? 'trade-win' : 'trade-loss';
            const entryDate = new Date(t.entryTime * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
            const exitDate = new Date(t.exitTime * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
            html += `<tr class="${cls}">
                <td>${idx + 1}</td>
                <td>${entryDate}</td>
                <td>${exitDate}${t.closedAtEnd ? ' ⏹' : ''}</td>
                <td>${t.shares}</td>
                <td>$${t.entryPrice.toFixed(2)}</td>
                <td>$${t.exitPrice.toFixed(2)}</td>
                <td class="${t.pnl >= 0 ? 'pnl-pos' : 'pnl-neg'}">$${t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}</td>
                <td class="${t.pnl >= 0 ? 'pnl-pos' : 'pnl-neg'}">${t.pnlPct >= 0 ? '+' : ''}${t.pnlPct.toFixed(2)}%</td>
                <td>${t.bars}</td>
            </tr>`;
        });

        html += '</tbody></table>';
        container.innerHTML = html;
    }

    // ── Render Metrics Cards ────────────────────────────────────────
    function renderMetricsCards(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        const m = BacktestEngine.getMetrics();
        if (!m || !m.totalReturn) {
            container.innerHTML = '<div class="bt-empty">No metrics available.</div>';
            return;
        }

        const retCls = m.totalReturn >= 0 ? 'metric-pos' : 'metric-neg';
        const exCls = m.excess >= 0 ? 'metric-pos' : 'metric-neg';
        const bhCls = m.buyHold.totalReturn >= 0 ? 'metric-pos' : 'metric-neg';

        container.innerHTML = `
            <div class="bt-metrics-grid">
                <div class="bt-metric-card primary">
                    <div class="bt-metric-label">Total Return</div>
                    <div class="bt-metric-value ${retCls}">${m.totalReturn >= 0 ? '+' : ''}${m.totalReturn.toFixed(2)}%</div>
                    <div class="bt-metric-sub">$${m.totalReturnDollar >= 0 ? '+' : ''}${m.totalReturnDollar.toFixed(2)}</div>
                </div>
                <div class="bt-metric-card">
                    <div class="bt-metric-label">Win Rate</div>
                    <div class="bt-metric-value">${m.winRate.toFixed(1)}%</div>
                    <div class="bt-metric-sub">${m.wins}W / ${m.losses}L</div>
                </div>
                <div class="bt-metric-card">
                    <div class="bt-metric-label">Max Drawdown</div>
                    <div class="bt-metric-value metric-neg">-${m.maxDrawdown.toFixed(2)}%</div>
                    <div class="bt-metric-sub">from peak</div>
                </div>
                <div class="bt-metric-card">
                    <div class="bt-metric-label"># Trades</div>
                    <div class="bt-metric-value">${m.numTrades}</div>
                    <div class="bt-metric-sub">${m.days}-day window</div>
                </div>
                <div class="bt-metric-card">
                    <div class="bt-metric-label">Avg P/L per Trade</div>
                    <div class="bt-metric-value ${m.avgPnlPerTrade >= 0 ? 'metric-pos' : 'metric-neg'}">$${m.avgPnlPerTrade >= 0 ? '+' : ''}${m.avgPnlPerTrade.toFixed(2)}</div>
                    <div class="bt-metric-sub">${m.avgPnlPctPerTrade >= 0 ? '+' : ''}${m.avgPnlPctPerTrade.toFixed(2)}% avg</div>
                </div>
                <div class="bt-metric-card">
                    <div class="bt-metric-label">Sharpe (proxy)</div>
                    <div class="bt-metric-value">${m.sharpeProxy.toFixed(2)}</div>
                    <div class="bt-metric-sub">annualized</div>
                </div>
                <div class="bt-metric-card highlight">
                    <div class="bt-metric-label">Buy & Hold</div>
                    <div class="bt-metric-value ${bhCls}">${m.buyHold.totalReturn >= 0 ? '+' : ''}${m.buyHold.totalReturn.toFixed(2)}%</div>
                    <div class="bt-metric-sub">$${m.buyHold.totalReturnDollar >= 0 ? '+' : ''}${m.buyHold.totalReturnDollar.toFixed(2)}</div>
                </div>
                <div class="bt-metric-card ${exCls === 'metric-pos' ? 'highlight-pos' : 'highlight-neg'}">
                    <div class="bt-metric-label">Excess Return</div>
                    <div class="bt-metric-value ${exCls}">${m.excess >= 0 ? '+' : ''}${m.excess.toFixed(2)}%</div>
                    <div class="bt-metric-sub">vs buy & hold</div>
                </div>
            </div>
            <div class="bt-assumptions">
                <strong>Assumptions:</strong> No transaction costs · Long/Flat only · Integer shares · ${m.ticker} 5-min candles from Finnhub ·
                20-bar warmup · No lookahead bias
            </div>
        `;
    }

    // ── Destroy ─────────────────────────────────────────────────────
    function destroy() {
        if (_equityChart) {
            _equityChart.remove();
            _equityChart = null;
        }
        _equitySeries = null;
        _bhSeries = null;
    }

    return {
        renderEquityCurve,
        renderTradeLog,
        renderMetricsCards,
        destroy,
    };
})();
