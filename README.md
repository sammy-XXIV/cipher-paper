# Cipher Paper

A separate, static paper futures terminal inspired by the supplied MEXC mobile reference. Start with 10,000 virtual USDT. Accounts are stored in localStorage on each browser/device; no login, wallet, API keys, deposits, or real orders.

On phones, use the Trade, Chart, and Account tabs. Trade keeps order entry beside the book; Chart opens the full-width candle chart; Account shows your balance and closed trades. Desktop displays all panels together. Mobile layouts are checked at 320, 360, 390, 430, and 768 pixels.

## Run

Node 22+: `npm run dev`, then open http://127.0.0.1:4173. `npm test` checks the trading engine. No install or build step is required for the app.

## GitHub Pages

Push this folder to the main branch of a new repository. In Settings → Pages, select **GitHub Actions** as the source. The included workflow tests the engine and candles and publishes only the seven public application files. Relative asset paths support project Pages URLs.

## Market data

- Live prices and full depth: `wss://contract.mexc.com/edge` (`sub.ticker`, `sub.depth.full`). Depth contracts are multiplied by `contractSize` to display coin quantity.
- Bundled `contracts.json`: MEXC `/api/v1/contract/detail`, captured November 18, 2026. Only visible active USDT contracts appear. The app attempts a fresh list; if MEXC blocks browser CORS it uses the snapshot. Refresh this file periodically.
- Run `node refresh-contracts.mjs` to refresh the bundled snapshot from MEXC.
- REST proxy: `https://cipher-paper-market.samsonsamuel531.workers.dev` is configured by default for browser access to MEXC historical candles, contract metadata, and tickers. `proxy-worker.js` and `wrangler.toml` are included; settings can override the default URL. Only public read-only market routes are permitted. WebSocket prices remain the primary live feed.
- Demo mode is explicit, labels all data as simulated, and uses a **separate account**. Switching feeds never trades existing positions on simulated prices.
- The candlestick chart loads at least the last 24 hours of MEXC OHLC history at 5-minute, 15-minute (default), or 1-hour intervals. New listings may have a shorter available history, which is labeled. Live ticks update the current candle. Historical bars never enter the paper execution engine. Demo history is explicitly simulated, and changing its chart interval does not change the current market price.

## Paper execution model

Linear USDT contracts; position notional = margin × leverage; coin quantity = notional / entry price. Leverage is 1–100×, capped at the contract's maximum. Fractional quantities are allowed for practice. Fee is a fixed **0.06%** per fill for both market and limit orders, rather than MEXC's current fee schedule. Wallet balance includes realized gross P&L less deducted fees; equity includes unrealized P&L.

Market fills use the newest last-price quote, with no liquidity/slippage model. Marketable limit orders execute immediately; others reserve margin plus entry fee and execute at the next qualifying last price. Long limit triggers at price ≤ limit; short at price ≥ limit. TP/SL exits use the next received qualifying price, so gaps can affect fills. Positions can be fully closed individually or partially closed by value from the Close tab.

Isolated liquidation uses only position margin. Cross positions share wallet collateral excluding isolated position margins. Maintenance margin is a simplified fixed **0.5% of current notional**, and liquidation prices are estimates. Liquidation uses mark price when available. Protective orders use last price. Cross liquidation cancels pending orders. Fees and liquidations cannot create negative wallet balances. Funding, insurance funds, exchange risk tiers, auto-deleveraging, and exact exchange liquidation fees are not simulated.

Orders and risk checks run **only while the page is open and receiving fresh data**. Prices older than 15 seconds cannot be used for manual execution. Every open position and pending order subscribes to its own live ticker; switching pairs does not stop its feed. No background or closed-browser execution is promised. Browser throttling can delay processing. Clearing site data removes the account; CSV export preserves closed trade records. Avoid running the same account in multiple tabs; changes in another tab trigger a reload.
