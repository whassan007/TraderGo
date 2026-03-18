const RecommendationEngine = (() => {

    // ── State ───────────────────────────────────────────────────────
    let recommendations = {};  // { ticker: { topModel, topRecommendation, alternatives } }
    let historicalAccuracy = {};  // { modelId: { hits, total, accuracy_pct } }

    // ── Score Model Predictions ─────────────────────────────────────
    function scoreModelConfidence(modelId, ticker) {
        const forecasts = ForecastAgents.getForecasts(ticker);
        const forecast = forecasts[modelId];

        if (!forecast) return null;

        const currentPrice = MarketData.getPrice(ticker);
        const forecastPrice = forecast.predicted_price;
        const forecastChange = (forecastPrice - currentPrice) / currentPrice;
        const conviction = Math.abs(forecastChange); 

        const baseConfidence = forecast.confidence_score || 0.5;
        const convictionScore = Math.min(0.5, conviction * 2);

        const modelAccuracy = historicalAccuracy[modelId]?.accuracy_pct || 50; 
        const accuracyScore = modelAccuracy / 100 * 0.3;  

        const ensemble = forecasts.ensemble;
        const ensemblePrice = ensemble?.predicted_price || currentPrice;
        const disagreementFromEnsemble = Math.abs(forecastPrice - ensemblePrice) / currentPrice;
        const ensembleAlignment = Math.max(0, 1 - disagreementFromEnsemble * 10);  
        const alignmentScore = ensembleAlignment * 0.2;  

        const disagreement = ForecastAgents.getDisagreement(ticker);
        const disagreementPenalty = Math.max(0, 1 - ((disagreement?.score || 0) / 100 * 0.5));
        const disagreementScore = disagreementPenalty * 1.0;  // multiplier

        const totalConfidence = (baseConfidence * 0.4 + convictionScore * 0.3 + accuracyScore + alignmentScore) * disagreementScore;

        return {
            modelId,
            modelName: forecast.name || modelId,
            confidence: Math.min(1.0, totalConfidence),
            baseConfidence,
            convictionScore,
            accuracyScore,
            alignmentScore,
            forecastPrice,
            forecastChange,
            direction: forecast.direction,
            horizonMinutes: forecast.horizon ? parseInt(forecast.horizon) : 30
        };
    }

    // ── Rank All Models for a Ticker ────────────────────────────────
    function rankModelsForTicker(ticker) {
        const modelIds = ['lstm_predictor', 'transformer', 'momentum_model', 'volatility', 'sentiment', 'ensemble'];
        
        const scores = modelIds
            .map(id => scoreModelConfidence(id, ticker))
            .filter(s => s !== null)
            .sort((a, b) => b.confidence - a.confidence);

        return scores; 
    }

    // ── Generate Top Recommendation ─────────────────────────────────
    function generateTopRecommendation(ticker) {
        const currentPrice = MarketData.getPrice(ticker);
        const rankedModels = rankModelsForTicker(ticker);

        if (rankedModels.length === 0) {
            return null;
        }

        const topModel = rankedModels[0];

        let recommendationType = 'HOLD';
        if (topModel.confidence > 0.75 && topModel.direction === 'BULLISH') {
            recommendationType = topModel.convictionScore > 0.03 ? 'STRONG_BUY' : 'BUY';
        } else if (topModel.confidence > 0.75 && topModel.direction === 'BEARISH') {
            recommendationType = topModel.convictionScore > 0.03 ? 'STRONG_SELL' : 'SELL';
        } else if (topModel.confidence > 0.60) {
            recommendationType = topModel.direction === 'BULLISH' ? 'BUY' : topModel.direction === 'BEARISH' ? 'SELL' : 'HOLD';
        }

        const entryExitLevels = _calculateEntryExit(ticker, topModel, currentPrice);
        const optionsStrategies = _generateOptionsStrategies(ticker, topModel, currentPrice);
        const riskReward = _calculateRiskReward(
            entryExitLevels.entry,
            entryExitLevels.exit,
            entryExitLevels.stopLoss,
            recommendationType
        );

        return {
            ticker,
            rank: 1,
            topModel: topModel.modelName,
            topModelId: topModel.modelId,
            confidence: topModel.confidence,
            confidenceBadge: _getConfidenceBadge(topModel.confidence),
            recommendationType,
            currentPrice,
            forecastPrice: topModel.forecastPrice,
            forecastChange: topModel.forecastChange,
            direction: topModel.direction,
            horizonMinutes: topModel.horizonMinutes,
            entryExitLevels,
            riskReward,
            optionsStrategies,
            alternativeModels: rankedModels.slice(1, 4),  
            consensusStrength: _calculateConsensusStrength(rankedModels),
            timestamp: new Date().toLocaleTimeString()
        };
    }

    // ── Calculate Entry/Exit Prices ─────────────────────────────────
    function _calculateEntryExit(ticker, topModel, currentPrice) {
        const atr = _estimateATR(ticker);  
        const riskUnit = atr || (currentPrice * 0.005);  

        let entry, target, stopLoss;

        if (topModel.direction === 'BULLISH') {
            entry = currentPrice * 0.998;  // slight pullback
            target = currentPrice + (riskUnit * 1.5);
            stopLoss = entry - riskUnit;
        } else if (topModel.direction === 'BEARISH') {
            entry = currentPrice * 1.002;  
            target = currentPrice - (riskUnit * 1.5);
            stopLoss = entry + riskUnit;
        } else {
            entry = currentPrice;
            target = currentPrice;
            stopLoss = currentPrice * 0.95;
        }

        // Snap to advanced SR if available
        if (typeof Indicators !== 'undefined' && Indicators.advancedSR) {
            const sr = Indicators.advancedSR(ticker, MarketData.getOHLCV(ticker, 5) || [], 5);
            if (sr && sr.levels && sr.levels.length > 0) {
                const supports = sr.levels.filter(l => l.type === 'support' && l.value < currentPrice).sort((a,b) => b.value - a.value);
                const resistances = sr.levels.filter(l => l.type === 'resistance' && l.value > currentPrice).sort((a,b) => a.value - b.value);

                if (topModel.direction === 'BULLISH' && supports.length > 0) {
                    stopLoss = Math.min(stopLoss, supports[0].value * 0.99);  
                }
                if (topModel.direction === 'BEARISH' && resistances.length > 0) {
                    stopLoss = Math.max(stopLoss, resistances[0].value * 1.01);  
                }
            }
        }

        return {
            entry: entry.toFixed(2),
            target: target.toFixed(2),
            stopLoss: stopLoss.toFixed(2),
            entryDistance: ((entry - currentPrice) / currentPrice * 100).toFixed(2) + '%',
            riskUnits: riskUnit.toFixed(2)
        };
    }

    // ── Generate Options Strategies ─────────────────────────────────
    function _generateOptionsStrategies(ticker, topModel, currentPrice) {
        const strategies = [];
        const horizonDays = Math.ceil(topModel.horizonMinutes / (5 * 60 * 6.5)) || 1;  

        let expiryDaysOut = 0;
        if (horizonDays <= 1) expiryDaysOut = 1;  
        else if (horizonDays <= 7) expiryDaysOut = 7;  
        else expiryDaysOut = 30;  

        const confidence = topModel.confidence;

        if (topModel.direction === 'BULLISH') {
            if (confidence > 0.85) {
                strategies.push({
                    name: 'Call Spread (Bullish)', type: 'CALL_SPREAD',
                    description: `Buy ${expiryDaysOut}DTE ATM call, sell ${expiryDaysOut}DTE OTM call`,
                    strikes: { long_strike: Math.round(currentPrice), short_strike: Math.round(currentPrice * 1.02), expiry_days: expiryDaysOut },
                    maxProfit: 'Limited (width)', maxLoss: 'Limited (debit)', breakeven: `${(currentPrice * 1.01).toFixed(2)}`
                });
            } else if (confidence > 0.70) {
                strategies.push({
                    name: 'Long Call (Bullish)', type: 'LONG_CALL',
                    description: `Buy ${expiryDaysOut}DTE OTM call`,
                    strikes: { strike: Math.round(currentPrice * 1.01), expiry_days: expiryDaysOut },
                    maxProfit: 'Unlimited', maxLoss: 'Premium paid', breakeven: `${(currentPrice * 1.01).toFixed(2)}`
                });
            } else {
                strategies.push({
                    name: 'Debit Call Spread', type: 'DEBIT_CALL_SPREAD',
                    description: `Buy ATM call, sell OTM call`,
                    strikes: { long_strike: Math.round(currentPrice), short_strike: Math.round(currentPrice * 1.03), expiry_days: expiryDaysOut },
                    maxProfit: 'Limited', maxLoss: 'Debit paid', breakeven: `${(currentPrice * 1.005).toFixed(2)}`
                });
            }
        } else if (topModel.direction === 'BEARISH') {
            if (confidence > 0.85) {
                strategies.push({
                    name: 'Put Spread (Bearish)', type: 'PUT_SPREAD',
                    description: `Buy ${expiryDaysOut}DTE OTM put, sell farther OTM put`,
                    strikes: { long_strike: Math.round(currentPrice * 0.99), short_strike: Math.round(currentPrice * 0.97), expiry_days: expiryDaysOut },
                    maxProfit: 'Limited (width)', maxLoss: 'Limited (debit)', breakeven: `${(currentPrice * 0.99).toFixed(2)}`
                });
            } else if (confidence > 0.70) {
                strategies.push({
                    name: 'Long Put (Bearish)', type: 'LONG_PUT',
                    description: `Buy ${expiryDaysOut}DTE OTM put`,
                    strikes: { strike: Math.round(currentPrice * 0.99), expiry_days: expiryDaysOut },
                    maxProfit: 'Limited', maxLoss: 'Premium paid', breakeven: `${(currentPrice * 0.99).toFixed(2)}`
                });
            }
        }

        if (confidence < 0.60 && topModel.direction === 'NEUTRAL') {
            strategies.push({
                name: 'Iron Condor (Neutral)', type: 'IRON_CONDOR',
                description: `Sell call spread above, sell put spread below`,
                strikes: { call_short: Math.round(currentPrice * 1.02), call_long: Math.round(currentPrice * 1.04), put_short: Math.round(currentPrice * 0.98), put_long: Math.round(currentPrice * 0.96), expiry_days: expiryDaysOut },
                maxProfit: 'Defined (credit)', maxLoss: 'Defined (width - credit)', breakeven: 'Range'
            });
        }
        return strategies;
    }

    // ── Calculate Risk/Reward Ratio ─────────────────────────────────
    function _calculateRiskReward(entry, exit, stopLoss, direction) {
        entry = parseFloat(entry); exit = parseFloat(exit); stopLoss = parseFloat(stopLoss);
        const risk = Math.abs(entry - stopLoss);
        const reward = Math.abs(exit - entry);
        const ratio = risk > 0 ? (reward / risk).toFixed(2) : '∞';
        return { risk: risk.toFixed(2), reward: reward.toFixed(2), ratio: ratio + ':1' };
    }

    // ── Helper: Estimate ATR ────────────────────────────────────────
    function _estimateATR(ticker, period = 14) {
        const candles = MarketData.getOHLCV(ticker, 5) || [];
        if (candles.length < period) return null;
        let sumTR = 0;
        for (let i = candles.length - period; i < candles.length; i++) {
            const curr = candles[i];
            const prev = candles[i - 1];
            const tr1 = curr.high - curr.low;
            const tr2 = Math.abs(curr.high - prev.close);
            const tr3 = Math.abs(curr.low - prev.close);
            sumTR += Math.max(tr1, tr2, tr3);
        }
        return sumTR / period;
    }

    // ── Get Confidence Badge ────────────────────────────────────────
    function _getConfidenceBadge(confidence) {
        if (confidence > 0.85) return { label: 'VERY HIGH', color: '#22c55e', emoji: '🟢' };
        if (confidence > 0.75) return { label: 'HIGH', color: '#eab308', emoji: '🟡' };
        if (confidence > 0.60) return { label: 'MODERATE', color: '#f97316', emoji: '🟠' };
        if (confidence > 0.50) return { label: 'LOW', color: '#ef4444', emoji: '🔴' };
        return { label: 'VERY LOW', color: '#94a3b8', emoji: '⚫' };
    }

    // ── Calculate Consensus Strength ────────────────────────────────
    function _calculateConsensusStrength(rankedModels) {
        if (rankedModels.length === 0) return { strength: '0%', agreingModels: 0, totalModels: 0, isStrong: false };
        const topDirection = rankedModels[0].direction;
        const agreeing = rankedModels.filter(m => m.direction === topDirection).length;
        const consensusStrength = (agreeing / rankedModels.length) * 100;
        return {
            strength: consensusStrength.toFixed(0) + '%',
            agreingModels: agreeing,
            totalModels: rankedModels.length,
            isStrong: consensusStrength >= 70
        };
    }

    // ── Public API ──────────────────────────────────────────────────
    return {
        generateTopRecommendation,
        rankModelsForTicker,
        scoreModelConfidence
    };
})();
