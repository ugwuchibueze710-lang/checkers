// Royal Checkers — phone-first, photo-scanned materials, real motion.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { VARIANTS, createInitial, generateMoves, applyMove, promotes, notation, countPieces, boardAscii } from './rules.js';
import { Sound } from './audio.js';

// ------------------------------------------------------------ constants (1 unit = 1 inch)
const SQ = 2.0, PR = 0.74, PH = 0.30, BOARD_T = 0.75, FRAME_W = 1.5;
const IS_PHONE = matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 700;
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);
const mix = (a, b, t) => a + (b - a) * t;
const ease = {
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  out: (t) => 1 - Math.pow(1 - t, 3),
  outBack: (t) => { const c1 = 1.7, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
};

// ------------------------------------------------------------ settings
const store = {
  get(k, d) { try { const v = localStorage.getItem('rc_' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('rc_' + k, JSON.stringify(v)); } catch { /* ignore */ } },
};
const settings = {
  mode: store.get('mode', 'ai'), variant: store.get('variant', 'american'), forced: store.get('forced', '0'),
  human: store.get('human', '1'), autoRotate: store.get('autoRotate', '0'),
  hints: store.get('hints', true), sound: store.get('sound', true),
};

// ------------------------------------------------------------ renderer
const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, IS_PHONE ? 2 : 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x120c08);
const camera = new THREE.PerspectiveCamera(36, innerWidth / innerHeight, 0.5, 300);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.08; controls.enablePan = false;
controls.maxPolarAngle = Math.PI * 0.42; controls.minDistance = 12; controls.maxDistance = 90;
controls.touches = { ONE: null, TWO: THREE.TOUCH.DOLLY_ROTATE }; // one finger = play, two fingers = look around

// lamp over the table: warm, soft, low ambient (lets the wood read as real)
const lamp = new THREE.SpotLight(0xffe2bd, 1700, 0, Math.PI / 3.4, 0.85, 2);
lamp.position.set(2, 30, 7);
lamp.castShadow = true;
lamp.shadow.mapSize.set(IS_PHONE ? 1024 : 2048, IS_PHONE ? 1024 : 2048);
lamp.shadow.bias = -0.0002; lamp.shadow.normalBias = 0.02; lamp.shadow.camera.near = 12; lamp.shadow.camera.far = 50;
scene.add(lamp, lamp.target);
scene.add(new THREE.HemisphereLight(0xfff0dc, 0x2a1a10, 0.35));
const fill = new THREE.DirectionalLight(0xc8d8ff, 0.45); fill.position.set(-20, 14, -10); scene.add(fill);

// ------------------------------------------------------------ assets
const manager = new THREE.LoadingManager();
manager.onProgress = (_u, done, total) => { $('loadbar').style.width = `${Math.round((done / total) * 100)}%`; };
const texLoader = new THREE.TextureLoader(manager);
const maxAniso = renderer.capabilities.getMaxAnisotropy();
function tex(name, srgb, repeat = 1) {
  const t = texLoader.load(`assets/${name}`);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = Math.min(8, maxAniso);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  return t;
}
const T = {};
for (const k of ['light', 'dark', 'frame', 'table']) {
  const rep = k === 'table' ? 5 : 1;
  T[k] = { map: tex(`${k}_diff.jpg`, true, rep), rough: tex(`${k}_rough.jpg`, false, rep), nor: tex(`${k}_nor.jpg`, false, rep) };
}
const pmrem = new THREE.PMREMGenerator(renderer);
new HDRLoader(manager).load('assets/room.hdr', (hdr) => {
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = pmrem.fromEquirectangular(hdr).texture;
  scene.environmentIntensity = 0.9;
  scene.background = hdr;
  scene.backgroundBlurriness = 0.55;
  scene.backgroundIntensity = 0.35;
});

// ------------------------------------------------------------ materials
// satin-varnished wood: low clearcoat (a full gloss coat looks fake)
const woodMat = (k, opts = {}) => new THREE.MeshPhysicalMaterial({
  map: T[k].map, roughnessMap: T[k].rough, normalMap: T[k].nor, normalScale: new THREE.Vector2(0.6, 0.6),
  roughness: 0.85, clearcoat: 0.22, clearcoatRoughness: 0.38, envMapIntensity: 0.45, ...opts,
});
const MAT = {
  light: woodMat('light', { color: 0xfff8f0 }),
  dark: woodMat('dark', { color: 0xa87a62 }),
  frame: woodMat('frame', { color: 0x8a5a44, clearcoat: 0.3 }),
  table: woodMat('table', { color: 0x7a5a48, roughness: 1, roughnessMap: null, clearcoat: 0, envMapIntensity: 0.25, specularIntensity: 0.08 }),
  red: new THREE.MeshPhysicalMaterial({ color: 0x9c0f17, roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.28, sheen: 0.25, sheenColor: new THREE.Color(0xff5544), envMapIntensity: 0.55 }),
  ivory: new THREE.MeshPhysicalMaterial({ color: 0xeee2c8, roughness: 0.34, clearcoat: 0.45, clearcoatRoughness: 0.2, sheen: 0.35, sheenColor: new THREE.Color(0xfff6e6), envMapIntensity: 0.6 }),
  gold: new THREE.MeshPhysicalMaterial({ color: 0xe9b949, metalness: 1, roughness: 0.24, envMapIntensity: 1.4 }),
  ruby: new THREE.MeshPhysicalMaterial({ color: 0xb00c25, roughness: 0.06, clearcoat: 1, ior: 1.77, emissive: 0x2a0006, envMapIntensity: 2 }),
  sapphire: new THREE.MeshPhysicalMaterial({ color: 0x1640b8, roughness: 0.06, clearcoat: 1, ior: 1.77, emissive: 0x020825, envMapIntensity: 2 }),
  pearl: new THREE.MeshPhysicalMaterial({ color: 0xf5efe3, roughness: 0.28, iridescence: 0.7, clearcoat: 1 }),
  velvet: new THREE.MeshPhysicalMaterial({ color: 0x4e0610, roughness: 0.95, sheen: 1, sheenColor: new THREE.Color(0xd8303f), sheenRoughness: 0.45 }),
};

// soft contact shadow under every piece (grounds the pieces like a real photo)
const contactTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 8, 64, 64, 64);
  gr.addColorStop(0, 'rgba(0,0,0,0.85)'); gr.addColorStop(0.45, 'rgba(0,0,0,0.45)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
})();
const contactGeo = new THREE.PlaneGeometry(PR * 2.7, PR * 2.7).rotateX(-Math.PI / 2);

// ------------------------------------------------------------ geometry
function pieceGeometry() {
  const pts = [new THREE.Vector2(0, 0.004), new THREE.Vector2(PR - 0.06, 0), new THREE.Vector2(PR - 0.015, 0.012), new THREE.Vector2(PR, 0.04)];
  const ridges = 9, steps = ridges * 6; // fluted rim like real stacking checkers
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    pts.push(new THREE.Vector2(PR - 0.016 * (0.5 - 0.5 * Math.cos(t * ridges * Math.PI * 2)), 0.05 + t * (PH - 0.1)));
  }
  pts.push(new THREE.Vector2(PR - 0.004, PH - 0.035), new THREE.Vector2(PR - 0.03, PH - 0.006), new THREE.Vector2(PR - 0.07, PH),
    new THREE.Vector2(PR - 0.13, PH - 0.004), new THREE.Vector2(PR - 0.15, PH - 0.03));
  const inner = PR - 0.16;
  for (let i = 0; i <= 40; i++) {
    const x = inner * (1 - i / 40);
    pts.push(new THREE.Vector2(x, PH - 0.032 + (x > 0.12 ? 0.006 * Math.sin((x / inner) * Math.PI * 10) : 0)));
  }
  const g = new THREE.LatheGeometry(pts, IS_PHONE ? 56 : 72);
  g.computeVertexNormals();
  return g;
}
const PIECE_GEO = pieceGeometry();

