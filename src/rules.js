// Royal Checkers — rules engine (pure, no DOM). Used by the game and the AI worker.
// Board: Int8Array(N*N). 0 empty, 1 red man, 2 red king, -1 black man, -2 black king.
// Red sits at the bottom (high row numbers) and moves toward row 0.

export const VARIANTS = {
  american: {
    id: 'american', name: 'American Checkers (8×8)', N: 8, rows: 3,
    flyingKings: false, menCaptureBack: false, maxCaptureRule: false,
    firstToMove: 1, // with red & white sets, red plays the "black" side and moves first
    manValue: 100, kingValue: 165,
  },
  international: {
    id: 'international', name: 'International Draughts (10×10)', N: 10, rows: 4,
    flyingKings: true, menCaptureBack: true, maxCaptureRule: true,
    firstToMove: 1, // light (red) moves first in international draughts
    manValue: 100, kingValue: 320,
  },
};

const DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

export const isDark = (r, c) => (r + c) % 2 === 1;
export const forward = (color) => (color === 1 ? -1 : 1);
export const kingRow = (color, N) => (color === 1 ? 0 : N - 1);

export function createInitial(V) {
  const { N, rows } = V;
  const b = new Int8Array(N * N);
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    if (!isDark(r, c)) continue;
    if (r < rows) b[r * N + c] = -1;
    else if (r >= N - rows) b[r * N + c] = 1;
  }
  return b;
}

// A move: { path:[from, land1, land2...], caps:[sq per step], capture:bool, complete:bool }
export function generateMoves(b, color, V, forced) {
  const N = V.N;
  const caps = [];
  const simples = [];
  for (let sq = 0; sq < N * N; sq++) {
    const p = b[sq];
    if (!p || Math.sign(p) !== color) continue;
    const king = Math.abs(p) === 2;
    // captures
    b[sq] = 0; // the moving piece leaves its square while it jumps
    captureSearch(b, sq, p, king, color, V, [sq], [], caps);
    b[sq] = p;
    // simple moves
    const r = (sq / N) | 0, c = sq % N;
    for (const [dr, dc] of DIRS) {
      if (!king && dr !== forward(color)) continue;
      let rr = r + dr, cc = c + dc;
      while (rr >= 0 && rr < N && cc >= 0 && cc < N && b[rr * N + cc] === 0) {
        simples.push({ path: [sq, rr * N + cc], caps: [], capture: false, complete: true });
        if (!(king && V.flyingKings)) break;
        rr += dr; cc += dc;
      }
    }
  }
  if (forced && caps.length) {
    let list = caps.filter((m) => m.complete);
    if (V.maxCaptureRule) {
      const max = Math.max(...list.map((m) => m.caps.length));
      list = list.filter((m) => m.caps.length === max);
    }
    return list;
  }
  if (forced) return simples;
  // optional captures: you may stop a jump sequence at any point (every prefix is legal)
  for (const m of caps) m.complete = true;
  return caps.concat(simples);
}

function captureSearch(b, from, p, king, color, V, path, captured, out) {
  const N = V.N;
  const cur = path[path.length - 1];
  const r = (cur / N) | 0, c = cur % N;
  let found = false;
  for (const [dr, dc] of DIRS) {
    if (!king && !V.menCaptureBack && dr !== forward(color)) continue;
    if (king && V.flyingKings) {
      let rr = r + dr, cc = c + dc;
      while (rr >= 0 && rr < N && cc >= 0 && cc < N && b[rr * N + cc] === 0) { rr += dr; cc += dc; }
      if (!(rr >= 0 && rr < N && cc >= 0 && cc < N)) continue;
      const mid = rr * N + cc;
      if (Math.sign(b[mid]) !== -color || captured.includes(mid)) continue;
      let lr = rr + dr, lc = cc + dc;
      while (lr >= 0 && lr < N && lc >= 0 && lc < N && b[lr * N + lc] === 0) {
        const land = lr * N + lc;
        found = true;
        const m = { path: path.concat(land), caps: captured.concat(mid), capture: true, complete: true };
        out.push(m);
        if (captureSearch(b, from, p, king, color, V, m.path, m.caps, out)) m.complete = false;
        lr += dr; lc += dc;
      }
    } else {
      const mr = r + dr, mc = c + dc, lr = r + 2 * dr, lc = c + 2 * dc;
      if (lr < 0 || lr >= N || lc < 0 || lc >= N) continue;
      const mid = mr * N + mc, land = lr * N + lc;
      if (Math.sign(b[mid]) !== -color || captured.includes(mid) || b[land] !== 0) continue;
      found = true;
      const m = { path: path.concat(land), caps: captured.concat(mid), capture: true, complete: true };
      out.push(m);
      // American: a man that reaches the king row ends its turn there.
      const stop = !king && !V.flyingKings && lr === kingRow(color, N);
      if (!stop && captureSearch(b, from, p, king, color, V, m.path, m.caps, out)) m.complete = false;
    }
  }
  return found;
}

export function applyMove(b, m, V) {
  const nb = Int8Array.from(b);
  const from = m.path[0], to = m.path[m.path.length - 1];
  let p = nb[from];
  nb[from] = 0;
  for (const s of m.caps) nb[s] = 0;
  const row = (to / V.N) | 0;
  if (Math.abs(p) === 1 && row === kingRow(Math.sign(p), V.N)) p = 2 * Math.sign(p);
  nb[to] = p;
  return nb;
}

export function promotes(b, m, V) {
  const p = b[m.path[0]];
  const to = m.path[m.path.length - 1];
  return Math.abs(p) === 1 && ((to / V.N) | 0) === kingRow(Math.sign(p), V.N);
}

export function sameMove(a, b) {
  if (a.path.length !== b.path.length) return false;
  for (let i = 0; i < a.path.length; i++) if (a.path[i] !== b.path[i]) return false;
  return true;
}

// Standard square numbering (dark squares counted 1..n from the black side).
export function squareNumber(sq, N) {
  const r = (sq / N) | 0, c = sq % N;
  return r * (N / 2) + ((c / 2) | 0) + 1;
}
export function notation(m, N) {
  const sep = m.capture ? 'x' : '-';
  return m.path.map((s) => squareNumber(s, N)).join(sep);
}

export function countPieces(b) {
  let red = 0, black = 0, rk = 0, bk = 0;
  for (const p of b) {
    if (p > 0) { red++; if (p === 2) rk++; } else if (p < 0) { black++; if (p === -2) bk++; }
  }
  return { red, black, rk, bk };
}

export function boardAscii(b, N) {
  const map = { 0: '.', 1: 'r', 2: 'R', '-1': 'b', '-2': 'B' };
  let s = '';
  for (let r = 0; r < N; r++) {
    let row = '';
    for (let c = 0; c < N; c++) row += isDark(r, c) ? map[b[r * N + c]] : ' ';
    s += row + '\n';
  }
  return s;
}
