# Commingled — Portfolio Tracker (Yahoo Finance edition)

## What this is
- A small Next.js app: the dashboard you saw before, plus three tiny backend
  routes (`pages/api/quote.js`, `search.js`, `history.js`) that fetch real
  data from Yahoo Finance via the `yahoo-finance2` library.
- No database yet — holdings live in memory and reset on refresh. That's the
  next thing to add once you're happy with the data side.

## 1. Install Node.js
You need Node 18 or newer.
- Go to https://nodejs.org and install the "LTS" version for your OS.
- Check it worked by opening a terminal and running:
  ```
  node -v
  npm -v
  ```
  Both should print a version number.

## 2. Get the project onto your machine
Unzip the file I gave you, then in a terminal:
```
cd portfolio-app
npm install
```
This downloads Next.js, React, the charting library, and the Yahoo Finance
client. It can take a minute or two.

## 3. Run it locally
```
npm run dev
```
Open http://localhost:3000 in your browser. You should see the dashboard,
now pulling real prices for the seeded holdings (Apple, Microsoft, NVIDIA,
Vanguard S&P 500 ETF). Try adding a holding and searching for "Novo" — that
now searches Yahoo Finance for real, not a fixed list.

If something errors here, copy the terminal output — that tells us exactly
what broke.

## 4. Put it on GitHub (needed for deployment)
If you don't already have a GitHub account, create one at github.com — it's
free. Then:
```
git init
git add .
git commit -m "Initial commit"
```
Create a new empty repository on GitHub (click the "+" in the top right →
"New repository"), then follow the "push an existing repository" instructions
it shows you — it'll be something like:
```
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO.git
git branch -M main
git push -u origin main
```

## 5. Deploy to Vercel (free)
Vercel is made by the same people as Next.js, and it's the easiest place to
host this.
1. Go to https://vercel.com and sign up using your GitHub account.
2. Click "Add New… → Project".
3. Select the repository you just pushed.
4. Leave all the default settings — Vercel auto-detects Next.js.
5. Click "Deploy". After a minute or two you'll get a live URL like
   `https://your-project.vercel.app` — that's a real, working, hosted app.

Every time you push new changes to GitHub, Vercel automatically redeploys.

## Things worth knowing
- **Yahoo Finance isn't official.** `yahoo-finance2` wraps endpoints Yahoo
  doesn't formally support. It works well for personal projects but could
  break or get rate-limited without warning — fine for you and your partner,
  not something to build a business on without switching to a paid,
  documented API (Finnhub, Polygon.io, IEX Cloud all have proper terms).
- **Data isn't real-time.** Yahoo's free data is typically delayed ~15–20
  minutes. The app polls every 30 seconds, which is already more often than
  the underlying data actually changes.
- **The 30-day growth chart is an approximation** — it multiplies today's
  share counts against real historical closing prices. It doesn't know if
  you owned fewer shares two weeks ago, because we're not tracking historical
  transactions yet.
- **Nothing persists.** Refreshing the page resets your holdings to the
  seed data. Let me know when you're ready and I'll add real storage
  (a small database) so your entries stick around.