function crownMesh() {
  const g = new THREE.Group();
  const R = 0.4, H = 0.42, spikes = 5;
  const band = new THREE.CylinderGeometry(R, R * 0.92, H, 100, 14, true);
  const pos = band.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const a = Math.atan2(z, x), tn = (y + H / 2) / H;
    const w = Math.abs(((((a / (Math.PI * 2)) * spikes) % 1) + 1) % 1 - 0.5) * 2;
    const top = 0.42 + 0.58 * Math.pow(1 - w, 1.6);
    pos.setY(i, -H / 2 + tn * top * H);
    const flare = 1 + tn * top * 0.12; pos.setX(i, x * flare); pos.setZ(i, z * flare);
  }
  band.computeVertexNormals();
  const gold2 = MAT.gold.clone(); gold2.side = THREE.DoubleSide;
  g.add(new THREE.Mesh(band, gold2));
  for (let i = 0; i < spikes; i++) {
    const a = ((i + 0.5) / spikes) * Math.PI * 2;
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.055, 18, 12), MAT.pearl);
    p.position.set(Math.cos(a) * R * 1.12, H / 2 + 0.03, Math.sin(a) * R * 1.12); g.add(p);
    const b = (i / spikes) * Math.PI * 2 + Math.PI / spikes;
    const j = new THREE.Mesh(new THREE.OctahedronGeometry(0.06, 1), i % 2 ? MAT.sapphire : MAT.ruby);
    j.scale.set(1, 1.3, 0.6); j.position.set(Math.cos(b) * R, -H / 2 + 0.075, Math.sin(b) * R); j.lookAt(0, j.position.y, 0); g.add(j);
  }
  const r1 = new THREE.Mesh(new THREE.TorusGeometry(R * 0.93, 0.035, 10, 72), MAT.gold); r1.rotation.x = Math.PI / 2; r1.position.y = -H / 2 + 0.02; g.add(r1);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(R * 0.86, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), MAT.velvet);
  cap.scale.y = 0.55; cap.position.y = -H / 2 + 0.08; g.add(cap);
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 18, 12), MAT.gold); orb.position.y = -H / 2 + 0.08 + R * 0.86 * 0.55 + 0.05; g.add(orb);
  const c1 = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.14, 0.03), MAT.gold); c1.position.y = orb.position.y + 0.12; g.add(c1);
  const c2 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, 0.03), MAT.gold); c2.position.y = orb.position.y + 0.14; g.add(c2);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  g.userData.height = H;
  return g;
}

// ------------------------------------------------------------ table + board
const world = new THREE.Group(); scene.add(world);
const markers = new THREE.Group(); scene.add(markers);
let boardGroup = null, boardHalf = 8;

const table = new THREE.Mesh(new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2), MAT.table);
table.position.y = -BOARD_T; table.receiveShadow = true; scene.add(table);

// each square gets its own patch of the scanned texture; grain alternates direction, like a real glued-up board
function squaresGeometry(N, wantDark) {
  const pos = [], uv = [], nrm = [], idx = [];
  let v = 0;
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    if (((r + c) % 2 === 1) !== wantDark) continue;
    const x0 = (c - N / 2) * SQ, z0 = (r - N / 2) * SQ;
    pos.push(x0, 0, z0, x0 + SQ, 0, z0, x0 + SQ, 0, z0 + SQ, x0, 0, z0 + SQ);
    for (let k = 0; k < 4; k++) nrm.push(0, 1, 0);
    const s = 0.22, u0 = Math.random() * (1 - s), v0 = Math.random() * (1 - s);
    const quad = [[u0, v0 + s], [u0 + s, v0 + s], [u0 + s, v0], [u0, v0]];
    const rot = (r * 7 + c * 3) % 2; // rotate grain on alternating squares
    for (let k = 0; k < 4; k++) { const q = quad[(k + rot) % 4]; uv.push(q[0], q[1]); }
    idx.push(v, v + 2, v + 1, v, v + 3, v + 2);
    v += 4;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function buildBoard(V) {
  if (boardGroup) { world.remove(boardGroup); boardGroup.traverse((o) => o.geometry && o.geometry.dispose()); }
  const N = V.N, play = N * SQ;
  boardHalf = play / 2;
  boardGroup = new THREE.Group();
  const frame = new THREE.Mesh(new RoundedBoxGeometry(play + FRAME_W * 2, BOARD_T, play + FRAME_W * 2, 5, 0.22), MAT.frame);
  frame.position.y = -BOARD_T / 2; frame.castShadow = true; frame.receiveShadow = true;
  boardGroup.add(frame);
  for (const [k, dark] of [['light', false], ['dark', true]]) {
    const m = new THREE.Mesh(squaresGeometry(N, dark), MAT[k]);
    m.position.y = 0.003; m.receiveShadow = true; boardGroup.add(m);
  }
  // thin maple inlay strip around the playing field
  const inlay = new THREE.MeshPhysicalMaterial({ map: T.light.map, color: 0xffeacc, roughness: 0.6, clearcoat: 0.3 });
  const w = 0.12, o = boardHalf + 0.28;
  for (const [sx, sz, x, z] of [[play + 0.68, w, 0, o], [play + 0.68, w, 0, -o], [w, play + 0.68, o, 0], [w, play + 0.68, -o, 0]]) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.01, sz), inlay); s.position.set(x, 0.002, z); s.receiveShadow = true; boardGroup.add(s);
  }
  buildProps();
  world.add(boardGroup);
  fitCamera(true);
}


// ------------------------------------------------------------ props: chess clock, neon under-glow, cable + control box
const chrome = new THREE.MeshPhysicalMaterial({ color: 0xe8e8ea, metalness: 1, roughness: 0.16, envMapIntensity: 1.2 });
const brushed = new THREE.MeshPhysicalMaterial({ color: 0xb9bcc0, metalness: 1, roughness: 0.35, envMapIntensity: 1 });
const blackPlastic = new THREE.MeshPhysicalMaterial({ color: 0x141414, roughness: 0.45, clearcoat: 0.3, clearcoatRoughness: 0.4 });
const rubber = new THREE.MeshPhysicalMaterial({ color: 0x0d0d0d, roughness: 0.62, sheen: 0.4, sheenColor: new THREE.Color(0x333333) });
const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false });
const clock = { group: null, plungers: {}, leds: {}, ctx: null, tex: null, down: 0 };
const neon = { tube: null, glow: null, fill: null, color: new THREE.Color(0xff2a40), target: new THREE.Color(0xff2a40), on: store.get('neonOn', true), level: store.get('neonLevel', 0.7), toggle: null, knob: null };
const NEON_COLORS = { 1: new THREE.Color(0xff2440), '-1': new THREE.Color(0x8fd2ff) };
const PROPS_MARGIN = 3.6; // how far the clock / control box reach past the frame

