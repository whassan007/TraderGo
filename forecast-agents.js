/* ══════════════════════════════════════════════════════════════════
   FORECAST-AGENTS.JS — 5 Prediction Models with Temporal Projections
   ══════════════════════════════════════════════════════════════════ */

const ForecastAgents = (() => {

    // ── Agent Definitions ───────────────────────────────────────────
    const AGENTS = [
        { id: 'lstm_predictor', name: 'LSTM', color: '#3b82f6', horizon: 60 },
        { id: 'transformer', name: 'Transformer', color: '#a78bfa', horizon: 30 },
        { id: 'momentum_model', name: 'Momentum', color: '#22c55e', horizon: 15 },
        { id: 'volatility', name: 'Volatility', color: '#f97316', horizon: 45 },
        { id: 'sentiment', name: 'Sentiment', color: '#ec4899', horizon: 30 },
    ];

    const ENSEMBLE_COLOR = '#06b6d4';

    let forecasts = {};     // { ticker: { agent_id: forecast } }
    let monteCarlo = {};    // { ticker: paths[] }

    // Current step interval in seconds (set per forecast call)
    let _stepSec = 300;
    let _tfMin = 5;

    // Context per ticker (e.g., ADR expected move)
    let _context = {}; // { [ticker]: { adr?: { value, percentage, period }, tf?: number } }

    // ── Run forecasts for a ticker ──────────────────────────────────
    function generateForecasts(ticker, chartTf, context = {}) {
        const tf = chartTf || 5; // default 5-min
        _tfMin = tf;
        _stepSec = tf * 60;     // step in seconds matches candle interval

        _context[ticker] = { ...(context || {}), tf };

        const candles = MarketData.getOHLCV(ticker, tf);

        // Anchor strictly to the real-time spot price and current time
        // Decouples the forecast from chart TF misalignment (e.g. 9:30 AM market open modulus issues)
        const price = MarketData.getPrice(ticker);
        const now = Math.floor(Date.now() / 1000);
        
        const hist = MarketData.getHistory(ticker);
        const baseVol = MarketData.getVolatility(ticker);
        const adrPct = (context?.adr && Number.isFinite(context.adr.percentage))
            ? Math.max(0, context.adr.percentage) / 100
            : null;
        // Blend realized vol with ADR-derived move expectation (simple calibration)
        const vol = (adrPct !== null)
            ? (baseVol * 0.6 + adrPct * 0.4)
            : baseVol;

        if (!price || !hist.length) return;

        forecasts[ticker] = {};

        AGENTS.forEach(agent => {
            forecasts[ticker][agent.id] = _runAgent(agent, ticker, price, hist, vol, candles, now, context);
        });

        // Ensemble forecast
        forecasts[ticker]['ensemble'] = _generateEnsemble(ticker, now);

        // Monte Carlo
        monteCarlo[ticker] = _generateMonteCarlo(ticker, price, vol, now, tf);
    }

    // ── Agent dispatch ──────────────────────────────────────────────
    function _runAgent(agent, ticker, price, hist, vol, candles, now, context) {
        switch (agent.id) {
            case 'lstm_predictor': return _lstmPredictor(agent, price, hist, vol, now, _tfMin);
            case 'transformer': return _transformerModel(agent, price, hist, candles, now, _tfMin);
            case 'momentum_model': return _momentumModel(agent, price, hist, now, _tfMin);
            case 'volatility': return _volatilityModel(agent, price, vol, now, context, _tfMin);
            case 'sentiment': return _sentimentModel(agent, ticker, price, now, _tfMin);
            default: return null;
        }
    }

    function _stepsFor(agentHorizonMin, tfMin) {
        const tf = Math.max(1, Math.floor(tfMin || 5));
        return Math.max(3, Math.round((agentHorizonMin || 30) / tf));
    }

    function _noiseScale(tfMin, baseTfMin = 5) {
        // Brownian scaling: noise ∝ sqrt(dt)
        const tf = Math.max(1, Math.floor(tfMin || baseTfMin));
        return Math.sqrt(tf / baseTfMin);
    }

    // ── LSTM Predictor (recurrent sequence extrapolation) ───────────
    function _lstmPredictor(agent, price, hist, vol, now, tfMin) {
        const steps = _stepsFor(agent.horizon, tfMin);
        const projections = [];
        let p = price;

        // Detect recent trend from history
        const recentLen = Math.min(10, hist.length);
        const recent = hist.slice(-recentLen);
        const trend = recentLen > 1 ? (recent[recentLen - 1] - recent[0]) / recent[0] / recentLen : 0;

        // LSTM-like: extrapolate trend with diminishing confidence + noise
        for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            const decay = Math.exp(-0.5 * t);
            const trendComponent = trend * decay * p;
            const noise = MarketData.normalRandom() * vol * price * 0.002 * _noiseScale(tfMin);
            p = p + trendComponent + noise;
            projections.push({
                time: now + i * _stepSec,
                value: Math.max(0.01, p),
                confidence: Math.max(0.3, 0.95 - t * 0.55)
            });
        }

        const finalPrice = projections[projections.length - 1].value;
        return {
            agent_id: agent.id, name: agent.name, color: agent.color,
            horizon: agent.horizon + 'm', projections,
            direction: finalPrice > price ? 'BULLISH' : finalPrice < price ? 'BEARISH' : 'NEUTRAL',
            predicted_price: finalPrice,
            confidence_score: 0.85 - Math.abs(trend) * 2
        };
    }

    // ── Transformer Model (attention-based pattern matching) ────────
    function _transformerModel(agent, price, hist, candles, now, tfMin) {
        const steps = _stepsFor(agent.horizon, tfMin);
        const projections = [];
        let p = price;

        // Simulate attention mechanism: find similar patterns in history
        const patternLen = Math.min(5, candles.length);
        const recentPattern = candles.slice(-patternLen).map(c => c.close);
        let patternDelta = 0;
        if (recentPattern.length >= 3) {
            // Weighted pattern continuation
            for (let i = 1; i < recentPattern.length; i++) {
                patternDelta += (recentPattern[i] - recentPattern[i - 1]) / recentPattern[i - 1] * (i / recentPattern.length);
            }
            patternDelta /= recentPattern.length;
        }

        for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            const continuation = patternDelta * (1 - t * 0.5);
            const noise = MarketData.normalRandom() * price * 0.001 * _noiseScale(tfMin);
            p = p * (1 + continuation) + noise;
            projections.push({
                time: now + i * _stepSec,
                value: Math.max(0.01, p),
                confidence: Math.max(0.35, 0.92 - t * 0.50)
            });
        }

        const finalPrice = projections[projections.length - 1].value;
        return {
            agent_id: agent.id, name: agent.name, color: agent.color,
            horizon: agent.horizon + 'm', projections,
            direction: finalPrice > price * 1.001 ? 'BULLISH' : finalPrice < price * 0.999 ? 'BEARISH' : 'NEUTRAL',
            predicted_price: finalPrice,
            confidence_score: 0.82
        };
    }

    // ── Momentum Model (EMA trend extension) ────────────────────────
    function _momentumModel(agent, price, hist, now, tfMin) {
        const steps = _stepsFor(agent.horizon, tfMin);
        const projections = [];
        let p = price;

        const ema5 = _calcEMA(hist, 5);
        const ema12 = _calcEMA(hist, 12);
        const momentum = ema5 && ema12 ? (ema5 - ema12) / ema12 : 0;

        for (let i = 1; i <= steps; i++) {
            const acceleration = momentum * (1 + i * 0.1);  // momentum accelerates
            const noise = MarketData.normalRandom() * price * 0.0008 * _noiseScale(tfMin);
            p = p * (1 + acceleration * 0.5) + noise;
            projections.push({
                time: now + i * _stepSec,
                value: Math.max(0.01, p),
                confidence: Math.max(0.5, 0.90 - (i / steps) * 0.35)
            });
        }

        const finalPrice = projections[projections.length - 1].value;
        return {
            agent_id: agent.id, name: agent.name, color: agent.color,
            horizon: agent.horizon + 'm', projections,
            direction: momentum > 0.001 ? 'BULLISH' : momentum < -0.001 ? 'BEARISH' : 'NEUTRAL',
            predicted_price: finalPrice,
            confidence_score: Math.min(0.9, 0.6 + Math.abs(momentum) * 50)
        };
    }

    // ── Volatility Model (vol-adjusted mean reversion) ──────────────
    function _volatilityModel(agent, price, vol, now, context, tfMin) {
        const steps = _stepsFor(agent.horizon, tfMin);
        const projections = [];
        let p = price;

        // Mean reversion toward VWAP-like equilibrium
        const equilibrium = price * (1 + (Math.random() - 0.5) * 0.002);
        const reversionSpeed = 0.15;

        const adrAbs = context?.adr && Number.isFinite(context.adr.value) ? context.adr.value : null;
        const clampK = 1.15; // allow modest overshoot beyond ADR

        for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            const reversion = (equilibrium - p) * reversionSpeed * t;
            const volNoise = MarketData.normalRandom() * vol * price * 0.0015 * (1 + t) * _noiseScale(tfMin);
            p = p + reversion + volNoise;
            if (adrAbs !== null && adrAbs > 0) {
                const maxMove = adrAbs * clampK;
                p = Math.max(price - maxMove, Math.min(price + maxMove, p));
            }
            projections.push({
                time: now + i * _stepSec,
                value: Math.max(0.01, p),
                confidence: Math.max(0.3, 0.88 - t * 0.50)
            });
        }

        const finalPrice = projections[projections.length - 1].value;
        return {
            agent_id: agent.id, name: agent.name, color: agent.color,
            horizon: agent.horizon + 'm', projections,
            direction: finalPrice > price * 1.001 ? 'BULLISH' : finalPrice < price * 0.999 ? 'BEARISH' : 'NEUTRAL',
            predicted_price: finalPrice,
            confidence_score: 0.75,
            vol_expected: vol,
            adr_expected: context?.adr || null
        };
    }

    // ── Sentiment Model (options flow sentiment projection) ─────────
    function _sentimentModel(agent, ticker, price, now, tfMin) {
        const steps = _stepsFor(agent.horizon, tfMin);
        const projections = [];
        let p = price;

        // Get options sentiment
        let sentimentBias = 0;
        if (typeof OptionsAnalyzer !== 'undefined') {
            const optSignal = OptionsAnalyzer.getOptionsSignal(ticker);
            if (optSignal.signal === 'BULLISH') sentimentBias = 0.001;
            else if (optSignal.signal === 'BEARISH') sentimentBias = -0.001;

            const pcr = parseFloat(optSignal.pcr || 1.0);
            if (pcr < 0.7) sentimentBias += 0.0005;
            if (pcr > 1.3) sentimentBias -= 0.0005;
        }

        for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            const sentimentDrift = sentimentBias * (1 - t * 0.3);
            const noise = MarketData.normalRandom() * price * 0.001 * _noiseScale(tfMin);
            p = p * (1 + sentimentDrift) + noise;
            projections.push({
                time: now + i * _stepSec,
                value: Math.max(0.01, p),
                confidence: Math.max(0.35, 0.85 - t * 0.45)
            });
        }

        const finalPrice = projections[projections.length - 1].value;
        return {
            agent_id: agent.id, name: agent.name, color: agent.color,
            horizon: agent.horizon + 'm', projections,
            direction: sentimentBias > 0.0005 ? 'BULLISH' : sentimentBias < -0.0005 ? 'BEARISH' : 'NEUTRAL',
            predicted_price: finalPrice,
            confidence_score: 0.70 + Math.abs(sentimentBias) * 200
        };
    }

    // ── Ensemble Forecast (weighted average) ────────────────────────
    function _generateEnsemble(ticker, now) {
        const agentForecasts = Object.values(forecasts[ticker] || {});
        if (agentForecasts.length === 0) return null;

        // Find max steps across agents
        const maxSteps = Math.max(...agentForecasts.map(f => f.projections?.length || 0));
        const projections = [];

        const weights = { lstm_predictor: 0.25, transformer: 0.25, momentum_model: 0.20, volatility: 0.15, sentiment: 0.15 };

        for (let i = 0; i < maxSteps; i++) {
            let weightedSum = 0, totalWeight = 0, minConf = 1;
            agentForecasts.forEach(f => {
                if (f.projections && f.projections[i]) {
                    const w = weights[f.agent_id] || 0.2;
                    weightedSum += f.projections[i].value * w;
                    totalWeight += w;
                    minConf = Math.min(minConf, f.projections[i].confidence);
                }
            });
            if (totalWeight > 0) {
                projections.push({
                    time: now + (i + 1) * _stepSec,
                    value: weightedSum / totalWeight,
                    confidence: minConf * 0.9 + 0.1
                });
            }
        }

        const price = MarketData.getPrice(ticker);
        const finalPrice = projections.length > 0 ? projections[projections.length - 1].value : price;

        return {
            agent_id: 'ensemble', name: 'Ensemble', color: ENSEMBLE_COLOR,
            horizon: '60m', projections,
            direction: finalPrice > price * 1.001 ? 'BULLISH' : finalPrice < price * 0.999 ? 'BEARISH' : 'NEUTRAL',
            predicted_price: finalPrice,
            confidence_score: projections.length > 0 ? projections.reduce((a, b) => a + b.confidence, 0) / projections.length : 0.5
        };
    }

    // ── Monte Carlo Simulation ──────────────────────────────────────
    function _generateMonteCarlo(ticker, price, vol, now, tfMin) {
        const numPaths = 50;
        const maxHorizonMin = 60;
        const tf = Math.max(1, Math.floor(tfMin || 5));
        const steps = Math.max(8, Math.round(maxHorizonMin / tf));
        const paths = [];
        const barsPerDay = 390 / tf;
        const sigma = vol / Math.sqrt(252 * barsPerDay);  // per-step

        for (let p = 0; p < numPaths; p++) {
            const path = [];
            let s = price;
            for (let i = 1; i <= steps; i++) {
                const drift = -0.5 * sigma * sigma;
                s = s * Math.exp(drift + sigma * MarketData.normalRandom());
                path.push({ time: now + i * _stepSec, value: s });
            }
            paths.push(path);
        }

        return paths;
    }

    // ── Disagreement Score ──────────────────────────────────────────
    function getDisagreement(ticker) {
        const f = forecasts[ticker];
        if (!f) return { score: 0, details: {} };

        const prices = AGENTS.map(a => f[a.id]?.predicted_price).filter(Boolean);
        if (prices.length === 0) return { score: 0, details: {} };

        const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
        const variance = prices.reduce((a, b) => a + (b - mean) ** 2, 0) / prices.length;
        const stdDev = Math.sqrt(variance);
        const cvPct = (stdDev / mean) * 100;

        // Build pairwise disagreement
        const details = {};
        for (let i = 0; i < AGENTS.length; i++) {
            for (let j = i + 1; j < AGENTS.length; j++) {
                const p1 = f[AGENTS[i].id]?.predicted_price;
                const p2 = f[AGENTS[j].id]?.predicted_price;
                if (p1 && p2) {
                    const key = `${AGENTS[i].name} vs ${AGENTS[j].name}`;
                    details[key] = Math.abs(p1 - p2) / mean * 100;
                }
            }
        }

        return { score: cvPct, stdDev, mean, details };
    }

    // ── Get Confidence Bands ────────────────────────────────────────
    function getConfidenceBands(ticker, agentId) {
        const f = forecasts[ticker]?.[agentId];
        if (!f?.projections) return { upper: [], lower: [] };

        const price = MarketData.getPrice(ticker);
        const vol = MarketData.getVolatility(ticker);

        const upper = [], lower = [];
        f.projections.forEach(p => {
            const confInverse = 1 - p.confidence;
            const band = price * vol * confInverse * 0.03;
            upper.push({ time: p.time, value: p.value + band });
            lower.push({ time: p.time, value: p.value - band });
        });

        return { upper, lower };
    }

    // ── Helper: EMA from array ──────────────────────────────────────
    function _calcEMA(arr, period) {
        if (arr.length === 0) return null;
        const k = 2 / (period + 1);
        let ema = arr[0];
        for (let i = 1; i < arr.length; i++) ema = arr[i] * k + ema * (1 - k);
        return ema;
    }

    // ── Public API ──────────────────────────────────────────────────
    return {
        AGENTS, ENSEMBLE_COLOR,
        generateForecasts,
        getForecasts: ticker => forecasts[ticker] || {},
        getMonteCarlo: ticker => monteCarlo[ticker] || [],
        getDisagreement,
        getConfidenceBands,
        getContext: ticker => _context[ticker] || {}
    };
})();
