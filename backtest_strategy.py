import datetime
import yfinance as yf
import backtrader as bt
import pandas as pd

# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------
TICKERS_LONG = ['NVDA', 'MSFT', 'ASML']
TICKERS_SHORT = ['SH', 'PSQ', 'TAIL']
ALL_TICKERS = TICKERS_LONG + TICKERS_SHORT

START_DATE = '2019-01-01'
END_DATE = '2022-12-31'

# Allocation weights
LONG_TOTAL_WEIGHT = 0.80
SHORT_TOTAL_WEIGHT = 0.20

LONG_WEIGHT_PER_ASSET = LONG_TOTAL_WEIGHT / len(TICKERS_LONG)
SHORT_WEIGHT_PER_ASSET = SHORT_TOTAL_WEIGHT / len(TICKERS_SHORT)

INITIAL_CASH = 100000.0


# -----------------------------------------------------------------------------
# Data Downloading
# -----------------------------------------------------------------------------
def download_data(tickers, start, end):
    """
    Downloads adjusted close data from Yahoo Finance sequentially and structures it
    for Backtrader.
    """
    print(f"Downloading historical data for {tickers} from {start} to {end}...")
    data_feeds = {}
    
    for ticker in tickers:
        print(f"Downloading data for {ticker}...")
        df_ticker = yf.download(ticker, start=start, end=end, interval='1d', auto_adjust=True, prepost=False, threads=False)
        
        # Flatten MultiIndex columns if necessary (sometimes happens with newer yfinance versions)
        if isinstance(df_ticker.columns, pd.MultiIndex):
            df_ticker.columns = df_ticker.columns.get_level_values(0)
            
        df_ticker = df_ticker[['Open', 'High', 'Low', 'Close', 'Volume']].dropna()
        
        # Convert to Backtrader PandasData feed
        data = bt.feeds.PandasData(
            dataname=df_ticker,
            name=ticker,
            fromdate=datetime.datetime.strptime(start, '%Y-%m-%d'),
            todate=datetime.datetime.strptime(end, '%Y-%m-%d')
        )
        data_feeds[ticker] = data
        
    return data_feeds


# -----------------------------------------------------------------------------
# Backtrader Strategy
# -----------------------------------------------------------------------------
class BuyAndHoldHedgeStrategy(bt.Strategy):
    """
    A simple buy-and-hold strategy that allocates:
    - 80% equally across Tech Longs
    - 20% equally across Inverse/Hedge ETFs
    
    Rebalances only on the very first day to establish the position.
    """
    
    def __init__(self):
        self.invested = False
        
    def next(self):
        # We only want to execute our target allocations once
        # Wait until all data feeds have at least one valid bar to avoid NaN issues
        if not self.invested:
            # Check if all data feeds are ready
            for d in self.datas:
                if len(d) == 0:
                    return
            
            print(f"\n[{self.datas[0].datetime.date(0)}] Executing initial portfolio allocation:")
            
            # Execute Long Allocation
            for ticker in TICKERS_LONG:
                data_feed = self.getdatabyname(ticker)
                self.order_target_percent(data_feed, target=LONG_WEIGHT_PER_ASSET)
                print(f"  Targeting {LONG_WEIGHT_PER_ASSET*100:.2f}% allocation for {ticker}")
                
            # Execute Hedge Allocation
            for ticker in TICKERS_SHORT:
                data_feed = self.getdatabyname(ticker)
                self.order_target_percent(data_feed, target=SHORT_WEIGHT_PER_ASSET)
                print(f"  Targeting {SHORT_WEIGHT_PER_ASSET*100:.2f}% allocation for {ticker}")
                
            self.invested = True

    def notify_order(self, order):
        if order.status in [order.Submitted, order.Accepted]:
            # Buy/Sell order submitted/accepted to/by broker - Nothing to do
            return

        # Check if an order has been completed
        if order.status in [order.Completed]:
            pass # Order succeeded
        elif order.status in [order.Canceled, order.Margin, order.Rejected]:
            print(f"Order Cancelled/Margin/Rejected for {order.data._name}")


# -----------------------------------------------------------------------------
# Main Execution execution pipeline
# -----------------------------------------------------------------------------
def main():
    print("=== Starting Backtest Configuration ===")
    
    # Initialize Cerebro engine
    cerebro = bt.Cerebro()
    cerebro.broker.setcash(INITIAL_CASH)
    cerebro.broker.setcommission(commission=0.0) # Assume commission-free trading for simplicity

    # Add Strategy
    cerebro.addstrategy(BuyAndHoldHedgeStrategy)

    # Download and add data feeds
    data_feeds = download_data(ALL_TICKERS, START_DATE, END_DATE)
    for ticker, data in data_feeds.items():
        cerebro.adddata(data)

    # Add Analyzers to extract performance metrics
    cerebro.addanalyzer(bt.analyzers.TimeReturn, _name='time_return')
    cerebro.addanalyzer(bt.analyzers.DrawDown, _name='drawdown')
    cerebro.addanalyzer(bt.analyzers.Returns, _name='returns')

    # Print starting conditions
    start_value = cerebro.broker.getvalue()
    print(f"\nStarting Portfolio Value: ${start_value:,.2f}")

    # Run the backtest
    print("\nRunning Backtest (This executes the strategy daily)...")
    results = cerebro.run()
    strat = results[0]

    # Calculate final metrics
    end_value = cerebro.broker.getvalue()
    
    # Extract metrics from analyzers
    drawdown_analysis = strat.analyzers.drawdown.get_analysis()
    max_drawdown = drawdown_analysis['max']['drawdown']
    
    returns_analysis = strat.analyzers.returns.get_analysis()
    annual_return = returns_analysis.get('rnorm100', 0.0) # Annualized return %

    # Print final results
    print("\n" + "="*40)
    print("BACKTEST RESULTS (2019-2022)")
    print("="*40)
    print(f"Starting Value:     ${start_value:,.2f}")
    print(f"Final Value:        ${end_value:,.2f}")
    print(f"Total Return:       {((end_value / start_value) - 1) * 100:.2f}%")
    print(f"Annualized Return:  {annual_return:.2f}%")
    print(f"Maximum Drawdown:   {max_drawdown:.2f}%")
    print("="*40)

    # Optional: Plot the results
    # cerebro.plot() opens a blocking matplotlib window showing the equity curve
    print("\nGenerating charts (Plotting Cerebro Canvas)...")
    cerebro.plot(style='candlestick', barup='green', bardown='red')

if __name__ == '__main__':
    main()