function roundedRectPoints(hx, hz, r, y, seg = 8) {
  const pts = [], corners = [[hx - r, hz - r, 0], [-hx + r, hz - r, Math.PI / 2], [-hx + r, -hz + r, Math.PI], [hx - r, -hz + r, Math.PI * 1.5]];
  for (const [cx, cz, a0] of corners) for (let i = 0; i <= seg; i++) {
    const a = a0 + (i / seg) * (Math.PI / 2);
    pts.push(new THREE.Vector3(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r));
  }
  return pts;
}
function glowTexture(innerFrac) {
  const S = 512, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  const inner = S * innerFrac, off = (S - inner) / 2, rr = inner * 0.04;
  const rect = (x, y, w, h, r) => { g.beginPath(); g.roundRect(x, y, w, h, r); };
  // shadow-blur trick: draw the shape far off-canvas, keep only its soft shadow
  g.shadowColor = 'rgba(255,255,255,1)'; g.shadowOffsetX = 2000;
  for (const [blur, a] of [[90, 0.55], [40, 0.6], [14, 0.8]]) {
    g.shadowBlur = blur; g.globalAlpha = a; g.lineWidth = 10; g.strokeStyle = '#fff';
    rect(off - 2000, off, inner, inner, rr); g.stroke();
  }
  g.globalAlpha = 1; g.shadowColor = 'transparent';
  g.globalCompositeOperation = 'destination-out'; rect(off + 6, off + 6, inner - 12, inner - 12, rr); g.fill(); // nothing glows under the board
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function buildNeon(outer) {
  const y = -BOARD_T + 0.09;
  const curve = new THREE.CatmullRomCurve3(roundedRectPoints(outer + 0.06, outer + 0.06, 0.35, y), true, 'centripetal');
  neon.tubeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: neon.color, emissiveIntensity: 3, roughness: 0.3, toneMapped: false });
  neon.tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 240, 0.07, 10, true), neon.tubeMat);
  boardGroup.add(neon.tube);
  // mounting clips every few inches
  for (let i = 0; i < 28; i++) {
    const p = curve.getPointAt(i / 28);
    const clip = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.22), blackPlastic); clip.position.copy(p); clip.position.y += 0.02; boardGroup.add(clip);
  }
  const size = (outer + 7) * 2;
  neon.glowMat = new THREE.MeshBasicMaterial({ map: glowTexture((outer * 2) / size), color: neon.color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  neon.glow = new THREE.Mesh(new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2), neon.glowMat);
  neon.glow.position.y = -BOARD_T + 0.012; neon.glow.renderOrder = 2;
  boardGroup.add(neon.glow);
  // the glow also lifts the board and pieces a little, tinted by the tube
  if (!neon.fill) { neon.fill = new THREE.HemisphereLight(0xffffff, 0x000000, 0); scene.add(neon.fill); }
  for (const k of ['a', 'b']) { if (neon[k]) scene.remove(neon[k]); }
  neon.a = new THREE.PointLight(neon.color, 0, outer * 3.2, 1.6); neon.a.position.set(-outer - 0.6, -BOARD_T + 0.6, outer * 0.4);
  neon.b = new THREE.PointLight(neon.color, 0, outer * 3.2, 1.6); neon.b.position.set(outer + 0.6, -BOARD_T + 0.6, -outer * 0.4);
  scene.add(neon.a, neon.b);
}

function knurledKnob() {
  const g = new THREE.CylinderGeometry(0.42, 0.46, 0.5, 72, 1);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), r = Math.hypot(x, z);
    if (r < 0.3) continue;
    const a = Math.atan2(z, x), k = 1 + 0.035 * Math.sign(Math.sin(a * 36));
    pos.setX(i, x * k); pos.setZ(i, z * k);
  }
  g.computeVertexNormals();
  const knob = new THREE.Group();
  knob.add(new THREE.Mesh(g, brushed));
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.02, 48), new THREE.MeshPhysicalMaterial({ color: 0x9a9da2, metalness: 1, roughness: 0.25 }));
  cap.position.y = 0.26; knob.add(cap);
  const mark = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, 0.28), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  mark.position.set(0, 0.275, -0.17); knob.add(mark);
  knob.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return knob;
}

function buildControlBox(outer) {
  const box = new THREE.Group();
  const bx = -outer - 1.75, bz = outer * 0.38;
  const shell = new THREE.Mesh(new RoundedBoxGeometry(2.3, 0.9, 2.7, 4, 0.14), blackPlastic);
  shell.position.y = 0.45; shell.castShadow = true; shell.receiveShadow = true; box.add(shell);
  // printed top plate
  const c = document.createElement('canvas'); c.width = 256; c.height = 300; const g = c.getContext('2d');
  g.fillStyle = '#1b1b1d'; g.fillRect(0, 0, 256, 300);
  g.fillStyle = '#cfcfcf'; g.font = '700 22px Inter, sans-serif'; g.textAlign = 'center';
  g.fillText('NEON', 128, 32);
  g.font = '600 15px Inter, sans-serif'; g.fillText('ON', 128, 78); g.fillText('OFF', 128, 150);
  for (let i = 0; i <= 10; i++) { const a = Math.PI * 0.75 + (i / 10) * Math.PI * 1.5; g.fillRect(128 + Math.cos(a) * 62 - 1.5, 232 + Math.sin(a) * 62 - 1.5, 3, 3); }
  g.fillText('DIM', 128, 296);
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 2.34).rotateX(-Math.PI / 2), new THREE.MeshPhysicalMaterial({ map: new THREE.CanvasTexture(c), roughness: 0.5, clearcoat: 0.4 }));
  plate.material.map.colorSpace = THREE.SRGBColorSpace;
  plate.position.y = 0.905; box.add(plate);
  // toggle switch: hex nut + chrome bat lever on a pivot
  const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.12, 6), chrome); nut.position.set(0, 0.96, -0.55); box.add(nut);
  const pivot = new THREE.Group(); pivot.position.set(0, 1.0, -0.55);
  const bat = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 0.62, 20), chrome); bat.position.y = 0.31; bat.castShadow = true;
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 12), chrome); tip.position.y = 0.62;
  pivot.add(bat, tip); box.add(pivot);
  neon.toggle = pivot;
  // dimmer knob
  const knob = knurledKnob(); knob.position.set(0, 1.0, 0.5); box.add(knob); neon.knob = knob;
  // pilot LED
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), new THREE.MeshBasicMaterial({ color: 0x33ff66, toneMapped: false })); led.position.set(0.72, 0.93, -1.0); box.add(led); neon.led = led;
  // hit zones
  const hitT = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.6, 1.35), hitMat); hitT.position.set(0, 0.9, -0.67); hitT.userData.prop = 'toggle';
  const hitK = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.6, 1.35), hitMat); hitK.position.set(0, 0.9, 0.67); hitK.userData.prop = 'knob';
  box.add(hitT, hitK);
  box.position.set(bx, -BOARD_T, bz);
  boardGroup.add(box);
  // cable: from the frame's side, sagging onto the table, into the back of the box
  const from = new THREE.Vector3(-outer, -BOARD_T + 0.35, bz - 3.2);
  const pts = [from, new THREE.Vector3(-outer - 0.35, -BOARD_T + 0.12, bz - 3.0), new THREE.Vector3(-outer - 0.9, -BOARD_T + 0.09, bz - 2.6),
    new THREE.Vector3(bx - 0.6, -BOARD_T + 0.09, bz - 2.4), new THREE.Vector3(bx - 0.15, -BOARD_T + 0.12, bz - 1.75), new THREE.Vector3(bx, -BOARD_T + 0.3, bz - 1.38)];
  const cable = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 80, 0.085, 12), rubber);
  cable.castShadow = true; boardGroup.add(cable);
  for (const [p, dir] of [[from, new THREE.Vector3(-1, 0, 0)], [pts[pts.length - 1], new THREE.Vector3(0, 0, 1)]]) {
    const relief = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.32, 16), rubber);
    relief.position.copy(p); relief.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir); boardGroup.add(relief);
  }
  applyNeon(true);
}

function buildClock(outer) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new RoundedBoxGeometry(2.6, 2.1, 7.0, 5, 0.28), MAT.frame);
  body.position.y = 1.05; body.castShadow = true; body.receiveShadow = true; g.add(body);
  // LCD window
  const c = document.createElement('canvas'); c.width = 256; c.height = 640; clock.ctx = c.getContext('2d');
  clock.tex = new THREE.CanvasTexture(c); clock.tex.colorSpace = THREE.SRGBColorSpace;
  const bezel = new THREE.Mesh(new RoundedBoxGeometry(1.75, 0.06, 3.5, 2, 0.03), blackPlastic); bezel.position.set(0, 2.1, 0); g.add(bezel);
  const lcd = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 3.2).rotateX(-Math.PI / 2), new THREE.MeshPhysicalMaterial({ map: clock.tex, emissiveMap: clock.tex, emissive: 0xffffff, emissiveIntensity: 0.35, roughness: 0.08, clearcoat: 1 }));
  lcd.position.set(0, 2.135, 0); g.add(lcd);
  // a plunger at each player's end: red at +z, white at -z
  for (const color of [1, -1]) {
    const pl = new THREE.Group();
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.66, 0.12, 40), chrome); collar.position.y = 0.06; g.add(collar); collar.position.set(0, 2.1, color * 2.65);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.7, 20), chrome); stem.position.y = 0.2; pl.add(stem);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.58, 0.32, 48), (color === 1 ? MAT.red : MAT.ivory).clone()); cap.position.y = 0.62; cap.castShadow = true; pl.add(cap);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.565, 0.03, 10, 48), chrome); rim.rotation.x = Math.PI / 2; rim.position.y = 0.78; pl.add(rim);
    pl.position.set(0, 2.1, color * 2.65);
    g.add(pl); clock.plungers[color] = pl;
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.09, 14, 10), new THREE.MeshBasicMaterial({ color: 0x222222, toneMapped: false }));
    led.position.set(0.85, 2.13, color * 1.45); g.add(led); clock.leds[color] = led;
    const hit = new THREE.Mesh(new THREE.BoxGeometry(3.2, 3.4, 3.5), hitMat); hit.position.set(0, 1.8, color * 1.8); hit.userData.prop = 'clock'; hit.userData.color = color; g.add(hit);
  }
  g.position.set(outer + 1.75, -BOARD_T, 0);
  boardGroup.add(g);
  clock.group = g;
  setPlungers(true);
  drawClockFace();
}

