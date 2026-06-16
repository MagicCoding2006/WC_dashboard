import React, { useEffect, useMemo, useState } from "react";

/* ============================================================================
   WC EDGE TERMINAL — dashboard for the World Cup prediction-market model.
   Standalone with sample data. To wire to your Python backend, replace
   SAMPLE_MATCHES with a fetch() to an endpoint that returns the same shape
   (the output of live_analyze() serializes directly into this).
   ============================================================================ */

const SAMPLE_MATCHES = [
  {
    id: "bra-cro",
    team: "Brazil", opponent: "Croatia", venue: "Miami", kickoff: "Today 20:00",
    model: { p_team_win: 0.52, p_draw: 0.27, p_opp_win: 0.21 },
    market: { kalshi_yes: 0.68, poly_yes: 0.63, kalshi_no: 0.34, poly_no: 0.39 },
    sentiment: { team_hype: 69.7, opp_hype: 2.0 },
    context: { climate: -8.2, rest: 1, travel: -1200 },
    arb: null,
    sources: { strength: "squad_value", form: "fbref_live" },
  },
  {
    id: "egy-bel",
    team: "Egypt", opponent: "Belgium", venue: "Seattle", kickoff: "Today 17:00",
    model: { p_team_win: 0.31, p_draw: 0.29, p_opp_win: 0.40 },
    market: { kalshi_yes: 0.22, poly_yes: 0.27, kalshi_no: 0.78, poly_no: 0.71 },
    sentiment: { team_hype: -4.0, opp_hype: 61.0 },
    context: { climate: 69.3, rest: 1, travel: -1357 },
    arb: { buy_yes_on: "polymarket", yes_ask: 0.27, buy_no_on: "kalshi", no_ask: 0.71, total_cost: 0.98, net_profit_per_contract: 0.02, return_pct: 2.04, cross_venue: true },
    sources: { strength: "squad_value", form: "fbref_live" },
  },
  {
    id: "arg-usa",
    team: "Argentina", opponent: "USA", venue: "Dallas", kickoff: "Tomorrow 19:00",
    model: { p_team_win: 0.61, p_draw: 0.24, p_opp_win: 0.15 },
    market: { kalshi_yes: 0.64, poly_yes: 0.62, kalshi_no: 0.38, poly_no: 0.40 },
    sentiment: { team_hype: 45.0, opp_hype: 38.0 },
    context: { climate: 4.1, rest: 0, travel: 800 },
    arb: null,
    sources: { strength: "squad_value", form: "fbref_live" },
  },
  {
    id: "fra-jpn",
    team: "France", opponent: "Japan", venue: "Toronto", kickoff: "Tomorrow 16:00",
    model: { p_team_win: 0.58, p_draw: 0.25, p_opp_win: 0.17 },
    market: { kalshi_yes: 0.55, poly_yes: 0.54, kalshi_no: 0.47, poly_no: 0.46 },
    sentiment: { team_hype: 52.0, opp_hype: 18.0 },
    context: { climate: 2.0, rest: 2, travel: -400 },
    arb: null,
    sources: { strength: "squad_value", form: "fbref_live" },
  },
];

const BANKROLL = 1000;
const KELLY_MULT = 0.25;
const MAX_FRAC = 0.05;
const KALSHI_FEE = 0.02;
const KALSHI_DATA_URL = "/kalshi_worldcup.json";

function parseMatchup(matchup) {
  const [team, opponent] = matchup.split(" vs ");
  return { team: team || matchup, opponent: opponent || "Opponent" };
}

function findEdge(row, outcome) {
  return row.outcome_edges?.find(e => e.outcome === outcome);
}

function findOutcome(row, outcome) {
  return row.kalshi_outcomes?.find(o => o.name === outcome);
}
function marketRows(row) {
  if (!row?.outcome_edges) return [];
  return row.outcome_edges.map(edge => {
    const outcome = findOutcome(row, edge.outcome);
    const model = edge.model_prob;
    const ask = edge.kalshi_yes_ask;
    const gap = Number.isFinite(model) && Number.isFinite(ask) ? model - ask : null;
    return {
      outcome: edge.outcome,
      model,
      ask,
      bid: outcome?.yes_bid,
      gap,
      gapPts: Number.isFinite(gap) ? gap * 100 : null,
    };
  });
}

