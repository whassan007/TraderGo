# TraderGo Dashboard

TraderGo is a localized, browser-based, high-performance stock trading dashboard featuring real-time market data integration, multi-agent AI consensus generation, temporal memory processing, and a comprehensive backtesting engine.

---

## 🚀 Key Features

### 1. Advanced Forecasting Engine
Integrates five sophisticated predictive models:
- **LSTM Predictor:** Long Short-Term Memory simulated outputs for pattern recognition.
- **Transformer:** Attention-based sequencing for complex market structures.
- **Momentum Model:** Trend-following regression logic.
- **Volatility Model:** GARCH-inspired movement probability forecasts.
- **Sentiment Model:** News and social volume proxies.
- **Multi-Agent Consensus:** Aggregates all model signals via conflict resolution into unified `BULLISH`/`BEARISH`/`NEUTRAL` confidence scores.

### 2. High-Fidelity Charting & Indicators
- Powered by [TradingView Lightweight Charts] for ultra-smooth 60fps rendering.
- State-of-the-art native indicators: SMA, EMA, MACD, RSI, Bollinger Bands, and VWAP.
- **Support & Resistance (S&R):** Real-time breakout detection with historical touch tracking.
- **Average Daily Range (ADR):** Dynamic market expansion zones.
- **Options Analytix:** Simulated 0DTE/Weekly strike pinning and gamma exposure visualization.

### 3. Real-Time Market Integration
- **Finnhub Integration:** Live WebSocket subscriptions for microsecond-resolution trades, and REST polling for precise Quote (Bid/Ask) context.
- **Proprietary Data Tracking:** Granular provenance transparency labeling each tick as `🟢 LIVE`, `🟡 DELAYED`, `🟠 CACHED`, or `⚪ MODEL`.
- **Graceful Degradation:** Automatic fail-over to localized cache and Geometric Brownian Motion (GBM) simulation if primary feeds drop.

### 4. Professional Backtesting Engine
Test AI strategies instantly without leaving the dashboard:
- **Algorithmic Selection:** Test specific agents or the entire Ensemble Consensus.
- **Lookback Windows:** Configure 1-5 trading day horizons, cleanly skipping weekends.
- **True Out-of-Sample Replay:** Zero lookahead bias execution. At step `n`, algorithms only see data `< n`.
- **Institutional Metrics:** Displays Win Rate, Max Drawdown, Annualized Sharpe Proxy, P/L distributions, and total $ Return compared against a Buy-and-Hold baseline.
- **Visual Validation:** Interactive Equity Curve comparison and a detailed Trade Execution Log.

### 5. FinMem Temporal Memory
An embedded associative memory module that logs historical configurations, identifies semantic similarities to past market crashes/rallies, and outputs risk warnings or quote precedents directly into the UI.

---

## 🛠 Setup & Installation

The application is structured as a zero-dependency, static web app for maximum security and local privacy.

1. **Clone the repository:**
   ```bash
   git clone git@github.com:whassan007/TraderGo.git
   cd TraderGo
   ```

2. **Configure API Keys (Optional but Recommended):**
   - Open `config.js` and input your free [Finnhub.io](https://finnhub.io/) API Key.
   - *If no key is provided, the platform automatically boots into the high-fidelity GBM market simulation model.*

3. **Run a Local Server:**
   ```bash
   python3 -m http.server 8080
   ```
   Navigate to `http://localhost:8080` in any modern browser.

---

## ⚖️ License & Copyright

**Copyright © 2026 Wael Hassan. All Rights Reserved.**

This software and associated documentation files (the "Software") are proprietary and confidential. 

**STRICT PROHIBITION:**
You may NOT use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, nor permit persons to whom the Software is furnished to do so, without explicit, prior written permission from the copyright holder.

Any unauthorized reproduction, modification, distribution, or public display of this Software, in whole or in part, is strictly prohibited and carries severe legal penalties under international copyright law.

For commercial inquiries or enterprise licensing, contact the author directly.