function buildProps() {
  const outer = boardHalf + FRAME_W;
  buildNeon(outer);
  buildClock(outer);
  buildControlBox(outer);
}

// the plunger of the player who must move stands UP; the other is pressed DOWN (rocker, like a real clock)
function setPlungers(instant) {
  const turn = game && !game.over ? game.turn : 0;
  for (const c of [1, -1]) {
    const pl = clock.plungers[c]; if (!pl) continue;
    const to = 2.1 + (turn === c || !turn ? 0 : -0.28);
    if (instant) pl.position.y = to;
    else { const from = pl.position.y; tween(140, (t) => { pl.position.y = mix(from, to, ease.out(t)); }); }
  }
}
async function pressClock(color) {
  const pl = clock.plungers[color]; if (!pl) return;
  Sound.clockPress(); vibrate(15);
  const y0 = pl.position.y;
  await tween(85, (t) => { pl.position.y = y0 - 0.3 * ease.out(t); });
}
function updateClockLeds() {
  if (!game) return;
  const ready = !!completedMove() && !game.busy;
  for (const c of [1, -1]) {
    const led = clock.leds[c]; if (!led) continue;
    const mine = game.turn === c && !game.over;
    led.material.color.set(!mine ? 0x221a1a : ready ? 0x2bff5a : 0xffb020);
  }
}
function fmtTime(ms) { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
function drawClockFace() {
  const g = clock.ctx; if (!g) return;
  g.fillStyle = '#93a88f'; g.fillRect(0, 0, 256, 640);
  g.fillStyle = 'rgba(0,0,0,0.06)'; for (let y = 0; y < 640; y += 4) g.fillRect(0, y, 256, 1);
  for (const color of [-1, 1]) {
    g.save();
    if (color === -1) { g.translate(128, 160); g.rotate(Math.PI); } else g.translate(128, 480);
    const active = game && game.turn === color && !game.over;
    g.fillStyle = active ? '#141c13' : 'rgba(20,28,19,0.55)';
    g.font = '700 74px "Courier New", monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(fmtTime(game ? game.clock[color] : 0), 0, 0);
    g.font = '700 22px Inter, sans-serif'; g.fillText(color === 1 ? 'RED' : 'WHITE', 0, 70);
    if (active) { g.beginPath(); g.moveTo(-14, -78); g.lineTo(14, -78); g.lineTo(0, -60); g.fill(); }
    g.restore();
  }
  g.fillStyle = 'rgba(20,28,19,0.4)'; g.fillRect(20, 318, 216, 4);
  clock.tex.needsUpdate = true;
}

function applyNeon(instant) {
  if (!neon.tubeMat) return;
  const L = neon.on ? neon.level : 0;
  neon.tubeMat.emissiveIntensity = neon.on ? 0.6 + 3.2 * L : 0.0;
  neon.tubeMat.color.set(neon.on ? 0xffffff : 0x8a8a8a);
  neon.glowMat.opacity = 0.95 * L;
  neon.fill.intensity = 0.55 * L;
  neon.a.intensity = neon.b.intensity = 26 * L;
  if (neon.led) neon.led.material.color.set(neon.on ? 0x33ff66 : 0x1a2a1a);
  if (neon.toggle) {
    const to = neon.on ? -0.5 : 0.5, from = neon.toggle.rotation.x;
    if (instant) neon.toggle.rotation.x = to; else tween(110, (t) => { neon.toggle.rotation.x = mix(from, to, ease.out(t)); });
  }
  if (neon.knob) neon.knob.rotation.y = -(Math.PI * 0.75) - neon.level * Math.PI * 1.5 + Math.PI * 1.5;
}
function updateNeon(dt) {
  if (!neon.tubeMat) return;
  if (game) neon.target.copy(NEON_COLORS[game.turn]);
  neon.color.lerp(neon.target, 1 - Math.pow(0.02, dt)); // smooth fade to the current player's colour
  neon.tubeMat.emissive.copy(neon.color);
  neon.glowMat.color.copy(neon.color);
  neon.fill.color.copy(neon.color); neon.fill.groundColor.copy(neon.color).multiplyScalar(0.3);
  neon.a.color.copy(neon.color); neon.b.color.copy(neon.color);
}
function propAtRay() {
  if (!boardGroup) return null;
  const hits = ray.intersectObject(boardGroup, true);
  for (const h of hits) if (h.object.userData.prop) return h.object.userData;
  return null;
}

// ------------------------------------------------------------ tweens
const tweens = new Set();
const tween = (ms, fn) => new Promise((resolve) => tweens.add({ start: performance.now(), ms, fn, resolve }));
function runTweens(now) {
  for (const tw of tweens) { const t = Math.min(1, (now - tw.start) / tw.ms); tw.fn(t); if (t >= 1) { tweens.delete(tw); tw.resolve(); } }
}

// ------------------------------------------------------------ pieces
const pieces = new Map();
const loose = new Set(); // anything with a contact shadow
function sqPos(sq, N, y = 0) {
  const r = (sq / N) | 0, c = sq % N;
  return new THREE.Vector3((c - (N - 1) / 2) * SQ, y, (r - (N - 1) / 2) * SQ);
}
function makePieceMesh(color) {
  const m = new THREE.Mesh(PIECE_GEO, color === 1 ? MAT.red : MAT.ivory);
  m.castShadow = true; m.receiveShadow = true; m.rotation.y = Math.random() * Math.PI * 2;
  return m;
}
function addContact(g) {
  const s = new THREE.Mesh(contactGeo, new THREE.MeshBasicMaterial({ map: contactTex, transparent: true, depthWrite: false, opacity: 0.6 }));
  s.renderOrder = 1; scene.add(s); g.userData.contact = s; loose.add(g);
}
function removeObj(g) { world.remove(g); if (g.userData.contact) scene.remove(g.userData.contact); loose.delete(g); }
function makePiece(id, color) {
  const g = new THREE.Group();
  g.add(makePieceMesh(color));
  g.userData = { id, color, king: false };
  g.traverse((o) => { o.userData.pieceId = id; });
  world.add(g); addContact(g); pieces.set(id, g);
  return g;
}
const captured = { 1: [], '-1': [] }; // pieces taken BY that colour
function clearPieces() {
  for (const g of [...loose]) removeObj(g);
  pieces.clear(); captured[1] = []; captured[-1] = [];
}
// captured men are stacked on the table at the capturer's end, like real play
function capturedSlot(capturer, n) {
  const col = n % 6, lvl = Math.floor(n / 6);
  const z = capturer * (boardHalf + FRAME_W + 1.2);
  return new THREE.Vector3((col - 2.5) * 1.75 * capturer, -BOARD_T + lvl * PH, z);
}
function updateContacts() {
  for (const g of loose) {
    const s = g.userData.contact; if (!s) continue;
    const onBoard = Math.abs(g.position.x) < boardHalf + FRAME_W && Math.abs(g.position.z) < boardHalf + FRAME_W;
    const floorY = onBoard ? 0 : -BOARD_T;
    const h = Math.max(0, g.position.y - floorY);
    s.position.set(g.position.x + h * 0.08, floorY + 0.006, g.position.z + h * 0.12);
    const k = 1 + h * 0.35; s.scale.set(k, 1, k);
    s.material.opacity = 0.62 / (1 + h * 1.4);
    s.visible = g.visible;
  }
}

// ------------------------------------------------------------ motion
async function glide(g, to, opts = {}) {
  const from = g.position.clone(), dist = from.distanceTo(to);
  const h = opts.height ?? (0.8 + dist * 0.07), ms = opts.ms ?? (340 + dist * 26);
  const dir = new THREE.Vector3().subVectors(to, from).setY(0).normalize();
  const axis = new THREE.Vector3(dir.z, 0, -dir.x);
  const baseQ = g.quaternion.clone(), tq = new THREE.Quaternion();
  let mid = false;
  Sound.lift();
  await tween(ms, (t) => {
    const e = ease.inOut(t);
    g.position.lerpVectors(from, to, e);
    g.position.y = mix(from.y, to.y, e) + Math.sin(Math.PI * t) * h;
    tq.setFromAxisAngle(axis, Math.sin(Math.PI * t) * 0.2 * (1 - t * 0.6));
    g.quaternion.copy(baseQ).premultiply(tq);
    if (opts.onMid && t > 0.5 && !mid) { mid = true; opts.onMid(); }
  });
  Sound.place(0.6 + Math.random() * 0.3);
  const wob = new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1)).normalize();
  await tween(240, (t) => {
    const d = Math.exp(-t * 6);
    g.position.y = to.y + Math.abs(Math.sin(t * Math.PI * 3)) * 0.07 * d;
    tq.setFromAxisAngle(wob, Math.sin(t * Math.PI * 5) * 0.045 * d);
    g.quaternion.copy(baseQ).premultiply(tq);
  });
  g.quaternion.copy(baseQ); g.position.copy(to);
}
async function knockOff(g, capturer) {
  const n = captured[capturer].length;
  captured[capturer].push(g);
  const to = capturedSlot(capturer, n), from = g.position.clone();
  const spin = new THREE.Vector3(rand(-1, 1), rand(-0.3, 0.3), rand(-1, 1)).normalize();
  const spins = rand(1.5, 2.5) * Math.PI * 2, q0 = g.quaternion.clone(), sq = new THREE.Quaternion();
  Sound.knock();
  await tween(780, (t) => {
    const e = ease.inOut(t);
    g.position.lerpVectors(from, to, e);
    g.position.y = mix(from.y, to.y, e) + Math.sin(Math.PI * t) * 3.8;
    sq.setFromAxisAngle(spin, spins * ease.out(t)); g.quaternion.copy(q0).multiply(sq);
  });
  const qEnd = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.random() * 6.28, 0)), qS = g.quaternion.clone();
  Sound.place(0.45);
  await tween(400, (t) => {
    const d = Math.exp(-t * 5);
    g.position.y = to.y + Math.abs(Math.sin(t * Math.PI * 3.5)) * 0.3 * d;
    g.quaternion.slerpQuaternions(qS, qEnd, ease.out(Math.min(1, t * 1.6)));
  });
  g.position.copy(to); g.quaternion.copy(qEnd);
}