function kickoffLabel(closeTime) {
  if (!closeTime) return "Kalshi live";
  const d = new Date(closeTime);
  if (Number.isNaN(d.getTime())) return "Kalshi live";
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function adaptKalshiRows(rows) {
  return rows.map(row => {
    const { team, opponent } = parseMatchup(row.matchup);
    const teamEdge = findEdge(row, team);
    const oppEdge = findEdge(row, opponent);
    const teamOutcome = findOutcome(row, team);
    const oppOutcome = findOutcome(row, opponent);
    return {
      id: row.event_ticker,
      team,
      opponent,
      venue: row.fixture_override?.venue || "Kalshi",
      kickoff: kickoffLabel(row.occurrence_time || row.close_time),
      model: row.model_probs,
      market: {
        kalshi_yes: teamEdge?.kalshi_yes_ask ?? 1,
        poly_yes: teamEdge?.kalshi_yes_ask ?? 1,
        kalshi_no: teamOutcome?.no_ask ?? 1,
        poly_no: teamOutcome?.no_ask ?? 1,
        opp_yes: oppEdge?.kalshi_yes_ask,
        opp_no: oppOutcome?.no_ask,
      },
      sentiment: {
        team_hype: row.sentiment_overlay?.team?.hype_score ?? 0,
        opp_hype: row.sentiment_overlay?.opponent?.hype_score ?? 0,
      },
      context: {
        climate: row.features_used?.climate_stress_diff ?? 0,
        rest: row.features_used?.rest_diff ?? 0,
        travel: row.features_used?.travel_diff ?? 0,
      },
      arb: row.within_event_arb ? {
        buy_yes_on: "kalshi basket",
        yes_ask: row.within_event_arb.sum_yes_asks,
        buy_no_on: "n/a",
        no_ask: 0,
        total_cost: row.within_event_arb.sum_yes_asks,
        net_profit_per_contract: row.within_event_arb.gross_profit_per_set,
        return_pct: +(row.within_event_arb.gross_profit_per_set / row.within_event_arb.sum_yes_asks * 100).toFixed(2),
        cross_venue: false,
      } : null,
      sources: {
        strength: row.feature_sources?.strength || "MISSING",
        form: row.feature_sources?.form || "neutral",
      },
      raw: row,
    };
  });
}

/* ---------- math (mirrors the Python sizing/montecarlo modules) ---------- */
function kellyFraction(p, price) {
  if (price <= 0 || price >= 1) return 0;
  const b = (1 - price) / price;
  return (b * p - (1 - p)) / b;
}
function minKnown(values) {
  const known = values.filter(v => Number.isFinite(v));
  return known.length ? Math.min(...known) : 1;
}
function bestYes(m) { return minKnown([m.market.kalshi_yes, m.market.poly_yes]); }
function bestNo(m) { return minKnown([m.market.kalshi_no, m.market.poly_no]); }

function analyze(m) {
  // outcome edges for the four 2-way contracts
  const pTeamWin = m.model.p_team_win;
  const pTeamNotWin = m.model.p_draw + m.model.p_opp_win;
  const pOppWin = m.model.p_opp_win;
  const pOppNotWin = m.model.p_draw + m.model.p_team_win;

  const yesPrice = bestYes(m);
  const noPrice = bestNo(m);
  const oppYesPrice = Number.isFinite(m.market.opp_yes) ? m.market.opp_yes : noPrice;

  const contracts = [
    { label: `${m.team} WIN`, p: pTeamWin, price: yesPrice, kind: "back" },
    { label: `${m.team} NOT WIN`, p: pTeamNotWin, price: noPrice, kind: "lay", note: "captures draw" },
    { label: `${m.opponent} WIN`, p: pOppWin, price: oppYesPrice, kind: "back" },
  ];
  contracts.forEach(c => {
    c.edge = (c.p - c.price) * 100;
    c.ev = c.p * (1 - c.price) - (1 - c.p) * c.price;
    const kf = kellyFraction(c.p, c.price);
    c.kelly = kf;
    c.frac = kf > 0 ? Math.min(kf * KELLY_MULT, MAX_FRAC) : 0;
    c.stake = +(BANKROLL * c.frac).toFixed(2);
    // log growth at chosen sizing
    if (c.frac > 0) {
      const b = (1 - c.price) / c.price;
      c.logGrowth = c.p * Math.log(1 + c.frac * b) + (1 - c.p) * Math.log(1 - c.frac);
    } else c.logGrowth = 0;
  });

  const bestEdge = contracts.reduce((a, b) => (b.edge > a.edge ? b : a), contracts[0]);

  return { contracts, bestEdge, pTeamWin, pTeamNotWin };
}

/* ---------- the convergence play: the plain-English trade ----------
   This is the core story the dashboard tells. Pick the most-mispriced
   Kalshi outcome, then describe the full trade in concrete numbers:
     1. BUY the cheap side now at the current ask (entry).
     2. WAIT for the market price to drift toward our fair value.
     3. HEDGE by buying the opposite side once it's cheap enough that
        entry + hedge < $1, which LOCKS a guaranteed profit per contract.
   At full convergence the locked profit ≈ your edge, and ROI ≈ edge / cost.
   This is NOT instant risk-free arbitrage — the lock only happens IF the
   price converges. reach_score is the heuristic chance of that move soon. */
function convergencePlay(match) {
  const signals = match.raw?.movement_signals || [];
  if (!signals.length) return null;

  const plays = signals.map(sig => {
    const longYes = (sig.gap_pct_points ?? 0) >= 0;          // buy the cheap side
    const hedge = longYes ? sig.long_yes_hedge || {} : sig.long_no_hedge || {};
    const ladder = longYes ? sig.long_yes_profit_ladder || [] : sig.long_no_profit_ladder || [];
    const entrySide = longYes ? "YES" : "NO";
    const hedgeSide = longYes ? "NO" : "YES";

    const fair = sig.fair_prob;                               // model fair YES prob for this outcome
    const entry = hedge.entry_price;                          // price we pay to enter, in $ (0..1)
    if (!Number.isFinite(entry) || !Number.isFinite(fair)) return null;

    // fair value of the side we actually bought
    const enteredFair = longYes ? fair : 1 - fair;
    // where the bought side drifts to if the market converges to our fair value
    const convergePrice = enteredFair;
    // opposite side's fair price at full convergence = the hedge we'd buy
    const hedgeFairPrice = 1 - enteredFair;
    // locked profit per contract at FULL convergence ≈ our edge on that side
    const maxLockProfit = enteredFair - entry;
    const totalCostAtConverge = entry + hedgeFairPrice;
    const maxRoi = totalCostAtConverge > 0 ? maxLockProfit / totalCostAtConverge : null;

    // best heuristic chance the price reaches a profitable hedge level soon
    const reach = ladder.reduce((mx, s) => Math.max(mx, s.reach_score || 0), 0);
    // a realistic "first real lock" rung (>= 2¢ profit) for the headline
    const rung = ladder.find(s => s.target_profit >= 0.02) || ladder[ladder.length - 1] || null;

    return {
      outcome: sig.outcome,
      ticker: sig.ticker,
      signal: sig.signal,
      phase: sig.phase,
      hours: sig.hours_to_kickoff,
      gapPts: sig.gap_pct_points,
      absGap: Math.abs(sig.gap_pct_points || 0),
      entrySide, hedgeSide,
      entry, fair, enteredFair, convergePrice, hedgeFairPrice,
      maxLockProfit, maxRoi, reach, rung, ladder, hedge,
      currentHedgeAsk: hedge.current_hedge_ask,
      lockableNow: !!hedge.lockable_now,
    };
  }).filter(Boolean);

  if (!plays.length) return null;
  // headline play = the most mispriced outcome with a positive lockable edge
  const profitable = plays.filter(p => p.maxLockProfit > 0);
  const pool = profitable.length ? profitable : plays;
  return pool.sort((a, b) => b.absGap - a.absGap)[0];
}

function recommendation(m, a) {
  if (m.arb) return { type: "ARB", text: `Lock ${m.arb.return_pct}% risk-free`, tone: "arb" };
  const play = convergencePlay(m);
  if (play && play.maxLockProfit > 0.02 && play.absGap >= 6) {
    return {
      type: "CONVERGENCE",
      text: `Buy ${play.outcome} ${play.entrySide} → lock ~${roiPct(play.maxRoi)}`,
      tone: "edge",
    };
  }
  if (a.bestEdge.edge > 5) return { type: "EDGE", text: `${a.bestEdge.label} +${a.bestEdge.edge.toFixed(1)}pt`, tone: "edge" };
  return { type: "PASS", text: "No arb, no edge", tone: "pass" };
}

/* ---------- formatting helpers ---------- */
function Pct({ v }) { return <>{(v * 100).toFixed(0)}%</>; }
function Signed({ v, suffix = "" }) {
  const s = v >= 0 ? "+" : "";
  return <span style={{ color: v >= 0 ? "var(--up)" : "var(--down)" }}>{s}{v.toFixed(1)}{suffix}</span>;
}
function Explain({ children }) {
  return <p className="explain">{children}</p>;
}
function fmtNum(v, digits = 3) {
  return Number.isFinite(v) ? v.toFixed(digits) : "—";
}
function fmtPct(v, digits = 1) {
  return Number.isFinite(v) ? `${(v * 100).toFixed(digits)}%` : "—";
}
function cents(v) {
  return Number.isFinite(v) ? `${Math.round(v * 100)}¢` : "—";
}
function roiPct(v) {
  return Number.isFinite(v) ? `${(v * 100).toFixed(0)}%` : "—";
}
function ladderRoi(step) {
  return step?.total_cost > 0 ? step.target_profit / step.total_cost : null;
}
function reachWord(r) {
  if (!Number.isFinite(r)) return "unknown";
  if (r >= 0.6) return "good";
  if (r >= 0.35) return "fair";
  if (r >= 0.15) return "slim";
  return "low (too early)";
}

/* ---------- plain-English "what the numbers mean" ---------- */
function numberStories(match, play) {
  const stories = [];
  const T = match.team, O = match.opponent;

  // 1. the edge on the headline outcome
  if (play && Number.isFinite(play.entry) && Number.isFinite(play.enteredFair)) {
    const richer = play.enteredFair < play.entry; // we never pick this side, but guard
    const diff = (play.enteredFair - play.entry) * 100;
    stories.push({
      label: `Mispricing · ${play.outcome} ${play.entrySide}`,
      value: `${cents(play.entry)} now vs ${cents(play.enteredFair)} fair`,
      tone: diff >= 0 ? "up" : "down",
      meaning: `Kalshi lets you buy ${play.outcome} ${play.entrySide} for ${cents(play.entry)}, but the model thinks it's really worth ${cents(play.enteredFair)} — a ${Math.abs(diff).toFixed(1)}¢ ${richer ? "premium" : "discount"}.`,
      bias: richer
        ? `The crowd is paying up. If Kalshi drifts back down toward fair, the side you bought loses value.`
        : `The crowd is underpaying. If Kalshi drifts up toward fair, the side you bought gains ~${Math.abs(diff).toFixed(1)}¢ — that gain is the trade.`,
    });
  }

  // 2. hype gap → crowd bias on Kalshi price
  const overlay = match.raw?.sentiment_overlay;
  if (overlay && Number.isFinite(overlay.hype_gap)) {
    const g = overlay.hype_gap;
    const leader = g > 0 ? T : g < 0 ? O : "neither side";
    stories.push({
      label: "Hype gap",
      value: `${g > 0 ? "+" : ""}${g.toFixed(1)} pts → ${leader}`,
      tone: "amber",
      meaning: `${leader === "neither side" ? "Both teams" : leader} ${leader === "neither side" ? "draw similar" : "is drawing ~" + Math.abs(g).toFixed(0) + " more points of"} search + news buzz right now.`,
      bias: g === 0
        ? `No crowd lean to fade.`
        : `Casual money tends to overbuy the hyped team, so ${leader}'s Kalshi YES is probably a few cents too high vs fair. Hype is an overlay only — it does NOT change the win probability, it just flags where the price may be crowd-driven.`,
    });
  }

  // 3. rest / travel / climate — model tilts
  const ctx = match.context;
  if (ctx) {
    if (Number.isFinite(ctx.rest) && ctx.rest !== 0) {
      const who = ctx.rest > 0 ? T : O;
      stories.push({
        label: "Rest edge",
        value: `${ctx.rest > 0 ? "+" : ""}${ctx.rest.toFixed(1)} days → ${who}`,
        tone: ctx.rest > 0 ? "up" : "down",
        meaning: `${who} has had ${Math.abs(ctx.rest).toFixed(1)} more day(s) of recovery since their last match.`,
        bias: `More rest is modeled as a small win-probability boost for ${who}, already baked into the fair price above.`,
      });
    }
    if (Number.isFinite(ctx.travel) && Math.abs(ctx.travel) > 1) {
      const who = ctx.travel > 0 ? T : O;
      stories.push({
        label: "Travel edge",
        value: `${ctx.travel > 0 ? "+" : ""}${Math.round(ctx.travel)} km → ${who}`,
        tone: ctx.travel > 0 ? "up" : "down",
        meaning: `Travel-distance differential to this venue, shown ${T} minus ${O}.`,
        bias: `The shorter-travel side (${who}) carries a small modeled edge from less fatigue; it's part of the fair price, not a separate bet.`,
      });
    }
    if (Number.isFinite(ctx.climate) && Math.abs(ctx.climate) > 1) {
      const who = ctx.climate > 0 ? T : O;
      stories.push({
        label: "Climate fit",
        value: `${ctx.climate > 0 ? "+" : ""}${ctx.climate.toFixed(1)} → ${who}`,
        tone: ctx.climate > 0 ? "up" : "down",
        meaning: `How much better the venue's heat/humidity suits one side, ${T} minus ${O}.`,
        bias: `${who} is modeled as more comfortable in these conditions — a minor nudge inside the fair price.`,
      });
    }
  }

  // 4. Monte Carlo EV on the headline outcome (simulated expected profit per $1)
  const mc = play ? match.raw?.monte_carlo?.find(x => x.outcome === play.outcome) : null;
  if (mc && Number.isFinite(mc.ev_per_dollar)) {
    const c = Math.round(mc.ev_per_dollar * 100);
    stories.push({
      label: "Simulated EV",
      value: `${c >= 0 ? "+" : ""}${c}¢ per $1`,
      tone: mc.ev_per_dollar >= 0 ? "up" : "down",
      meaning: `Across 25,000 simulated versions of this match (with uncertainty on the probabilities), buying ${play.outcome} at ${cents(mc.price)} returns ${c >= 0 ? "an average profit" : "an average loss"} of ${Math.abs(c)}¢ on every $1.`,
      bias: mc.ev_per_dollar >= 0
        ? `Positive even after stress-testing — the edge survives noise.`
        : `Negative once stressed — treat the headline edge with caution.`,
    });
  }

  return stories;
}

function hypeRead(match) {
  const overlay = match.raw?.sentiment_overlay;
  if (!overlay) {
    return { status: "Not fetched", text: "Run npm run refresh:sentiment to pull Google Trends and news hype data.", gap: 0 };
  }
  const gap = overlay.hype_gap || 0;
  const assessment = overlay.assessment;
  const leader = gap > 0 ? match.team : gap < 0 ? match.opponent : "Neither side";
  let text = `${leader} has the stronger hype signal.`;
  if (assessment?.conviction) text = assessment.conviction;
  return {
    status: overlay.source === "cache" ? "Cached hype" : "Live hype",
    text, gap, team: overlay.team, opponent: overlay.opponent,
  };
}

const STORY_COLOR = { up: "var(--up)", down: "var(--down)", amber: "var(--amber)" };

export default function App() {
  const [matches, setMatches] = useState(SAMPLE_MATCHES);
  const [selected, setSelected] = useState(SAMPLE_MATCHES[1].id);
  const [dataStatus, setDataStatus] = useState("Sample data");
  const [modelQuality, setModelQuality] = useState(null);

  useEffect(() => {
    fetch(`${KALSHI_DATA_URL}?t=${Date.now()}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(payload => {
        const rows = Array.isArray(payload) ? payload : payload.matches;
        setModelQuality(Array.isArray(payload) ? null : payload.model_quality);
        const liveMatches = adaptKalshiRows(Array.isArray(rows) ? rows : []);
        if (liveMatches.length > 0) {
          setMatches(liveMatches);
          setSelected(liveMatches[0].id);
          setDataStatus(`Kalshi live snapshot · ${liveMatches.length} matches`);
        } else {
          setDataStatus("Sample data · run npm run refresh:data");
        }
      })
      .catch(() => setDataStatus("Sample data · run npm run refresh:data"));
  }, []);

  const analyses = useMemo(() => Object.fromEntries(matches.map(m => [m.id, analyze(m)])), [matches]);
  const match = matches.find(m => m.id === selected) || matches[0];
  const a = analyses[match.id];
  const rec = recommendation(match, a);
  const play = convergencePlay(match);
  const stories = numberStories(match, play);
  const hype = hypeRead(match);

  const arbCount = matches.filter(m => m.arb).length;
  const edgeCount = matches.filter(m => !m.arb && analyses[m.id].bestEdge.edge > 5).length;

  // play economics on the bankroll
  const playPairCost = play ? play.entry + play.hedgeFairPrice : null;
  const playPairs = play && playPairCost ? Math.floor(BANKROLL / playPairCost) : 0;
  const playLockTotal = play ? play.maxLockProfit * playPairs : 0;

  return (
    <div className="term">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        :root {
          --bg: #0a0e14; --panel: #11161f; --panel2: #161d29; --line: #1f2937;
          --ink: #e8edf4; --dim: #5b6878; --dimmer: #3a4453;
          --up: #2dd4a7; --down: #f0556d; --amber: #f4b740; --cyan: #4cc9f0;
          --arb: #2dd4a7; --edge: #4cc9f0; --pass: #5b6878;
        }
        .term { background: var(--bg); min-height: 100vh; color: var(--ink);
          font-family: 'Space Grotesk', system-ui, sans-serif; padding: 0; }
        .mono { font-family: 'JetBrains Mono', monospace; font-variant-numeric: tabular-nums; }
        .wrap { max-width: 1180px; margin: 0 auto; padding: 22px 18px 60px; }

        /* header */
        .top { display: flex; align-items: baseline; justify-content: space-between;
          border-bottom: 1px solid var(--line); padding-bottom: 16px; margin-bottom: 22px; flex-wrap: wrap; gap: 12px; }
        .brand { font-weight: 700; font-size: 19px; letter-spacing: -0.02em; }
        .brand b { color: var(--up); }
        .brand .tag { font-family:'JetBrains Mono',monospace; font-size: 10px; color: var(--dim);
          letter-spacing: .18em; text-transform: uppercase; display:block; margin-top:2px; }
        .summary { display: flex; gap: 22px; }
        .sm { text-align: right; }
        .sm .n { font-family:'JetBrains Mono',monospace; font-size: 22px; font-weight: 600; line-height: 1; }
        .sm .l { font-size: 10px; color: var(--dim); letter-spacing: .12em; text-transform: uppercase; margin-top: 5px; }

        /* layout */
        .grid { display: grid; grid-template-columns: 340px 1fr; gap: 18px; }
        @media (max-width: 820px) { .grid { grid-template-columns: 1fr; } }

        /* match list */
        .list { display: flex; flex-direction: column; gap: 8px; }
        .mrow { background: var(--panel); border: 1px solid var(--line); border-radius: 10px;
          padding: 13px 14px; cursor: pointer; transition: border-color .15s, background .15s; text-align: left; width:100%; }
        .mrow:hover { border-color: var(--dimmer); }
        .mrow.on { border-color: var(--up); background: var(--panel2); }
        .mrow:focus-visible { outline: 2px solid var(--cyan); outline-offset: 2px; }
        .mrow .mt { display:flex; justify-content: space-between; align-items: baseline; }
        .mrow .vs { font-weight: 600; font-size: 14px; color: var(--ink); }
        .mrow .ko { font-family:'JetBrains Mono',monospace; font-size: 10px; color: var(--dim); }
        .mrow .meta { display:flex; gap: 8px; margin-top: 9px; align-items:center; }
        .chip { font-family:'JetBrains Mono',monospace; font-size: 10px; padding: 2px 7px; border-radius: 4px;
          letter-spacing: .04em; font-weight: 500; }
        .chip.arb { background: rgba(45,212,167,.13); color: var(--arb); border:1px solid rgba(45,212,167,.3); }
        .chip.edge { background: rgba(76,201,240,.12); color: var(--edge); border:1px solid rgba(76,201,240,.28); }
        .chip.pass { background: transparent; color: var(--pass); border:1px solid var(--line); }
        .mrow .venue { font-size: 11px; color: var(--dim); margin-left:auto; }

        /* detail */
        .detail { background: var(--panel); border:1px solid var(--line); border-radius: 14px; overflow:hidden; }
        .dhead { padding: 20px 22px; border-bottom: 1px solid var(--line);
          display:flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; }
        .dhead h2 { font-size: 22px; font-weight: 700; letter-spacing: -0.02em; }
        .dhead .sub { font-family:'JetBrains Mono',monospace; font-size: 11px; color: var(--dim); margin-top: 5px; letter-spacing:.06em; }
        .recbox { padding: 11px 16px; border-radius: 10px; text-align:right; min-width: 150px; }
        .recbox.arb { background: rgba(45,212,167,.1); border:1px solid rgba(45,212,167,.35); }
        .recbox.edge { background: rgba(76,201,240,.08); border:1px solid rgba(76,201,240,.3); }
        .recbox.pass { background: var(--panel2); border:1px solid var(--line); }
        .recbox .rt { font-family:'JetBrains Mono',monospace; font-size: 10px; letter-spacing:.16em; }
        .recbox .rx { font-weight: 600; font-size: 15px; margin-top:3px; }

        .dbody { padding: 20px 22px; }
        .sect { margin-bottom: 24px; }
        .sect:last-child { margin-bottom: 0; }
        .sect h3 { font-family:'JetBrains Mono',monospace; font-size: 10px; color: var(--dim);
          letter-spacing: .16em; text-transform: uppercase; margin-bottom: 12px; }
        .explain { color: var(--dim); font-size: 12px; line-height: 1.45; margin: -4px 0 12px; }

        /* THE PLAY hero */
        .play { background: linear-gradient(135deg, rgba(76,201,240,.10), rgba(45,212,167,.05));
          border:1px solid rgba(76,201,240,.35); border-radius: 14px; padding: 18px 20px; margin-bottom: 22px; }
        .play.lock { border-color: rgba(45,212,167,.5); background: linear-gradient(135deg, rgba(45,212,167,.12), rgba(45,212,167,.04)); }
        .play .ph { font-family:'JetBrains Mono',monospace; font-size: 10px; letter-spacing:.16em; color: var(--cyan); text-transform: uppercase; margin-bottom: 10px; }
        .play.lock .ph { color: var(--up); }
        .play .story { font-size: 16px; line-height: 1.55; }
        .play .story b { color: var(--ink); }
        .play .story .buy { color: var(--up); font-weight: 700; }
        .play .story .wait { color: var(--amber); font-weight: 700; }
        .play .story .lock { color: var(--cyan); font-weight: 700; }

        /* price path strip: entry -> converge -> lock */
        .path { display:flex; align-items:center; gap: 0; margin: 16px 0 4px; }
        .pnode { flex:1; text-align:center; position: relative; }
        .pnode .pt { font-family:'JetBrains Mono',monospace; font-size: 18px; font-weight: 600; }
        .pnode .pl { font-size: 10px; color: var(--dim); letter-spacing:.08em; text-transform:uppercase; margin-top: 3px; }
        .pnode .pd { font-size: 11px; color: var(--dim); margin-top: 4px; line-height:1.35; }
        .parrow { color: var(--dimmer); font-family:'JetBrains Mono',monospace; font-size: 14px; padding: 0 4px; align-self:flex-start; margin-top: 6px; }
        .playmetrics { display:grid; grid-template-columns: repeat(auto-fit, minmax(130px,1fr)); gap: 10px; margin-top: 16px; }
        .pm { background: rgba(10,14,20,.4); border:1px solid var(--line); border-radius: 9px; padding: 10px 12px; }
        .pm .pml { font-size: 10px; color: var(--dim); letter-spacing:.08em; text-transform:uppercase; }
        .pm .pmv { font-family:'JetBrains Mono',monospace; font-size: 17px; font-weight: 600; margin-top: 4px; }
        .play .caveat { font-size: 11.5px; color: var(--dim); line-height:1.5; margin-top: 14px; border-top: 1px solid var(--line); padding-top: 12px; }

        /* number stories */
        .stories { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        @media (max-width: 640px) { .stories { grid-template-columns: 1fr; } }
        .scard { background: var(--panel2); border:1px solid var(--line); border-radius: 10px; padding: 13px 15px; }
        .scard .sl { font-size: 10px; color: var(--dim); letter-spacing:.08em; text-transform:uppercase; }
        .scard .sv { font-family:'JetBrains Mono',monospace; font-size: 16px; font-weight: 600; margin-top: 4px; }
        .scard .sm2 { font-size: 12px; color: var(--ink); line-height:1.5; margin-top: 8px; }
        .scard .sb { font-size: 11.5px; color: var(--dim); line-height:1.5; margin-top: 6px; }

        /* prob bar */
        .probbar { display:flex; height: 34px; border-radius: 8px; overflow:hidden; border:1px solid var(--line); }
        .probseg { display:flex; align-items:center; justify-content:center; font-family:'JetBrains Mono',monospace;
          font-size: 12px; font-weight: 600; color: #07101a; }
        .probseg.win { background: var(--up); }
        .probseg.draw { background: #3a4453; color: var(--ink); }
        .probseg.loss { background: var(--down); }
        .probkey { display:flex; gap: 16px; margin-top: 9px; font-size: 11px; color: var(--dim); }
        .probkey span b { color: var(--ink); font-family:'JetBrains Mono',monospace; }
        .comparegrid { display:grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 10px; }
        .comparecard { background: var(--panel2); border:1px solid var(--line); border-radius: 10px; padding: 12px 13px; }
        .comparetop { display:flex; justify-content: space-between; gap: 8px; font-size: 13px; font-weight: 600; }
        .comparevals { display:flex; justify-content: space-between; color: var(--dim); font-family:'JetBrains Mono',monospace; font-size: 11px; margin-top: 8px; }
        .gaptrack { position:relative; height: 8px; background: var(--bg); border-radius: 999px; margin-top: 10px; overflow:hidden; }
        .gaptrack i { position:absolute; top:0; bottom:0; left:50%; }
        .zeroline { position:absolute; top:0; bottom:0; left:50%; width:1px; background: var(--dimmer); }

        /* market grid */
        .mkt { display:grid; grid-template-columns: repeat(2,1fr); gap: 10px; }
        .mcard { background: var(--panel2); border:1px solid var(--line); border-radius: 10px; padding: 13px 15px; }

        /* tables (inside expandables) */
        .ctable { width: 100%; border-collapse: collapse; }
        .ctable th { text-align: right; font-family:'JetBrains Mono',monospace; font-weight: 500; font-size: 10px;
          color: var(--dim); letter-spacing: .1em; text-transform: uppercase; padding: 0 0 10px; }
        .ctable th:first-child { text-align: left; }
        .ctable td { padding: 11px 0; border-top: 1px solid var(--line); font-family:'JetBrains Mono',monospace;
          font-size: 13px; text-align: right; }
        .ctable td:first-child { text-align: left; font-family:'Space Grotesk',sans-serif; font-weight: 500; }
        .clab .note { font-family:'JetBrains Mono',monospace; font-size: 9px; color: var(--amber);
          display:block; letter-spacing:.06em; margin-top:1px; }
        .stakecell.bet { color: var(--up); font-weight: 600; }
        .stakecell.no { color: var(--dimmer); }

        details.more { border:1px solid var(--line); border-radius: 10px; background: var(--panel2); margin-bottom: 12px; }
        details.more > summary { cursor: pointer; padding: 12px 15px; font-family:'JetBrains Mono',monospace;
          font-size: 11px; letter-spacing:.08em; color: var(--dim); list-style: none; display:flex; justify-content: space-between; }
        details.more > summary::-webkit-details-marker { display:none; }
        details.more > summary::after { content: "+ show"; color: var(--cyan); }
        details.more[open] > summary::after { content: "− hide"; }
        details.more > .inner { padding: 0 15px 15px; }

        /* arb panel */
        .arbpanel { background: linear-gradient(135deg, rgba(45,212,167,.09), rgba(45,212,167,.03));
          border: 1px solid rgba(45,212,167,.35); border-radius: 12px; padding: 16px 18px; }
        .arbpanel .legs { display:flex; gap: 10px; align-items:center; flex-wrap:wrap; margin: 10px 0; }
        .leg { background: var(--bg); border:1px solid var(--line); border-radius: 8px; padding: 9px 13px; font-family:'JetBrains Mono',monospace; }
        .leg .lv { font-size: 10px; color: var(--dim); text-transform:uppercase; letter-spacing:.08em; }
        .leg .lp { font-size: 15px; font-weight:600; margin-top:2px; }
        .plus { color: var(--dim); font-size: 18px; }
        .arbprofit { font-family:'JetBrains Mono',monospace; font-size: 13px; }
        .arbprofit b { color: var(--up); font-size: 16px; }
        .ladder { display:grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px; margin-top: 12px; }
        .ladderitem { border:1px solid var(--line); border-radius: 8px; padding: 8px 9px; background: rgba(10,14,20,.35); }
        .ladderitem .lt { font-family:'JetBrains Mono',monospace; font-size: 10px; color: var(--dim); }
        .ladderitem .lv { font-family:'JetBrains Mono',monospace; font-size: 12px; margin-top: 4px; }
        .bar { height: 5px; background: var(--line); border-radius: 999px; overflow:hidden; margin-top: 7px; }
        .bar i { display:block; height:100%; background: var(--up); }

        /* context strip */
        .ctx { display:flex; gap: 10px; flex-wrap: wrap; }
        .cpill { background: var(--panel2); border:1px solid var(--line); border-radius: 8px; padding: 9px 13px; flex:1; min-width: 110px; }
        .cpill .cl { font-size: 10px; color: var(--dim); letter-spacing:.08em; text-transform:uppercase; }
        .cpill .cv { font-family:'JetBrains Mono',monospace; font-size: 15px; font-weight:600; margin-top:3px; }
        .hype { display:flex; gap: 10px; align-items:center; font-family:'JetBrains Mono',monospace; font-size:12px; }
        .hypebar { flex:1; height:6px; background:var(--panel2); border-radius:3px; position:relative; overflow:hidden; }
        .hypebar i { position:absolute; top:0; bottom:0; }

        .foot { margin-top: 18px; font-family:'JetBrains Mono',monospace; font-size: 10px; color: var(--dimmer); line-height:1.6; }
      `}</style>

      <div className="wrap">
        <header className="top">
          <div className="brand">WC <b>EDGE</b> TERMINAL
            <span className="tag">{dataStatus}</span>
            {modelQuality && (
              <span className="tag">
                BACKTEST {modelQuality.source} · accuracy {modelQuality.accuracy} · log loss {modelQuality.log_loss}
              </span>
            )}
          </div>
          <div className="summary">
            <div className="sm"><div className="n" style={{ color: "var(--arb)" }}>{arbCount}</div><div className="l">Arbs live</div></div>
            <div className="sm"><div className="n" style={{ color: "var(--edge)" }}>{edgeCount}</div><div className="l">Edges</div></div>
            <div className="sm"><div className="n mono">{matches.length}</div><div className="l">Matches</div></div>
            <div className="sm"><div className="n mono">${BANKROLL}</div><div className="l">Bankroll</div></div>
          </div>
        </header>

        <div className="grid">
          {/* match list */}
          <nav className="list" aria-label="Matches">
            {matches.map(m => {
              const ma = analyses[m.id];
              const r = recommendation(m, ma);
              return (
                <button key={m.id} className={`mrow${m.id === selected ? " on" : ""}`}
                  onClick={() => setSelected(m.id)} aria-pressed={m.id === selected}>
                  <div className="mt">
                    <span className="vs">{m.team} <span style={{ color: "var(--dim)" }}>v</span> {m.opponent}</span>
                    <span className="ko">{m.kickoff}</span>
                  </div>
                  <div className="meta">
                    <span className={`chip ${r.tone}`}>{r.type}</span>
                    {r.type !== "PASS" && <span className="mono" style={{ fontSize: 11, color: r.tone === "arb" ? "var(--arb)" : "var(--edge)" }}>{r.text}</span>}
                    <span className="venue">{m.venue}</span>
                  </div>
                </button>
              );
            })}
          </nav>

          {/* detail */}
          <section className="detail">
            <div className="dhead">
              <div>
                <h2>{match.team} <span style={{ color: "var(--dim)", fontWeight: 400 }}>vs</span> {match.opponent}</h2>
                <div className="sub">{match.venue.toUpperCase()} · {match.kickoff.toUpperCase()} · STR:{match.sources.strength} FORM:{match.sources.form}</div>
                {match.raw?.missing_inputs?.length > 0 && (
                  <div className="sub" style={{ color: "var(--amber)", marginTop: 7 }}>
                    DATA NEEDED · {match.raw.missing_inputs.join(" · ")}
                  </div>
                )}
              </div>
              <div className={`recbox ${rec.tone}`}>
                <div className="rt" style={{ color: `var(--${rec.tone})` }}>{rec.type}</div>
                <div className="rx">{rec.text}</div>
              </div>
            </div>

            <div className="dbody">

              {/* ============ THE PLAY — plain-English convergence trade ============ */}
              {match.arb ? (
                <div className="play lock">
                  <div className="ph">The play · instant risk-free arbitrage</div>
                  <div className="story">
                    Buy <span className="buy">YES on {match.arb.buy_yes_on}</span> at <b>{cents(match.arb.yes_ask)}</b> and{" "}
                    <span className="buy">NO on {match.arb.buy_no_on}</span> at <b>{cents(match.arb.no_ask)}</b> at the same time.
                    Together they cost <b>{cents(match.arb.total_cost)}</b> but one side always pays out <b>$1.00</b>, so you
                    pocket the <span className="lock">{cents(1 - match.arb.total_cost)} difference no matter who wins</span>.
                  </div>
                  <div className="playmetrics">
                    <div className="pm"><div className="pml">Locked return</div><div className="pmv" style={{ color: "var(--up)" }}>+{match.arb.return_pct}%</div></div>
                    <div className="pm"><div className="pml">Profit / contract</div><div className="pmv">{cents(match.arb.net_profit_per_contract)}</div></div>
                    <div className="pm"><div className="pml">Pairs on ${BANKROLL}</div><div className="pmv">{Math.floor(BANKROLL / match.arb.total_cost)}</div></div>
                    <div className="pm"><div className="pml">Total profit</div><div className="pmv" style={{ color: "var(--up)" }}>${(BANKROLL / match.arb.total_cost * match.arb.net_profit_per_contract).toFixed(2)}</div></div>
                  </div>
                  {match.arb.cross_venue && <div className="caveat">Cross-venue arb — verify both contracts settle on identical wording (same match, same 90-minute rule) before sizing in.</div>}
                </div>
              ) : play ? (
                <div className={`play${play.lockableNow ? " lock" : ""}`}>
                  <div className="ph">
                    The play · {play.lockableNow ? "hedge lockable right now" : "wait-for-convergence trade"}
                  </div>
                  <div className="story">
                    <span className="buy">Buy {play.outcome} {play.entrySide}</span> on Kalshi now at <b>{cents(play.entry)}</b>.
                    The model's fair price is <b>{cents(play.convergePrice)}</b>, so the market looks {play.maxLockProfit >= 0 ? "too cheap" : "too rich"} by{" "}
                    <b>{Math.abs(play.maxLockProfit * 100).toFixed(1)}¢</b>.{" "}
                    <span className="wait">Then wait</span> for the price to drift toward fair value. As it does, the other side ({play.hedgeSide}){" "}
                    gets cheap — once you can buy {play.hedgeSide} near <b>{cents(play.hedgeFairPrice)}</b>, your two sides cost under $1 and{" "}
                    <span className="lock">you lock ~{cents(play.maxLockProfit)} of guaranteed profit per contract</span> ({roiPct(play.maxRoi)} ROI), win or lose.
                  </div>

                  <div className="path">
                    <div className="pnode">
                      <div className="pt" style={{ color: "var(--up)" }}>{cents(play.entry)}</div>
                      <div className="pl">1 · Buy {play.entrySide}</div>
                      <div className="pd">Enter today at the current ask</div>
                    </div>
                    <div className="parrow">→</div>
                    <div className="pnode">
                      <div className="pt" style={{ color: "var(--amber)" }}>{cents(play.convergePrice)}</div>
                      <div className="pl">2 · Converge</div>
                      <div className="pd">Price drifts to model fair value</div>
                    </div>
                    <div className="parrow">→</div>
                    <div className="pnode">
                      <div className="pt" style={{ color: "var(--cyan)" }}>{cents(play.hedgeFairPrice)}</div>
                      <div className="pl">3 · Hedge {play.hedgeSide}</div>
                      <div className="pd">Buy the other side to lock the spread</div>
                    </div>
                  </div>

                  <div className="playmetrics">
                    <div className="pm"><div className="pml">Lock / contract</div><div className="pmv" style={{ color: play.maxLockProfit >= 0 ? "var(--up)" : "var(--down)" }}>{cents(play.maxLockProfit)}</div></div>
                    <div className="pm"><div className="pml">ROI at convergence</div><div className="pmv" style={{ color: play.maxRoi >= 0 ? "var(--up)" : "var(--down)" }}>{roiPct(play.maxRoi)}</div></div>
                    <div className="pm"><div className="pml">Chance it gets there</div><div className="pmv">{reachWord(play.reach)}</div></div>
                    <div className="pm"><div className="pml">If filled on ${BANKROLL}</div><div className="pmv" style={{ color: "var(--up)" }}>${playLockTotal.toFixed(0)}</div></div>
                  </div>

                  <div className="caveat">
                    This is <b>not</b> instant arbitrage — the lock only happens <b>if</b> the price actually converges toward fair value.
                    Timing: <b>{play.phase.replace(/_/g, " ")}</b>{Number.isFinite(play.hours) ? ` · ${Math.round(play.hours)}h to kickoff` : ""}.
                    "{reachWord(play.reach)}" is a rough chance the move happens soon (heuristic until enough price paths are logged).
                    {play.lockableNow && <> The hedge is <b style={{ color: "var(--up)" }}>already lockable</b> at the current {play.hedgeSide} ask of {cents(play.currentHedgeAsk)} — you don't even need to wait.</>}
                  </div>
                </div>
              ) : null}

              {/* ============ WHAT THE NUMBERS MEAN ============ */}
              {stories.length > 0 && (
                <div className="sect">
                  <h3>What the numbers mean</h3>
                  <Explain>Each card is the actual number, what it says in plain English, and which way it nudges the Kalshi price.</Explain>
                  <div className="stories">
                    {stories.map((s, i) => (
                      <div className="scard" key={i}>
                        <div className="sl">{s.label}</div>
                        <div className="sv" style={{ color: STORY_COLOR[s.tone] || "var(--ink)" }}>{s.value}</div>
                        <div className="sm2">{s.meaning}</div>
                        <div className="sb">{s.bias}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ============ MODEL PROBABILITY ============ */}
              <div className="sect">
                <h3>Model probability (the fair-value view)</h3>
                <Explain>
                  This is the model's best guess at the three outcomes. Every price above is compared against these
                  numbers — when Kalshi's price differs from the matching probability, that gap is the opportunity.
                </Explain>
                <div className="probbar">
                  <div className="probseg win" style={{ width: `${match.model.p_team_win * 100}%` }}>
                    {match.model.p_team_win >= 0.12 && <Pct v={match.model.p_team_win} />}
                  </div>
                  <div className="probseg draw" style={{ width: `${match.model.p_draw * 100}%` }}>
                    {match.model.p_draw >= 0.12 && <Pct v={match.model.p_draw} />}
                  </div>
                  <div className="probseg loss" style={{ width: `${match.model.p_opp_win * 100}%` }}>
                    {match.model.p_opp_win >= 0.12 && <Pct v={match.model.p_opp_win} />}
                  </div>
                </div>
                <div className="probkey">
                  <span><b>{match.team}</b> win {fmtPct(match.model.p_team_win, 0)}</span>
                  <span><b>Draw</b> {fmtPct(match.model.p_draw, 0)}</span>
                  <span><b>{match.opponent}</b> win {fmtPct(match.model.p_opp_win, 0)}</span>
                  <span style={{ marginLeft: "auto", color: "var(--amber)" }}>
                    {match.team} NOT-win = <b style={{ color: "var(--ink)" }}><Pct v={a.pTeamNotWin} /></b> (incl. draw)
                  </span>
                </div>
              </div>

              {/* ============ KALSHI vs FAIR ============ */}
              {match.raw?.outcome_edges?.length > 0 && (
                <div className="sect">
                  <h3>Kalshi price vs our fair price</h3>
                  <Explain>
                    Green = Kalshi is cheaper than our fair value (a discount you can buy). Red = the market is richer than fair
                    (overpriced). The longer the bar, the bigger the gap — and the bigger a convergence move could be.
                  </Explain>
                  <div className="comparegrid">
                    {marketRows(match.raw).map(row => {
                      const positive = row.gapPts >= 0;
                      const width = Math.min(Math.abs(row.gapPts || 0) * 2.5, 50);
                      return (
                        <div className="comparecard" key={row.outcome}>
                          <div className="comparetop">
                            <span>{row.outcome}</span>
                            <span style={{ color: positive ? "var(--up)" : "var(--down)" }}>
                              {Number.isFinite(row.gapPts) ? `${positive ? "+" : ""}${row.gapPts.toFixed(1)}pt` : "—"}
                            </span>
                          </div>
                          <div className="comparevals">
                            <span>fair {cents(row.model)}</span>
                            <span>Kalshi {cents(row.ask)}</span>
                          </div>
                          <div className="gaptrack">
                            <span className="zeroline" />
                            <i style={{
                              width: `${width}%`,
                              left: positive ? "50%" : `${50 - width}%`,
                              background: positive ? "var(--up)" : "var(--down)",
                            }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ============ FULL NUMBERS (expandable, data preserved) ============ */}
              <div className="sect">
                <h3>Full numbers</h3>
                <Explain>Everything the model computed, kept here for when you want the raw detail behind the story above.</Explain>

                <details className="more">
                  <summary>Outcome contracts · model vs market · quarter-Kelly sizing</summary>
                  <div className="inner">
                    <table className="ctable">
                      <thead>
                        <tr><th>Contract</th><th>Model</th><th>Price</th><th>Edge</th><th>Log-g</th><th>Stake</th></tr>
                      </thead>
                      <tbody>
                        {a.contracts.map((c, i) => (
                          <tr key={i}>
                            <td className="clab">{c.label}{c.note && <span className="note">{c.note}</span>}</td>
                            <td><Pct v={c.p} /></td>
                            <td style={{ color: "var(--dim)" }}>{c.price.toFixed(2)}</td>
                            <td><Signed v={c.edge} suffix="pt" /></td>
                            <td style={{ color: c.logGrowth > 0 ? "var(--up)" : "var(--dimmer)" }}>{c.logGrowth > 0 ? c.logGrowth.toFixed(4) : "—"}</td>
                            <td className={`stakecell ${c.stake > 0 ? "bet" : "no"}`}>{c.stake > 0 ? `$${c.stake}` : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="foot">EDGE = model prob − price. STAKE = ¼-Kelly, capped {MAX_FRAC * 100}% of bankroll. A suggestion, not an auto-bet.</div>
                  </div>
                </details>

                {match.raw?.monte_carlo?.length > 0 && (
                  <details className="more">
                    <summary>Monte Carlo · 25k simulations with probability uncertainty</summary>
                    <div className="inner">
                      <table className="ctable">
                        <thead>
                          <tr><th>Outcome</th><th>Hit Rate</th><th>Price</th><th>Edge</th><th>EV / $</th><th>Status</th></tr>
                        </thead>
                        <tbody>
                          {match.raw.monte_carlo.map(mc => (
                            <tr key={mc.outcome}>
                              <td className="clab">{mc.outcome}</td>
                              <td><Pct v={mc.model_win_prob} /></td>
                              <td>{mc.price.toFixed(2)}</td>
                              <td><Signed v={mc.edge_pct_points} suffix="pt" /></td>
                              <td style={{ color: mc.ev_per_dollar > 0 ? "var(--up)" : "var(--down)" }}>{mc.ev_per_dollar.toFixed(3)}</td>
                              <td>{mc.positive_ev ? "positive" : "negative"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div className="foot">EV / $ is simulated expected profit per $1 staked at the shown price, after stress-testing the probabilities.</div>
                    </div>
                  </details>
                )}

                {play?.ladder?.length > 0 && (
                  <details className="more">
                    <summary>Hedge profit ladder · {play.outcome} {play.entrySide}</summary>
                    <div className="inner">
                      <Explain>
                        Each rung: if you can buy {play.hedgeSide} at or below this price, you lock the listed profit. "Reach" is the
                        heuristic chance the market gets there. Higher profit needs a bigger move, so reach drops.
                      </Explain>
                      <div className="ladder">
                        {play.ladder.map(step => (
                          <div className="ladderitem" key={`${play.ticker}-${step.target_profit}`}>
                            <div className="lt">lock {cents(step.target_profit)} · ROI {fmtPct(ladderRoi(step))}</div>
                            <div className="lv">hedge {play.hedgeSide} ≤ <b>{cents(step.hedge_price)}</b> · reach {(step.reach_score * 100).toFixed(0)}%</div>
                            <div className="bar"><i style={{ width: `${step.reach_score * 100}%` }} /></div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </details>
                )}

                {match.raw?.features_used && (
                  <details className="more">
                    <summary>Raw model features & data sources</summary>
                    <div className="inner foot" style={{ marginTop: 0 }}>
                      strength {match.raw.features_used.strength_diff}, form {match.raw.features_used.form_diff},
                      rest {match.raw.features_used.rest_diff}, climate {match.raw.features_used.climate_stress_diff},
                      travel {match.raw.features_used.travel_diff}.<br />
                      Sources: STR {match.sources.strength}, FORM {match.sources.form},
                      CTX {match.raw.feature_sources?.context || "unknown"}
                      {match.raw.feature_sources?.weather ? `, WEATHER ${match.raw.feature_sources.weather}` : ""}.
                    </div>
                  </details>
                )}
              </div>

              {/* ============ CONTEXT + SENTIMENT ============ */}
              <div className="sect">
                <h3>Context & crowd sentiment</h3>
                <Explain>
                  These differentials (always {match.team} minus {match.opponent}) are already folded into the fair price above.
                  Hype is separate — it never changes the win probability, it only flags where the Kalshi price may be crowd-driven.
                </Explain>
                <div className="ctx">
                  <div className="cpill"><div className="cl">Climate stress Δ</div><div className="cv"><Signed v={match.context.climate} /></div></div>
                  <div className="cpill"><div className="cl">Rest Δ (days)</div><div className="cv mono">{match.context.rest >= 0 ? "+" : ""}{match.context.rest}</div></div>
                  <div className="cpill"><div className="cl">Travel Δ (km)</div><div className="cv mono">{match.context.travel}</div></div>
                </div>
                <div style={{ marginTop: 12 }} className="hype">
                  <span style={{ width: 70, color: "var(--dim)" }}>Hype gap</span>
                  <div className="hypebar">
                    {(() => {
                      const gap = hype.gap;
                      const w = Math.min(Math.abs(gap) / 80 * 50, 50);
                      return <i style={{ left: gap >= 0 ? "50%" : `${50 - w}%`, width: `${w}%`, background: gap >= 0 ? "var(--down)" : "var(--up)" }} />;
                    })()}
                    <i style={{ left: "50%", width: 1, background: "var(--dimmer)" }} />
                  </div>
                  <span style={{ width: 130, textAlign: "right", color: "var(--dim)" }}>{hype.status}</span>
                </div>
                <div className="foot" style={{ marginTop: 10 }}>
                  Hype read: {hype.text}
                  {hype.team && hype.opponent && (
                    <>
                      {" "}Scores: {match.team} {fmtNum(hype.team.hype_score, 1)} vs {match.opponent} {fmtNum(hype.opponent.hype_score, 1)}.
                      {" "}Trends: {match.team} interest {fmtNum(hype.team.search_interest, 1)}, momentum {fmtNum(hype.team.search_momentum, 1)}%;
                      {" "}{match.opponent} interest {fmtNum(hype.opponent.search_interest, 1)}, momentum {fmtNum(hype.opponent.search_momentum, 1)}%.
                    </>
                  )}
                </div>
              </div>

              <div className="foot">
                {modelQuality?.warning && <>⚠ {modelQuality.warning} Treat probabilities as rough estimates.<br /></>}
                Convergence ROI assumes the price reaches model fair value and you hedge there; the lock is conditional on that move.
                Kalshi snapshots use neutral values for any missing inputs until ratings/venue data is fully wired in.
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
