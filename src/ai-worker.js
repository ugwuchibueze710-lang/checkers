// Royal Checkers — AI search worker (alpha-beta negamax, iterative deepening, quiescence).
import { VARIANTS, generateMoves, applyMove } from './rules.js';

let deadline = 0, nodes = 0, stopped = false;

function evaluate(b, V) {
  // score from red's perspective
  const N = V.N;
  let s = 0, red = 0, black = 0;
  for (let sq = 0; sq < N * N; sq++) {
    const p = b[sq];
    if (!p) continue;
    const r = (sq / N) | 0, c = sq % N;
    const color = Math.sign(p);
    let v;
    if (Math.abs(p) === 1) {
      const adv = color === 1 ? N - 1 - r : r;
      v = V.manValue + adv * adv * 0.9;
      if (c > 1 && c < N - 2) v += 5;              // centre files
      if ((color === 1 && r === N - 1) || (color === -1 && r === 0)) v += 8; // back-row guard
      if (c === 0 || c === N - 1) v -= 3;          // edge men are less flexible
    } else {
      const dc = Math.abs(c - (N - 1) / 2), dr = Math.abs(r - (N - 1) / 2);
      v = V.kingValue - (dc + dr) * 2.5;
    }
    s += color * v;
    if (color === 1) red += v; else black += v;
  }
  // when ahead, trading down is good
  const total = red + black;
  if (total > 0) s += (s > 0 ? 1 : -1) * Math.min(Math.abs(s), 400) * (1 - total / (V.N * V.rows * V.manValue)) * 0.4;
  return s;
}

function order(moves) {
  return moves.sort((a, b) => (b.caps.length - a.caps.length));
}

function quiesce(b, color, V, forced, alpha, beta, qd) {
  nodes++;
  const stand = color * evaluate(b, V);
  if (qd <= 0) return stand;
  const moves = generateMoves(b, color, V, forced);
  if (!moves.length) return -100000;
  const caps = moves.filter((m) => m.capture);
  if (forced && caps.length) {
    // in forced mode a capture is compulsory, so no stand-pat
    let best = -Infinity;
    for (const m of order(caps)) {
      const sc = -quiesce(applyMove(b, m, V), -color, V, forced, -beta, -alpha, qd - 1);
      if (sc > best) best = sc;
      if (sc > alpha) alpha = sc;
      if (alpha >= beta) break;
    }
    return best;
  }
  if (stand >= beta) return stand;
  if (stand > alpha) alpha = stand;
  for (const m of order(caps.filter((m) => m.complete))) {
    const sc = -quiesce(applyMove(b, m, V), -color, V, forced, -beta, -alpha, qd - 1);
    if (sc >= beta) return sc;
    if (sc > alpha) alpha = sc;
  }
  return alpha;
}

function negamax(b, color, V, forced, depth, alpha, beta, ply) {
  if ((++nodes & 1023) === 0 && performance.now() > deadline) stopped = true;
  if (stopped) return 0;
  const moves = generateMoves(b, color, V, forced);
  if (!moves.length) return -100000 + ply; // no moves = loss
  if (depth <= 0) return quiesce(b, color, V, forced, alpha, beta, 6);
  let best = -Infinity;
  for (const m of order(moves)) {
    const sc = -negamax(applyMove(b, m, V), -color, V, forced, depth - 1, -beta, -alpha, ply + 1);
    if (stopped) return 0;
    if (sc > best) best = sc;
    if (sc > alpha) alpha = sc;
    if (alpha >= beta) break;
  }
  return best;
}

export function levelParams(level) {
  const L = Math.max(1, level | 0);
  return {
    maxDepth: Math.min(1 + Math.ceil(L * 0.9), 40),
    timeMs: Math.min(300 + L * 220, 4500),
    noise: Math.max(0, 140 - L * 20),        // random score jitter (centi-men)
    blunder: Math.max(0, 0.38 - L * 0.07),   // chance to play a random legal move
  };
}

function search(board, color, V, forced, level) {
  const P = levelParams(level);
  const moves = order(generateMoves(board, color, V, forced));
  if (!moves.length) return { move: null, candidates: [] };
  if (moves.length === 1) return { move: moves[0], candidates: [{ move: moves[0], score: 0 }], depth: 0 };
  nodes = 0; stopped = false;
  deadline = performance.now() + P.timeMs;
  let scored = moves.map((m) => ({ move: m, score: 0 }));
  let reached = 0;
  for (let d = 1; d <= P.maxDepth; d++) {
    const iter = [];
    let floor = -Infinity; // moves more than 80 below the best only get a bound (faster)
    for (const s of scored) {
      const sc = -negamax(applyMove(board, s.move, V), -color, V, forced, d - 1, -Infinity, -floor, 1);
      if (sc - 80 > floor) floor = sc - 80;
      if (stopped) break;
      iter.push({ move: s.move, score: sc });
    }
    if (stopped) break;
    iter.sort((a, b) => b.score - a.score);
    scored = iter;
    reached = d;
    if (Math.abs(iter[0].score) > 90000) break; // forced win/loss found
  }
  // difficulty shaping
  let pick;
  if (Math.random() < P.blunder) {
    pick = scored[(Math.random() * scored.length) | 0];
  } else {
    const jittered = scored.map((s) => ({ ...s, j: s.score + (Math.random() * 2 - 1) * P.noise }));
    jittered.sort((a, b) => b.j - a.j);
    pick = jittered[0];
  }
  return { move: pick.move, candidates: scored.slice(0, 6), depth: reached, nodes };
}

export { search };
if (typeof self !== 'undefined') self.onmessage = (e) => {
  const { id, board, color, variant, forced, level } = e.data;
  const V = VARIANTS[variant];
  const res = search(Int8Array.from(board), color, V, forced, level);
  self.postMessage({ id, ...res });
};