// ------------------------------------------------------------ crowning
const sparkles = [];
function burst(pos) {
  const n = 60, geo = new THREE.BufferGeometry(), p = new Float32Array(n * 3), v = [];
  for (let i = 0; i < n; i++) {
    p.set([pos.x, pos.y, pos.z], i * 3);
    const a = Math.random() * Math.PI * 2, s = rand(1.2, 4);
    v.push(new THREE.Vector3(Math.cos(a) * s, rand(2, 6), Math.sin(a) * s));
  }
  geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffe08a, size: 0.12, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  const light = new THREE.PointLight(0xffd27a, 40, 10, 2); light.position.copy(pos).add(new THREE.Vector3(0, 1, 0));
  scene.add(pts, light);
  sparkles.push({ pts, v, t0: performance.now(), light });
}
function updateSparkles(now, dt) {
  for (let i = sparkles.length - 1; i >= 0; i--) {
    const s = sparkles[i], age = (now - s.t0) / 1000, a = s.pts.geometry.attributes.position;
    for (let k = 0; k < s.v.length; k++) {
      s.v[k].y -= 9.8 * dt;
      a.setXYZ(k, a.getX(k) + s.v[k].x * dt, Math.max(0.02, a.getY(k) + s.v[k].y * dt), a.getZ(k) + s.v[k].z * dt);
    }
    a.needsUpdate = true;
    s.pts.material.opacity = Math.max(0, 1 - age / 1.3);
    s.light.intensity = Math.max(0, 40 * (1 - age / 0.7));
    if (age > 1.4) { scene.remove(s.pts, s.light); s.pts.geometry.dispose(); sparkles.splice(i, 1); }
  }
}
async function crownPiece(g) {
  const color = g.userData.color, base = g.position.clone();
  // the opponent "kings" you with one of your own captured men, as in real play
  const pile = captured[-color];
  const idx = pile.findIndex((m) => m.userData.color === color && !m.userData.king);
  let topper;
  if (idx >= 0) { topper = pile.splice(idx, 1)[0]; pieces.delete(topper.userData.id); }
  else {
    topper = new THREE.Group(); topper.add(makePieceMesh(color));
    topper.position.set(boardHalf + FRAME_W + 2, -BOARD_T, color * boardHalf * 0.6);
    world.add(topper); addContact(topper);
  }
  await glide(topper, base.clone().setY(base.y + PH), { height: 3, ms: 800 });
  removeObj(topper);
  const mesh = topper.children[0]; topper.remove(mesh);
  mesh.position.set(0, PH, 0); mesh.traverse((o) => { o.userData.pieceId = g.userData.id; });
  g.add(mesh);
  const crown = crownMesh(), cy = PH * 2 + crown.userData.height / 2 - 0.02;
  crown.position.set(0, cy + 3.2, 0); crown.scale.setScalar(0.01);
  crown.traverse((o) => { o.userData.pieceId = g.userData.id; });
  g.add(crown);
  Sound.crown();
  await tween(1050, (t) => {
    const e = ease.out(t);
    crown.position.y = cy + 3.2 * (1 - e); crown.rotation.y = (1 - e) * Math.PI * 4;
    crown.scale.setScalar(Math.max(0.01, ease.outBack(Math.min(1, t * 1.4))));
  });
  burst(g.position.clone().add(new THREE.Vector3(0, PH * 2 + 0.3, 0)));
  Sound.place(0.9);
  await tween(240, (t) => { crown.position.y = cy + Math.abs(Math.sin(t * Math.PI * 2)) * 0.05 * (1 - t); });
  crown.position.y = cy;
  g.userData.king = true;
  toast('KING!');
}

// ------------------------------------------------------------ move markers
const markerGeo = new THREE.CircleGeometry(0.34, 40).rotateX(-Math.PI / 2);
const ringGeo = new THREE.RingGeometry(0.8, 0.9, 56).rotateX(-Math.PI / 2);
const markerMat = new THREE.MeshBasicMaterial({ color: 0xffe3a0, transparent: true, opacity: 0.55, depthWrite: false });
const capMat = new THREE.MeshBasicMaterial({ color: 0xff7050, transparent: true, opacity: 0.6, depthWrite: false });
const selMat = new THREE.MeshBasicMaterial({ color: 0xfff0c8, transparent: true, opacity: 0.85, depthWrite: false });
function clearMarkers() { while (markers.children.length) markers.remove(markers.children[0]); }
function showMarkers(targets, selSq) {
  clearMarkers();
  const N = game.V.N;
  if (selSq != null) { const s = new THREE.Mesh(ringGeo, selMat); s.position.copy(sqPos(selSq, N, 0.012)); markers.add(s); }
  if (!settings.hints) return;
  for (const { sq, capture } of targets) { const m = new THREE.Mesh(markerGeo, capture ? capMat : markerMat); m.position.copy(sqPos(sq, N, 0.012)); markers.add(m); }
}

// ------------------------------------------------------------ game state
let game = null, aiWorker = null, aiReqId = 0, groqEnabled = false;
const name = (c) => (c === 1 ? 'Red' : 'White');

function newGame() {
  const V = VARIANTS[settings.variant];
  buildBoard(V);
  clearPieces();
  const board = createInitial(V), ids = new Int32Array(V.N * V.N).fill(-1);
  let nid = 0;
  for (let sq = 0; sq < board.length; sq++) if (board[sq]) {
    ids[sq] = nid; makePiece(nid, Math.sign(board[sq])).position.copy(sqPos(sq, V.N)); nid++;
  }
  game = {
    V, board, ids, turn: V.firstToMove, forced: settings.forced === '1', mode: settings.mode,
    human: settings.mode === 'pvp' ? 0 : Number(settings.human), level: currentLevel(),
    steps: [], stepCaps: [], legal: [], selected: null, busy: false, over: false,
    quietPlies: 0, clock: { 1: 0, '-1': 0 }, history: [],
  };
  camSide = game.mode === 'ai' ? game.human : 1;
  fitCamera(true); setPlungers(true); drawClockFace();
  startTurn();
}
const isHumanTurn = () => game && !game.over && (game.mode === 'pvp' || game.turn === game.human);

function startTurn() {
  const g = game;
  g.legal = generateMoves(g.board, g.turn, g.V, g.forced);
  g.steps = []; g.stepCaps = []; g.selected = null;
  clearMarkers(); updateHud();
  if (!g.legal.length) return endGame(-g.turn, `${name(g.turn)} has no moves left.`);
  if (g.quietPlies >= 80) return endGame(0, '40 moves each without a capture or a man moving.');
  if (g.mode === 'pvp' && settings.autoRotate === '1' && camSide !== g.turn) { camSide = g.turn; fitCamera(false); updateHud(); }
  if (!isHumanTurn()) aiTurn();
}
function targetsFrom(prefix) {
  const out = new Map();
  for (const m of game.legal) if (m.path.length > prefix.length && prefix.every((s, i) => m.path[i] === s)) out.set(m.path[prefix.length], m.capture);
  return [...out].map(([sq, capture]) => ({ sq, capture }));
}
function completedMove() {
  const s = game.steps;
  return s.length < 2 ? null : game.legal.find((m) => m.path.length === s.length && s.every((q, i) => m.path[i] === q)) || null;
}
let lifted = null;
function lift(sq) {
  if (lifted) { const g0 = lifted, y0 = g0.position.y; tween(150, (t) => { g0.position.y = y0 * (1 - ease.out(t)); }); lifted = null; }
  if (sq == null) return;
  const g = pieces.get(game.ids[sq]); if (!g) return;
  lifted = g; tween(170, (t) => { g.position.y = 0.32 * ease.out(t); });
}
function selectSquare(sq) {
  const g = game;
  if (g.steps.length) return false;
  if (!g.legal.some((m) => m.path[0] === sq)) {
    if (Math.sign(g.board[sq]) === g.turn && g.forced && g.legal.some((m) => m.capture)) toast('You must capture', 1100);
    return false;
  }
  g.selected = sq; lift(sq);
  showMarkers(targetsFrom([sq]), sq);
  Sound.tick(); vibrate(8);
  return true;
}
async function humanStep(dest) {
  const g = game;
  const prefix = g.steps.length ? g.steps : [g.selected];
  const tgt = targetsFrom(prefix).find((t) => t.sq === dest);
  if (!tgt) return false;
  if (!g.steps.length) g.steps = [g.selected];
  lifted = null; g.busy = true; clearMarkers();
  await performStep(g.steps[g.steps.length - 1], dest, tgt.capture);
  g.steps.push(dest); g.busy = false;
  const more = targetsFrom(g.steps);
  if (more.length) showMarkers(more, dest); else clearMarkers();
  updateHud();
  if (completedMove() && !more.length) vibrate([10, 40, 10]);
  return true;
}
async function performStep(from, to, capture) {
  const g = game, N = g.V.N, id = g.ids[from];
  let capSq = null;
  if (capture) {
    const fr = (from / N) | 0, fc = from % N, tr = (to / N) | 0, tc = to % N, dr = Math.sign(tr - fr), dc = Math.sign(tc - fc);
    for (let r = fr + dr, c = fc + dc; r !== tr; r += dr, c += dc) {
      const s = r * N + c;
      if (g.board[s] && Math.sign(g.board[s]) === -g.turn && !g.stepCaps.includes(s)) { capSq = s; break; }
    }
  }
  g.ids[to] = id; g.ids[from] = -1;
  if (capSq != null) g.stepCaps.push(capSq);
  const capMesh = capSq != null ? pieces.get(g.ids[capSq]) : null;
  await glide(pieces.get(id), sqPos(to, N), { height: capture ? 1.5 : undefined, onMid: capMesh ? () => knockOff(capMesh, g.turn) : undefined });
}
async function undoTurn() {
  const g = game;
  if (!g || g.busy || !isHumanTurn()) return;
  if (!g.steps.length) { if (g.selected != null) { lift(null); g.selected = null; clearMarkers(); } return; }
  g.busy = true; clearMarkers();
  const N = g.V.N, from = g.steps[0], cur = g.steps[g.steps.length - 1], id = g.ids[cur];
  g.ids[cur] = -1; g.ids[from] = id;
  const back = [glide(pieces.get(id), sqPos(from, N), { ms: 480 })];
  for (const s of g.stepCaps) {
    const m = pieces.get(g.ids[s]), pile = captured[g.turn], i = pile.indexOf(m);
    if (i >= 0) pile.splice(i, 1);
    if (m) back.push(glide(m, sqPos(s, N), { height: 3, ms: 650 }));
  }
  await Promise.all(back);
  g.steps = []; g.stepCaps = []; g.selected = null; g.busy = false;
  updateHud(); Sound.tick();
}
async function commitTurn(byColor) {
  const g = game;
  if (!g || g.over || g.busy) return;
  if (byColor !== g.turn) { toast(`Wait — it's ${name(g.turn)}'s turn`, 900); return; }
  const m = completedMove();
  if (!m) { toast('Move a piece first', 900); return; }
  g.busy = true; clearMarkers();
  await pressClock(g.turn);
  const crowned = promotes(g.board, m, g.V), wasMan = Math.abs(g.board[m.path[0]]) === 1;
  g.history.push(notation(m, g.V.N));
  g.board = applyMove(g.board, m, g.V);
  for (const s of m.caps) g.ids[s] = -1;
  g.quietPlies = m.capture || wasMan ? 0 : g.quietPlies + 1;
  g.steps = [];
  if (crowned) await crownPiece(pieces.get(g.ids[m.path[m.path.length - 1]]));
  g.turn = -g.turn; g.busy = false;
  setPlungers(false); drawClockFace();
  startTurn();
}

// ------------------------------------------------------------ AI
function askEngine(board, color) {
  return new Promise((resolve) => {
    if (!aiWorker) aiWorker = new Worker(new URL('./ai-worker.js', import.meta.url), { type: 'module' });
    const id = ++aiReqId;
    const on = (e) => { if (e.data.id === id) { aiWorker.removeEventListener('message', on); resolve(e.data); } };
    aiWorker.addEventListener('message', on);
    aiWorker.postMessage({ id, board: Array.from(board), color, variant: game.V.id, forced: game.forced, level: game.level });
  });
}
async function askGroq(res) {
  const cands = res.candidates.filter((c) => c.score >= res.candidates[0].score - 40).slice(0, 4);
  if (!groqEnabled || game.level < 4 || cands.length < 2) return null;
  try {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 7000);
    const r = await fetch('/api/ai-move', {
      method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        variant: game.V.name, color: name(game.turn), level: game.level, board: boardAscii(game.board, game.V.N),
        history: game.history.slice(-12), candidates: cands.map((c) => ({ move: notation(c.move, game.V.N), engineScore: Math.round(c.score) })),
      }),
    });
    clearTimeout(timer);
    if (!r.ok) return null;
    const j = await r.json(), i = Number(j.choice);
    return { move: Number.isInteger(i) && cands[i] ? cands[i].move : null, taunt: j.taunt };
  } catch { return null; }
}
async function aiTurn() {
  const g = game;
  g.busy = true; updateHud();
  const t0 = performance.now();
  const res = await askEngine(g.board, g.turn);
  if (game !== g || g.over) return;
  let move = res.move;
  const groq = await askGroq(res);
  if (game !== g) return;
  if (groq?.move) move = groq.move;
  if (groq?.taunt) say(groq.taunt);
  await sleep(Math.max(0, 600 - (performance.now() - t0)) + rand(100, 400));
  if (game !== g) return;
  g.steps = [move.path[0]];
  for (let i = 1; i < move.path.length; i++) {
    await performStep(move.path[i - 1], move.path[i], move.capture);
    g.steps.push(move.path[i]);
    if (game !== g) return;
    await sleep(110);
  }
  updateHud();
  await sleep(rand(450, 800)); // the AI visibly presses its own END TURN
  g.busy = false;
  await commitTurn(g.turn);
}
let bubbleTimer = 0;
function say(text) {
  $('aiText').textContent = String(text).slice(0, 160);
  $('aiBubble').classList.remove('hidden');
  clearTimeout(bubbleTimer); bubbleTimer = setTimeout(() => $('aiBubble').classList.add('hidden'), 5000);
}

// ------------------------------------------------------------ levels / end
const currentLevel = () => Math.max(1, Number(store.get(`level_${settings.variant}`, 1)));
const maxLevel = () => Math.max(1, Number(store.get(`maxLevel_${settings.variant}`, 1)));
function endGame(winner, why) {
  const g = game; g.over = true; clearMarkers(); updateHud();
  let title, sub = why, crest = '♛';
  $('btnNext').classList.add('hidden');
  if (winner === 0) { title = 'Draw'; crest = '½'; }
  else if (g.mode === 'pvp') title = `${name(winner)} Wins`;
  else if (winner === g.human) {
    title = 'Victory'; const next = g.level + 1;
    store.set(`level_${settings.variant}`, next); store.set(`maxLevel_${settings.variant}`, Math.max(maxLevel(), next));
    sub += ` Level ${next} unlocked.`; $('btnNext').classList.remove('hidden'); Sound.crown();
  } else { title = 'Defeat'; crest = '✝'; }
  $('overTitle').textContent = title; $('overSub').textContent = sub; $('overCrest').textContent = crest;
  setTimeout(() => $('over').classList.remove('hidden'), 900);
}

// ------------------------------------------------------------ camera (fits the board to any phone)
let camSide = 1, viewMode = 0;
const camGoal = { pos: new THREE.Vector3(), active: false };
function fitCamera(instant) {
  const N = game ? game.V.N : VARIANTS[settings.variant].N;
  const half = (N * SQ) / 2 + FRAME_W + 0.4, halfW = half + PROPS_MARGIN;
  const vfov = THREE.MathUtils.degToRad(camera.fov), aspect = innerWidth / innerHeight;
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
  const barFrac = Math.min(0.45, (2 * 80 + 60) / innerHeight); // room for the two player bars
  const dW = halfW / Math.tan(hfov / 2), dH = half / (Math.tan(vfov / 2) * (1 - barFrac));
  const d = Math.max(dW, dH) + half * 0.08;
  const tilt = viewMode === 1 ? 0.001 : viewMode === 2 ? 0.75 : (aspect < 1 ? 0.38 : 0.5);
  const p = new THREE.Vector3(0, d * Math.cos(tilt), camSide * d * Math.sin(tilt));
  controls.target.set(0, 0, camSide * 0.4);
  if (instant) { camera.position.copy(p); controls.update(); } else { camGoal.pos.copy(p); camGoal.active = true; }
}

// ------------------------------------------------------------ input
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
let drag = null;
function pick(ev) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
}
function squareAtRay() {
  const p = new THREE.Vector3();
  if (!ray.ray.intersectPlane(plane, p)) return null;
  const N = game.V.N, c = Math.round(p.x / SQ + (N - 1) / 2), r = Math.round(p.z / SQ + (N - 1) / 2);
  return r < 0 || r >= N || c < 0 || c >= N ? null : { sq: r * N + c, point: p };
}
function pieceAtRay() {
  const hits = ray.intersectObjects([...pieces.values()], true);
  if (!hits.length) return null;
  const sq = game.ids.indexOf(hits[0].object.userData.pieceId);
  return sq >= 0 ? sq : null;
}
canvas.addEventListener('pointerdown', (ev) => {
  if (!game) return;
  pick(ev);
  const prop = propAtRay();
  if (prop?.prop === 'toggle') { neon.on = !neon.on; store.set('neonOn', neon.on); applyNeon(); Sound.tick(); vibrate(10); return; }
  if (prop?.prop === 'knob') { drag = { knob: true, y: ev.clientY, x: ev.clientX, level: neon.level, moved: false }; canvas.setPointerCapture(ev.pointerId); return; }
  if (prop?.prop === 'clock') {
    if (game.over) return;
    if (game.mode === 'ai' && prop.color !== game.human) { toast('That is the computer’s clock', 900); return; }
    if (prop.color !== game.turn) { toast(`Wait — it's ${name(game.turn)}'s turn`, 900); return; }
    commitTurn(prop.color); return;
  }
  if (game.over || !isHumanTurn() || game.busy) return;
  const psq = pieceAtRay(), sq = psq ?? squareAtRay()?.sq;
  if (sq == null) return;
  const prefix = game.steps.length ? game.steps : game.selected != null ? [game.selected] : null;
  if (prefix && targetsFrom(prefix).some((t) => t.sq === sq)) { drag = { dest: sq }; return; }
  if (!game.steps.length && psq != null && Math.sign(game.board[psq]) === game.turn) {
    if (selectSquare(psq)) { drag = { from: psq, x: ev.clientX, y: ev.clientY, moved: false }; canvas.setPointerCapture(ev.pointerId); }
  } else if (game.steps.length && psq === game.steps[game.steps.length - 1]) {
    drag = { from: psq, x: ev.clientX, y: ev.clientY, moved: false, cont: true }; canvas.setPointerCapture(ev.pointerId);
  } else if (game.selected != null && !game.steps.length) { lift(null); game.selected = null; clearMarkers(); }
});
canvas.addEventListener('pointermove', (ev) => {
  if (drag?.knob) {
    const d = (drag.y - ev.clientY + (ev.clientX - drag.x)) / 160;
    if (Math.abs(d) > 0.03) drag.moved = true;
    neon.level = Math.min(1, Math.max(0.08, drag.level + d)); if (!neon.on && drag.moved) neon.on = true;
    applyNeon(true); return;
  }
  if (!drag || drag.from == null || game.busy) return;
  pick(ev);
  if (Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y) > 8) drag.moved = true;
  if (!drag.moved) return;
  const s = squareAtRay(), g = pieces.get(game.ids[drag.from]);
  if (s && g) { g.position.x = s.point.x; g.position.z = s.point.z - 0.5 * camSide; g.position.y = 0.9; } // lifted just above the finger
});
canvas.addEventListener('pointerup', async (ev) => {
  const d = drag; drag = null;
  if (!d || !game) return;
  if (d.knob) {
    if (!d.moved) { neon.level = neon.level >= 0.99 ? 0.25 : Math.min(1, Math.round((neon.level + 0.25) * 4) / 4); neon.on = true; applyNeon(true); Sound.tick(); }
    store.set('neonLevel', neon.level); store.set('neonOn', neon.on); return;
  }
  pick(ev);
  if (d.dest != null) { await humanStep(d.dest); return; }
  if (d.from != null && d.moved) {
    const s = squareAtRay(), prefix = game.steps.length ? game.steps : [game.selected];
    if (s && targetsFrom(prefix).some((t) => t.sq === s.sq)) await humanStep(s.sq);
    else { const g = pieces.get(game.ids[d.from]); if (g) await glide(g, sqPos(d.from, game.V.N).setY(d.cont ? 0 : 0.32), { ms: 280, height: 0.35 }); }
  }
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('keydown', (e) => {
  if (!game || !$('menu').classList.contains('hidden')) return;
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (isHumanTurn()) commitTurn(game.turn); }
  if (e.key === 'Backspace') undoTurn();
  if (e.key === 'Escape') openMenu();
});
function vibrate(p) { try { navigator.vibrate?.(p); } catch { /* not supported */ } }

// ------------------------------------------------------------ player bars (END TURN at each player's end)
const barFor = (color) => (color === camSide ? $('barBottom') : $('barTop'));
function updateHud() {
  if (!game) return;
  const g = game, cnt = countPieces(g.board), ready = !!completedMove() && isHumanTurn() && !g.busy;
  $('barTop').classList.toggle('flip', g.mode === 'pvp' && settings.autoRotate !== '1');
  for (const color of [1, -1]) {
    const bar = barFor(color), mine = g.turn === color && !g.over;
    const isAI = g.mode === 'ai' && color !== g.human;
    bar.dataset.color = color === 1 ? 'red' : 'ivory';
    bar.querySelector('.pname').textContent = isAI ? `Computer · Lv ${g.level}` : g.mode === 'ai' ? 'You' : `${name(color)} player`;
    const left = color === 1 ? cnt.red : cnt.black, kings = color === 1 ? cnt.rk : cnt.bk;
    bar.querySelector('.pcount').textContent = `${left} pieces${kings ? ` · ${kings}♛` : ''}`;
    const light = bar.querySelector('.plight em');
    bar.classList.toggle('active', mine);
    bar.classList.toggle('ready', mine && ready);
    if (g.over) light.textContent = 'GAME OVER';
    else if (!mine) light.textContent = 'WAIT';
    else if (isAI) light.textContent = g.steps.length ? 'MOVING…' : 'THINKING…';
    else if (ready) light.textContent = 'TAP YOUR CLOCK';
    else light.textContent = g.steps.length ? 'JUMP / END' : 'YOUR TURN';
  }
  $('btnHint').classList.toggle('on', settings.hints);
  $('btnSound').classList.toggle('on', settings.sound);
  updateClockLeds();
}
function drawClocks() {
  if (!game) return;
  for (const c of [1, -1]) {
    const s = Math.floor(game.clock[c] / 1000);
    barFor(c).querySelector('.ptime').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  drawClockFace();
}
let toastTimer = 0;
function toast(txt, ms = 1300) {
  const t = $('toast'); t.textContent = txt; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// ------------------------------------------------------------ menu
function syncMenu() {
  document.querySelectorAll('.seg').forEach((seg) => seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', String(settings[seg.dataset.key]) === b.dataset.v)));
  $('aiOpts').classList.toggle('hidden', settings.mode !== 'ai');
  $('pvpOpts').classList.toggle('hidden', settings.mode !== 'pvp');
  $('lvlInput').value = currentLevel();
  $('lvlMax').textContent = `(unlocked: ${maxLevel()} · no cap)`;
  $('rulesNote').textContent = settings.variant === 'american'
    ? 'Men move 1 square diagonally forward. Kings move 1 square any diagonal way. Red moves first.'
    : 'Men capture forward and backward. Kings fly any distance on a diagonal. Red moves first.';
}
document.querySelectorAll('.seg').forEach((seg) => seg.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  settings[seg.dataset.key] = b.dataset.v; store.set(seg.dataset.key, b.dataset.v); syncMenu();
}));
function setLevel(v) { const n = Math.max(1, Math.min(maxLevel(), Number(v) || 1)); store.set(`level_${settings.variant}`, n); $('lvlInput').value = n; }
$('lvlDown').onclick = () => setLevel(currentLevel() - 1);
$('lvlUp').onclick = () => { if (currentLevel() >= maxLevel()) toast(`Beat level ${maxLevel()} to unlock more`, 1200); setLevel(currentLevel() + 1); };
$('lvlInput').onchange = (e) => setLevel(e.target.value);
function openMenu() { syncMenu(); $('btnResume').classList.toggle('hidden', !game || game.over); $('menu').classList.remove('hidden'); }
$('btnMenu').onclick = openMenu;
$('btnResume').onclick = () => $('menu').classList.add('hidden');
$('btnStart').onclick = () => {
  Sound.unlock(); $('menu').classList.add('hidden');
  for (const id of ['barTop', 'barBottom', 'tools']) $(id).classList.remove('hidden');
  newGame();
};
$('btnOverMenu').onclick = () => { $('over').classList.add('hidden'); openMenu(); };
$('btnRetry').onclick = () => { $('over').classList.add('hidden'); newGame(); };
$('btnNext').onclick = () => { $('over').classList.add('hidden'); newGame(); };
$('btnUndo').onclick = undoTurn;
$('btnHint').onclick = () => {
  settings.hints = !settings.hints; store.set('hints', settings.hints); updateHud();
  if (game && isHumanTurn()) { const p = game.steps.length ? game.steps : game.selected != null ? [game.selected] : null; if (p) showMarkers(targetsFrom(p), p[p.length - 1]); }
};
$('btnView').onclick = () => { viewMode = (viewMode + 1) % 3; fitCamera(false); };
$('btnSound').onclick = () => { settings.sound = !settings.sound; store.set('sound', settings.sound); Sound.enabled = settings.sound; updateHud(); };
Sound.enabled = settings.sound;

// fullscreen dot: tap = fullscreen, tap again = back to browser
const fsBtn = $('fsDot');
const fsOK = !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
fsBtn.addEventListener('click', () => {
  const el = document.documentElement, inFs = document.fullscreenElement || document.webkitFullscreenElement;
  if (!fsOK) { toast('Add to Home Screen for full screen', 1600); return; }
  if (inFs) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  else {
    const p = (el.requestFullscreen || el.webkitRequestFullscreen).call(el, { navigationUI: 'hide' });
    p?.then?.(() => screen.orientation?.lock?.('portrait').catch(() => {}));
  }
});
const fsChange = () => { fsBtn.classList.toggle('on', !!(document.fullscreenElement || document.webkitFullscreenElement)); setTimeout(onResize, 120); };
document.addEventListener('fullscreenchange', fsChange);
document.addEventListener('webkitfullscreenchange', fsChange);

fetch('/api/ai-move').then((r) => (r.ok ? r.json() : null)).then((j) => {
  groqEnabled = !!j?.enabled;
  $('groqNote').textContent = groqEnabled ? `Groq AI connected (${j.model}). From level 4 it picks strategy and talks trash.` : 'Groq not connected: the built-in engine plays alone.';
}).catch(() => { $('groqNote').textContent = 'Groq not connected: the built-in engine plays alone.'; });

// ------------------------------------------------------------ loop
function onResize() {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); fitCamera(true);
}
addEventListener('resize', onResize);
let last = performance.now(), clockAcc = 0;
renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  runTweens(now); updateSparkles(now, dt); updateContacts(); updateNeon(dt);
  if (camGoal.active) { camera.position.lerp(camGoal.pos, 1 - Math.pow(0.002, dt)); if (camera.position.distanceTo(camGoal.pos) < 0.05) camGoal.active = false; }
  const pulse = 0.5 + Math.sin(now / 240) * 0.18; markerMat.opacity = pulse; capMat.opacity = pulse + 0.1;
  if (game && !game.over && !document.hidden) { game.clock[game.turn] += dt * 1000; clockAcc += dt; if (clockAcc > 0.5) { clockAcc = 0; drawClocks(); } }
  controls.update();
  renderer.render(scene, camera);
});

// ------------------------------------------------------------ boot
buildBoard(VARIANTS[settings.variant]);
(() => { // opening position behind the menu
  const V = VARIANTS[settings.variant], b = createInitial(V); let i = 0;
  for (let sq = 0; sq < b.length; sq++) if (b[sq]) makePiece(1000 + i++, Math.sign(b[sq])).position.copy(sqPos(sq, V.N));
})();
manager.onLoad = () => { $('loading').style.opacity = 0; setTimeout(() => $('loading').remove(), 600); openMenu(); };
window.__rc = {
  get game() { return game; }, camera, controls, pieces, commitTurn, humanStep, selectSquare, crownPiece,
  debugSetup(arr, turn) {
    const V = game.V; clearPieces(); game.board = Int8Array.from(arr); game.ids.fill(-1); let nid = 0;
    for (let sq = 0; sq < arr.length; sq++) if (arr[sq]) { game.ids[sq] = nid; const p = makePiece(nid, Math.sign(arr[sq])); p.position.copy(sqPos(sq, V.N)); if (Math.abs(arr[sq]) === 2) crownPiece(p); nid++; }
    game.turn = turn; game.busy = false; startTurn();
  },
};
