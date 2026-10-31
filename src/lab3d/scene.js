// three.js scene for the Live Sensing Room. Pure rendering: the simulation
// state (agents, beams, link levels) is pushed in each frame by Lab3D.jsx.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { NODES, PAIRS, LINKS, LAMBDA } from "../lab/physics";
import { ROOM_W, ROOM_D, DOOR, BEAM_A, BEAM_B, SCANNER, SEATS } from "./sim";

const V = (x, y, h = 0) => new THREE.Vector3(x - ROOM_W / 2, h, y - ROOM_D / 2); // plan (x,y) + height -> world
const NODE_H = 2.05;   // boards mounted high in the corners, like on a wall bracket
const BEAM_H = 1.0;
const WALL_H = 2.9;
const SEAT_H = 0.46;
const VIOLET = 0x8b5cf6, SILVER = 0xc4b5fd;

// ---------- small helpers ----------
function labelSprite(text, { color = "#F4F1FF", bg = "rgba(14,11,24,0.82)", size = 40, border = "rgba(196,181,253,0.7)" } = {}) {
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d");
  ctx.font = `600 ${size}px Inter, system-ui, sans-serif`;
  const w = Math.ceil(ctx.measureText(text).width) + 36, h = size + 22;
  c.width = w; c.height = h;
  ctx.font = `600 ${size}px Inter, system-ui, sans-serif`;
  ctx.fillStyle = bg; ctx.strokeStyle = border; ctx.lineWidth = 3;
  const r = h / 2;
  ctx.beginPath(); ctx.moveTo(r, 2); ctx.arcTo(w - 2, 2, w - 2, h - 2, r); ctx.arcTo(w - 2, h - 2, 2, h - 2, r); ctx.arcTo(2, h - 2, 2, 2, r); ctx.arcTo(2, 2, w - 2, 2, r); ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = color; ctx.textBaseline = "middle"; ctx.fillText(text, 18, h / 2 + 1);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  // Constant on-screen size, so labels stay readable in close-ups and from far away.
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, sizeAttenuation: false }));
  const k = 0.00048;
  sp.scale.set(w * k, h * k, 1);
  sp.renderOrder = 10;
  sp.userData.text = text;
  return sp;
}
function setLabel(sp, text, opts) {
  if (sp.userData.text === text) return;
  const n = labelSprite(text, opts);
  sp.material.map.dispose(); sp.material.dispose();
  sp.material = n.material; sp.scale.copy(n.scale); sp.userData.text = text;
}
function canvasTex(w, h, draw, repeat) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}
function woodFloor() {
  return canvasTex(1024, 1024, (ctx, w, h) => {
    const plankH = 64;
    for (let y = 0, row = 0; y < h; y += plankH, row++) {
      let x = -((row * 137) % 300);
      while (x < w) {
        const len = 260 + ((row * 31 + x) % 180);
        const base = 120 + ((row * 53 + x * 7) % 30);
        ctx.fillStyle = `rgb(${base + 40},${base - 2},${base - 40})`;
        ctx.fillRect(x, y, len, plankH);
        for (let g = 0; g < 7; g++) { // grain
          ctx.strokeStyle = `rgba(60,35,15,${0.06 + ((g * 13 + row) % 5) * 0.015})`; ctx.lineWidth = 1.2;
          ctx.beginPath(); const gy = y + 6 + g * 8 + ((x + g) % 5); ctx.moveTo(x, gy); ctx.bezierCurveTo(x + len / 3, gy + 3, x + (2 * len) / 3, gy - 3, x + len, gy); ctx.stroke();
        }
        ctx.strokeStyle = "rgba(40,22,10,0.55)"; ctx.lineWidth = 2; ctx.strokeRect(x, y, len, plankH);
        x += len;
      }
    }
  }, [2, 2]);
}
function qrTexture() {
  return canvasTex(128, 128, (ctx) => {
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, 128, 128); ctx.fillStyle = "#0A0812";
    let s = 7; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (rnd() > 0.52) ctx.fillRect(8 + x * 7, 8 + y * 7, 7, 7);
    for (const [x, y] of [[8, 8], [85, 8], [8, 85]]) { ctx.fillRect(x, y, 35, 35); ctx.fillStyle = "#fff"; ctx.fillRect(x + 5, y + 5, 25, 25); ctx.fillStyle = "#0A0812"; ctx.fillRect(x + 10, y + 10, 15, 15); }
  });
}
function whiteboardTex() {
  return canvasTex(1024, 400, (ctx, w, h) => {
    ctx.fillStyle = "#f4f5f7"; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#2b59c3"; ctx.lineWidth = 6; ctx.font = "600 54px Inter, sans-serif"; ctx.fillStyle = "#2b59c3";
    ctx.fillText("CSI = how Wi-Fi bends around us", 40, 80);
    ctx.strokeStyle = "#c0392b"; ctx.beginPath();
    for (let x = 40; x < 980; x += 4) ctx.lineTo(x, 230 + Math.sin(x / 28) * 40 * Math.exp(-((x - 520) ** 2) / 90000) + Math.sin(x / 9) * 6);
    ctx.stroke();
    ctx.fillStyle = "#333"; ctx.font = "500 36px Inter, sans-serif"; ctx.fillText("IN: A → B     OUT: B → A", 40, 350);
  });
}

// ---------- ESP32-S3 board on a wall bracket ----------
function makeBoard(n) {
  const g = new THREE.Group();
  const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.06), new THREE.MeshStandardMaterial({ color: 0x2b2b33, metalness: 0.7, roughness: 0.35 }));
  bracket.position.y = NODE_H - 0.05; g.add(bracket);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, NODE_H - 0.05, 10), bracket.material); pole.position.y = (NODE_H - 0.05) / 2; g.add(pole);
  const board = new THREE.Group(); board.position.y = NODE_H;
  const S = 2.6; // shown larger than life so you can recognise it from across the room
  const pcb = new THREE.Mesh(new THREE.BoxGeometry(0.069 * S, 0.0016 * S * 2, 0.0254 * S), new THREE.MeshStandardMaterial({ color: 0x0b2f6b, roughness: 0.55 }));
  board.add(pcb);
  const shield = new THREE.Mesh(new THREE.BoxGeometry(0.018 * S, 0.0032 * S, 0.0255 * S * 0.72), new THREE.MeshStandardMaterial({ color: 0xd9dce3, metalness: 1, roughness: 0.22 }));
  shield.position.set(0.012 * S, 0.0032 * S, 0); board.add(shield);
  const ant = new THREE.Mesh(new THREE.BoxGeometry(0.007 * S, 0.0012 * S, 0.0255 * S * 0.72), new THREE.MeshStandardMaterial({ color: 0x111111 }));
  ant.position.set(0.026 * S, 0.0022 * S, 0); board.add(ant);
  const usb = new THREE.Mesh(new THREE.BoxGeometry(0.008 * S, 0.0032 * S, 0.009 * S), new THREE.MeshStandardMaterial({ color: 0xb7bcc6, metalness: 0.9, roughness: 0.3 }));
  usb.position.set(-0.031 * S, 0.003 * S, 0); board.add(usb);
  const pinMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.95, roughness: 0.3 });
  for (const side of [-1, 1]) for (let j = 0; j < 18; j++) {
    const pin = new THREE.Mesh(new THREE.BoxGeometry(0.0015 * S, 0.0045 * S, 0.0015 * S), pinMat);
    pin.position.set(-0.029 * S + j * 0.00254 * S * 1.3, -0.0022 * S, side * 0.0115 * S); board.add(pin);
  }
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.0022 * S, 10, 8), new THREE.MeshBasicMaterial({ color: 0x3b82f6 }));
  led.position.set(-0.02 * S, 0.003 * S, 0.008 * S); board.add(led);
  const glow = new THREE.PointLight(0x60a5fa, 0, 0.7); glow.position.copy(led.position); board.add(glow);
  board.rotation.z = 0.35;
  g.add(board);
  const label = labelSprite(`ESP32-S3 · ${n.id}`, { size: 34 }); label.position.y = NODE_H + 0.28; g.add(label);
  g.position.copy(V(n.x, n.y));
  g.lookAt(new THREE.Vector3(0, 0, 0)); g.rotation.x = 0; g.rotation.z = 0;
  g.userData = { led, glow, label };
  return g;
}

// ---------- a person with real joints ----------
const SKINS = [0xc68e6a, 0xa86b4c, 0x8d5a3b, 0xd2a07c, 0xb57a55];
const PANTS = [0x2d3e5c, 0x1f2230, 0x6b5d45, 0x3a3f4a, 0x23324d];
const HAIR = [0x1b1410, 0x2a1c12, 0x0f0c0a, 0x3b2616];
function makePerson(agent) {
  const g = new THREE.Group();
  const i = agent.id;
  const skin = new THREE.MeshStandardMaterial({ color: SKINS[i % SKINS.length], roughness: 0.65 });
  const shirt = new THREE.MeshStandardMaterial({ color: agent.shirt, roughness: 0.75 });
  const pants = new THREE.MeshStandardMaterial({ color: PANTS[i % PANTS.length], roughness: 0.85 });
  const shoe = new THREE.MeshStandardMaterial({ color: i % 3 ? 0x15151a : 0xe8e8ec, roughness: 0.6 });
  const hairM = new THREE.MeshStandardMaterial({ color: HAIR[i % HAIR.length], roughness: 0.9 });
  const cap = (r, len, mat, y) => { const geo = new THREE.CapsuleGeometry(r, len, 6, 12); geo.translate(0, y, 0); const m = new THREE.Mesh(geo, mat); m.castShadow = true; return m; };
  const pivot = (x, y, z) => { const p = new THREE.Group(); p.position.set(x, y, z); return p; };

  const hips = pivot(0, 0.95, 0); g.add(hips);
  const pelvis = cap(0.13, 0.12, pants, 0.0); pelvis.rotation.x = Math.PI / 2; pelvis.scale.set(0.9, 1, 0.75); hips.add(pelvis);
  const legs = [];
  for (const side of [1, -1]) {
    const hip = pivot(0, -0.02, side * 0.095); hips.add(hip);
    hip.add(cap(0.07, 0.34, pants, -0.22));
    const knee = pivot(0, -0.45, 0); hip.add(knee);
    knee.add(cap(0.058, 0.33, pants, -0.22));
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.07, 0.1), shoe); foot.position.set(0.05, -0.47, 0); foot.castShadow = true; knee.add(foot);
    legs.push({ hip, knee });
  }
  const chest = pivot(0, 0.06, 0); hips.add(chest);
  const torso = cap(0.16, 0.34, shirt, 0.27); torso.scale.set(0.68, 1, 1); chest.add(torso);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.08, 10), skin); neck.position.y = 0.6; chest.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.105, 24, 18), skin); head.position.y = 0.72; head.scale.set(0.95, 1.08, 0.88); head.castShadow = true; chest.add(head);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.112, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), hairM); hair.position.set(-0.012, 0.735, 0); hair.scale.set(0.98, 1.08, 0.92); chest.add(hair);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), skin); nose.position.set(0.1, 0.71, 0); chest.add(nose);
  const arms = [];
  for (const side of [1, -1]) {
    const sh = pivot(0, 0.5, side * 0.205); chest.add(sh);
    sh.add(cap(0.052, 0.22, shirt, -0.14));
    const el = pivot(0, -0.3, 0); sh.add(el);
    el.add(cap(0.044, 0.2, skin, -0.13));
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), skin); hand.position.y = -0.28; el.add(hand);
    arms.push({ sh, el, hand });
  }
  const phone = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.13, 0.068), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x6d28d9, emissiveIntensity: 0 }));
  phone.position.set(0.03, -0.31, 0); phone.visible = false; arms[1].el.add(phone);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.32, 0.38, 40), new THREE.MeshBasicMaterial({ color: 0xf5b544, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.015; ring.visible = false; g.add(ring);
  const tag = labelSprite(`#${agent.id}`); tag.position.y = 2.0; g.add(tag);
  g.userData = { hips, chest, legs, arms, phone, ring, tag, agentId: agent.id };
  g.traverse((o) => { o.userData.agentId = agent.id; });
  return g;
}

export function createScene(canvas, { onPick, onFloor } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0913);
  scene.fog = new THREE.Fog(0x0b0913, 16, 30);

  const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 80);
  camera.position.set(6.2, 5.6, -6.4);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.target.set(0, 0.9, 0.3);
  controls.maxPolarAngle = Math.PI * 0.48; controls.minDistance = 2.5; controls.maxDistance = 18;

  // ---- lights: warm classroom light + cool daylight from the window ----
  scene.add(new THREE.HemisphereLight(0xfff1e0, 0x2a2238, 0.75));
  const sun = new THREE.DirectionalLight(0xdfe8ff, 1.5);
  sun.position.set(-7, 8, 2); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
  Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 30 });
  scene.add(sun);
  for (const [x, y] of [[1.6, 2], [4.4, 2], [1.6, 4.4], [4.4, 4.4]]) {
    const l = new THREE.PointLight(0xffe2b8, 7, 6, 2); l.position.copy(V(x, y, WALL_H - 0.15)); scene.add(l);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.03, 0.3), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4e0, emissiveIntensity: 1.2 }));
    panel.position.copy(V(x, y, WALL_H - 0.02)); scene.add(panel);
  }

  // ---- floor, corridor ----
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W, ROOM_D), new THREE.MeshStandardMaterial({ map: woodFloor(), roughness: 0.62, metalness: 0.02 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const tiles = canvasTex(512, 512, (ctx, w) => { ctx.fillStyle = "#3a3842"; ctx.fillRect(0, 0, w, w); ctx.strokeStyle = "#2a2830"; ctx.lineWidth = 4; for (let i = 0; i <= w; i += 128) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, w); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(w, i); ctx.stroke(); } }, [4, 1.5]);
  const corridor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W + 3, 3), new THREE.MeshStandardMaterial({ map: tiles, roughness: 0.4 }));
  corridor.rotation.x = -Math.PI / 2; corridor.position.copy(V(3, -1.5, -0.002)); corridor.receiveShadow = true; scene.add(corridor);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(30, 48), new THREE.MeshStandardMaterial({ color: 0x0d0b14, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.01; scene.add(ground);

  // ---- walls: back + left are solid (with window and whiteboard), right is cut away, front is glass ----
  const paint = new THREE.MeshStandardMaterial({ color: 0xe9e5ef, roughness: 0.92 });
  const skirting = new THREE.MeshStandardMaterial({ color: 0x5b4a7a, roughness: 0.6 });
  const solidWall = (w, x, y, rotY, h = WALL_H) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.12), paint); m.position.copy(V(x, y, h / 2)); m.rotation.y = rotY; m.receiveShadow = true; m.castShadow = true; scene.add(m);
    const sk = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, 0.14), skirting); sk.position.copy(V(x, y, 0.05)); sk.rotation.y = rotY; scene.add(sk);
    return m;
  };
  solidWall(ROOM_W + 0.12, 3, ROOM_D + 0.06, 0);              // back
  solidWall(ROOM_D + 0.12, -0.06, 3, Math.PI / 2);            // left
  const rightLow = solidWall(ROOM_D + 0.12, ROOM_W + 0.06, 3, Math.PI / 2, 0.45); // right: cut-away so you can see in
  rightLow.material = paint;
  // window on the left wall
  const win = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.3), new THREE.MeshStandardMaterial({ color: 0xaecbff, emissive: 0x9cc0ff, emissiveIntensity: 0.55, roughness: 0.1 }));
  win.position.copy(V(0.005, 3, 1.75)); win.rotation.y = Math.PI / 2; scene.add(win);
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
  for (const dz of [-1.3, 0, 1.3]) { const f = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.36, 0.05), frameMat); f.position.copy(V(0.03, 3 + dz, 1.75)); scene.add(f); }
  for (const dh of [-0.65, 0.65]) { const f = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 2.66), frameMat); f.position.copy(V(0.03, 3, 1.75 + dh)); scene.add(f); }
  // whiteboard on the back wall
  const wb = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 1.1), new THREE.MeshStandardMaterial({ map: whiteboardTex(), roughness: 0.3 }));
  wb.position.copy(V(3, ROOM_D - 0.035, 1.55)); wb.rotation.y = Math.PI; scene.add(wb);
  const wbFrame = new THREE.Mesh(new THREE.BoxGeometry(2.9, 1.2, 0.03), new THREE.MeshStandardMaterial({ color: 0x9aa0aa, metalness: 0.7, roughness: 0.3 }));
  wbFrame.position.copy(V(3, ROOM_D + 0.005, 1.55)); scene.add(wbFrame);
  // front: glass partition with a door opening
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xcfd8ff, transparent: true, opacity: 0.12, roughness: 0.05, metalness: 0, side: THREE.DoubleSide, depthWrite: false });
  const mullion = new THREE.MeshStandardMaterial({ color: 0x3c3a48, metalness: 0.6, roughness: 0.4 });
  const dl = DOOR.x - DOOR.half, dr = DOOR.x + DOOR.half;
  const glassPane = (x0, x1) => {
    const w = x1 - x0;
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, WALL_H), glass); p.position.copy(V((x0 + x1) / 2, 0, WALL_H / 2)); scene.add(p);
    for (let x = x0; x <= x1 + 1e-6; x += w / Math.max(1, Math.round(w / 1.25))) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.05, WALL_H, 0.06), mullion); m.position.copy(V(x, 0, WALL_H / 2)); scene.add(m);
    }
    const top = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, 0.07), mullion); top.position.copy(V((x0 + x1) / 2, 0, WALL_H)); scene.add(top);
    const bot = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, 0.07), mullion); bot.position.copy(V((x0 + x1) / 2, 0, 0.05)); scene.add(bot);
  };
  glassPane(0, dl - 0.06); glassPane(dr + 0.06, ROOM_W);
  const lintelGlass = new THREE.Mesh(new THREE.PlaneGeometry(2 * DOOR.half + 0.12, WALL_H - 2.15), glass); lintelGlass.position.copy(V(DOOR.x, 0, 2.15 + (WALL_H - 2.15) / 2)); scene.add(lintelGlass);
  // door frame + open door leaf
  const frameDoor = new THREE.MeshStandardMaterial({ color: 0x2c2a35, metalness: 0.5, roughness: 0.45 });
  for (const x of [dl - 0.03, dr + 0.03]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.07, 2.15, 0.3), frameDoor); post.position.copy(V(x, 0, 1.075)); post.castShadow = true; scene.add(post); }
  const head = new THREE.Mesh(new THREE.BoxGeometry(2 * DOOR.half + 0.14, 0.08, 0.3), frameDoor); head.position.copy(V(DOOR.x, 0, 2.15)); scene.add(head);
  const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.04, 2.05, 2 * DOOR.half - 0.04), new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.55 }));
  leaf.position.copy(V(dl + 0.02, 0.5, 1.03)); leaf.castShadow = true; scene.add(leaf);
  const sign = labelSprite("Room A2-104 · GhostSlot", { size: 30 }); sign.position.copy(V(DOOR.x, -0.08, 2.5)); scene.add(sign);

  // ---- IR door counter: emitter on one post, receiver on the other ----
  const beamGeo = new THREE.CylinderGeometry(0.006, 0.006, 2 * DOOR.half, 8).rotateZ(Math.PI / 2);
  const glowGeo = new THREE.CylinderGeometry(0.03, 0.03, 2 * DOOR.half, 10).rotateZ(Math.PI / 2);
  const mkBeam = (y, name) => {
    const mat = new THREE.MeshBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0.95 });
    const m = new THREE.Mesh(beamGeo, mat); m.position.copy(V(DOOR.x, y, BEAM_H)); scene.add(m);
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending });
    const gl = new THREE.Mesh(glowGeo, glowMat); gl.position.copy(m.position); scene.add(gl);
    const unitMat = new THREE.MeshStandardMaterial({ color: 0x1c1b22, roughness: 0.4 });
    for (const x of [dl, dr]) { const box = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.05), unitMat); box.position.copy(V(x + (x < DOOR.x ? -0.005 : 0.005), y, BEAM_H)); scene.add(box); }
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.012, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff2020 })); eye.position.copy(V(dr - 0.03, y, BEAM_H)); scene.add(eye);
    const lab = labelSprite(name, { size: 28, border: "rgba(255,107,107,0.8)" }); lab.position.copy(V(dr + 0.62, y + (y < 0 ? -0.2 : 0.2), BEAM_H)); scene.add(lab);
    return { mat, glowMat, eye, lab };
  };
  const beamA = mkBeam(BEAM_A, "IR beam A · outside");
  const beamB = mkBeam(BEAM_B, "IR beam B · inside");

  // ---- door QR on the wall, just inside ----
  const qrPlate = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.44, 0.02), new THREE.MeshStandardMaterial({ color: 0x6d28d9, emissive: 0x3b1a7a, emissiveIntensity: 0.5 }));
  qrPlate.position.copy(V(SCANNER.x, 0.07, 1.45)); scene.add(qrPlate);
  const qr = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.26), new THREE.MeshBasicMaterial({ map: qrTexture() }));
  qr.position.copy(V(SCANNER.x, 0.082, 1.48)); scene.add(qr);
  const qrLabel = labelSprite("Door QR · scan to check in", { size: 28 }); qrLabel.position.copy(V(SCANNER.x + 0.2, 0.3, 1.9)); scene.add(qrLabel);

  // ---- desks + chairs ----
  const woodTop = new THREE.MeshStandardMaterial({ color: 0xb08a63, roughness: 0.55 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x3d3f48, metalness: 0.75, roughness: 0.35 });
  const plastic = new THREE.MeshStandardMaterial({ color: 0x33415c, roughness: 0.6 });
  const box = (w, h, d, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.copy(V(x, y, z)); m.castShadow = true; m.receiveShadow = true; scene.add(m); return m; };
  for (const s of SEATS) {
    const dy = s.y + 0.5; // desk in front of the seat (towards the whiteboard)
    box(0.86, 0.04, 0.55, woodTop, s.x, dy, 0.74);
    for (const [ox, oy] of [[-0.39, -0.23], [0.39, -0.23], [-0.39, 0.23], [0.39, 0.23]]) box(0.03, 0.72, 0.03, steel, s.x + ox, dy + oy, 0.36);
    box(0.44, 0.04, 0.42, plastic, s.x, s.y, SEAT_H);
    box(0.44, 0.4, 0.035, plastic, s.x, s.y - 0.2, SEAT_H + 0.26);
    for (const [ox, oy] of [[-0.19, -0.18], [0.19, -0.18], [-0.19, 0.18], [0.19, 0.18]]) box(0.022, SEAT_H, 0.022, steel, s.x + ox, s.y + oy, SEAT_H / 2);
  }
  // teacher's desk
  box(1.4, 0.05, 0.7, woodTop, 4.6, 5.35, 0.76); box(1.36, 0.7, 0.04, woodTop, 4.6, 5.02, 0.4);

  // ---- ESP32-S3 boards ----
  const boards = NODES.map((n) => { const b = makeBoard(n); scene.add(b); return b; });
  const nodePos = (id) => { const p = V(NODES[id - 1].x, NODES[id - 1].y, NODE_H); return p; };

  // Wi-Fi waves: rings expanding from every board
  const waveGeo = new THREE.RingGeometry(0.96, 1, 96);
  const waves = [];
  NODES.forEach((n, i) => {
    for (let k = 0; k < 3; k++) {
      const m = new THREE.Mesh(waveGeo, new THREE.MeshBasicMaterial({ color: SILVER, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
      m.rotation.x = -Math.PI / 2; m.position.copy(nodePos(n.id)); m.position.y -= 0.02;
      m.userData = { node: i, phase: k / 3 + i * 0.11 };
      scene.add(m); waves.push(m);
    }
  });
  // links + packets
  const links = PAIRS.map(([a, b]) => {
    const mat = new THREE.MeshBasicMaterial({ color: VIOLET, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending });
    const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.LineCurve3(nodePos(a), nodePos(b)), 1, 0.012, 8, false), mat);
    scene.add(tube);
    return { a, b, tube, mat };
  });
  const packetGeo = new THREE.SphereGeometry(0.03, 10, 8);
  const packets = LINKS.map(([a, b], i) => {
    const m = new THREE.Mesh(packetGeo, new THREE.MeshBasicMaterial({ color: SILVER, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending }));
    m.userData = { a, b, t: Math.random(), speed: 0.5 + (i % 3) * 0.07 };
    scene.add(m);
    return m;
  });
  // Fresnel zone of a chosen pair
  const fresnel = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 20), new THREE.MeshBasicMaterial({ color: SILVER, transparent: true, opacity: 0.09, depthWrite: false }));
  scene.add(fresnel);
  // "Wi-Fi feels you" ripples on the floor under people (only shown in blind mode / story)
  const feelGeo = new THREE.CircleGeometry(0.45, 40);

  // ---- people ----
  const people = new Map();
  const feels = new Map();
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let downAt = null;
  const onDown = (e) => { downAt = { x: e.clientX, y: e.clientY }; };
  const onUp = (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 6) { downAt = null; return; }
    downAt = null;
    const r = canvas.getBoundingClientRect();
    pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const meshes = []; people.forEach((g) => g.visible && g.traverse((o) => o.isMesh && meshes.push(o)));
    const hitP = raycaster.intersectObjects(meshes, false)[0];
    if (hitP) { onPick?.(hitP.object.userData.agentId); return; }
    const hitF = raycaster.intersectObject(floor, false)[0];
    if (hitF) onFloor?.(hitF.point.x + ROOM_W / 2, hitF.point.z + ROOM_D / 2);
  };
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointerup", onUp);

  const resize = () => {
    const w = canvas.clientWidth || 800, h = canvas.clientHeight || 600;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  };
  resize();
  const ro = new ResizeObserver(resize); ro.observe(canvas);

  // ---- camera moves (story mode) ----
  const VIEWS = {
    iso: [6.2, 5.6, -6.4, 0, 0.9, 0.3],
    top: [0.01, 12.5, 0.6, 0, 0, 0.2],
    door: [2.3, 1.9, -3.6, 0.1, 1.0, -2.6],
    qr: [2.8, 1.8, -1.8, 0.9, 1.2, -2.7],
    seats: [5.4, 3.4, -2.2, -0.3, 0.7, 0.8],
    boards: [-5.2, 4.6, -5.0, 0.2, 1.4, 0.4],
    wide: [7.4, 7.0, -7.8, 0, 0.6, 0.2],
  };
  let fly = null;
  const flyTo = (name, dur = 1.8) => {
    const v = VIEWS[name]; if (!v) return;
    fly = { t: 0, dur, p0: camera.position.clone(), t0: controls.target.clone(), p1: new THREE.Vector3(v[0], v[1], v[2]), t1: new THREE.Vector3(v[3], v[4], v[5]) };
  };

  let state = { agents: [], beams: { a: false, b: false }, pairLevel: new Array(6).fill(0), nodesOn: [true, true, true, true], blind: false, selectedId: null, highlight: new Set(), fresnelPair: 2, showFresnel: false, showFeel: false, autoRotate: false };
  const api = {
    update(s) { state = { ...state, ...s }; },
    view(name) { flyTo(name, 1.2); },
    flyTo,
    dispose() {
      cancelAnimationFrame(raf); ro.disconnect();
      canvas.removeEventListener("pointerdown", onDown); canvas.removeEventListener("pointerup", onUp);
      controls.dispose(); renderer.dispose();
      scene.traverse((o) => { o.geometry?.dispose?.(); if (o.material) [].concat(o.material).forEach((m) => { m.map?.dispose?.(); m.dispose?.(); }); });
    },
  };

  const clock = new THREE.Clock();
  const tmp = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  let raf;
  const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const loop = () => {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.05, clock.getDelta());
    const t = clock.elapsedTime;
    const S = state;

    if (fly) {
      fly.t += dt; const k = ease(Math.min(1, fly.t / fly.dur));
      camera.position.lerpVectors(fly.p0, fly.p1, k); controls.target.lerpVectors(fly.t0, fly.t1, k);
      if (k >= 1) fly = null;
    }
    controls.autoRotate = !!S.autoRotate && !fly; controls.autoRotateSpeed = 0.6;

    // IR beams: bright when clear, dark when a body cuts them
    const setBeam = (bm, cut) => {
      bm.mat.opacity = cut ? 0.08 : 0.95; bm.glowMat.opacity = cut ? 0.02 : 0.16 + 0.06 * Math.sin(t * 7);
      bm.eye.material.color.setHex(cut ? 0x3a0a0a : 0xff2020);
    };
    setBeam(beamA, S.beams.a); setBeam(beamB, S.beams.b);

    // boards, waves, links, packets
    boards.forEach((b, i) => {
      const on = S.nodesOn[i];
      const blink = on && Math.sin(t * 10 + i * 1.7) > 0.55;
      b.userData.led.material.color.setHex(on ? (blink ? 0x93c5fd : 0x1e3a8a) : 0x4a0d0d);
      b.userData.glow.intensity = blink ? 0.5 : 0;
      setLabel(b.userData.label, on ? `ESP32-S3 · ${i + 1}` : `ESP32-S3 · ${i + 1} · OFF`, { size: 34, color: on ? "#F4F1FF" : "#FF8B8B", border: on ? "rgba(196,181,253,0.7)" : "rgba(255,107,107,0.8)" });
    });
    waves.forEach((w) => {
      const on = S.nodesOn[w.userData.node];
      const ph = (t * 0.45 + w.userData.phase) % 1;
      const r = 0.15 + ph * 6.2;
      w.scale.set(r, r, r);
      w.material.opacity = on ? 0.28 * (1 - ph) * (1 - ph) : 0;
    });
    links.forEach((L, i) => {
      const on = S.nodesOn[L.a - 1] && S.nodesOn[L.b - 1];
      const k = Math.max(0, Math.min(1, S.pairLevel[i] || 0));
      L.tube.visible = on;
      L.mat.opacity = 0.14 + 0.7 * k;
      L.mat.color.setRGB(0.5 + 0.5 * k, 0.33 + 0.6 * k, 0.96);
    });
    packets.forEach((p) => {
      const { a, b } = p.userData;
      const on = S.nodesOn[a - 1] && S.nodesOn[b - 1];
      p.visible = on; if (!on) return;
      p.userData.t = (p.userData.t + dt * p.userData.speed) % 1;
      const A = nodePos(a), B = nodePos(b);
      tmp.subVectors(B, A).cross(up).normalize().multiplyScalar(0.035);
      p.position.lerpVectors(A, B, p.userData.t).add(tmp);
      const pi = PAIRS.findIndex(([x, y]) => (x === a && y === b) || (x === b && y === a));
      const k = S.pairLevel[pi] || 0;
      p.scale.setScalar(0.8 + 1.0 * k);
    });
    const fp = PAIRS[S.fresnelPair];
    if (S.showFresnel && fp && S.nodesOn[fp[0] - 1] && S.nodesOn[fp[1] - 1]) {
      const A = nodePos(fp[0]), B = nodePos(fp[1]);
      const d = A.distanceTo(B);
      const r = Math.sqrt((LAMBDA * d) / 4) + 0.18;
      fresnel.visible = true;
      fresnel.position.lerpVectors(A, B, 0.5);
      fresnel.scale.set(d / 2, r, r);
      fresnel.rotation.set(0, -Math.atan2(B.z - A.z, B.x - A.x), 0);
    } else fresnel.visible = false;

    // people
    const seen = new Set();
    for (const a of S.agents) {
      if (a.state === "gone" || a.state === "waiting") continue; // people queued in the corridor appear when they start walking
      seen.add(a.id);
      let g = people.get(a.id);
      if (!g) { g = makePerson(a); people.set(a.id, g); scene.add(g); }
      const u = g.userData;
      g.visible = !S.blind;
      g.position.copy(V(a.x + (a.fidgetX || 0), a.y + (a.fidgetY || 0)));
      const yaw = -a.heading;
      const dyaw = ((yaw - g.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      g.rotation.y += dyaw * Math.min(1, dt * 9);
      const [L, R] = u.legs, [AL, AR] = u.arms;
      if (a.seated) {
        u.hips.position.y = SEAT_H + 0.08;
        L.hip.rotation.z = R.hip.rotation.z = Math.PI / 2;
        L.knee.rotation.z = R.knee.rotation.z = -Math.PI / 2;
        u.chest.rotation.z = 0.08 + 0.03 * Math.sin(t * 0.7 + a.id);
        AL.sh.rotation.z = AR.sh.rotation.z = 0.45; AL.el.rotation.z = AR.el.rotation.z = 1.25;
      } else {
        const ph = a.walk || 0, moving = a.state !== "scanning" && a.state !== "idle" && a.state !== "seated" && ph > 0;
        const s = moving ? Math.sin(ph) : 0;
        u.hips.position.y = 0.95 + (moving ? Math.abs(Math.cos(ph)) * 0.02 : 0);
        L.hip.rotation.z = 0.45 * s; R.hip.rotation.z = -0.45 * s;
        L.knee.rotation.z = -(moving ? 0.1 + 0.7 * Math.max(0, -Math.sin(ph + 0.6)) : 0.02);
        R.knee.rotation.z = -(moving ? 0.1 + 0.7 * Math.max(0, Math.sin(ph + 0.6)) : 0.02);
        u.chest.rotation.z = moving ? 0.04 : 0;
        AL.sh.rotation.z = -0.4 * s; AL.el.rotation.z = 0.25;
        if (a.state === "scanning") { AR.sh.rotation.z = 1.05; AR.el.rotation.z = 0.9; }
        else { AR.sh.rotation.z = 0.4 * s; AR.el.rotation.z = 0.25; }
      }
      u.phone.visible = a.state === "scanning" || a.state === "toScanner";
      u.phone.material.emissiveIntensity = a.state === "scanning" ? 1.2 : 0;
      u.ring.visible = S.selectedId === a.id || S.highlight.has(a.id);
      u.ring.material.color.setHex(S.highlight.has(a.id) ? 0xf5b544 : 0xc4b5fd);
      u.ring.scale.setScalar(1 + (S.highlight.has(a.id) ? 0.12 * Math.sin(t * 5) : 0));
      const inside = a.y > 0.02;
      const busy = a.state === "entering" || a.state === "toScanner" || a.state === "scanning";
      const txt = !inside || a.state === "entering" ? a.name : a.checkedIn ? `${a.name} ✓ checked in` : busy ? `${a.name} · scanning` : a.state === "leaving" ? `${a.name} · leaving` : `${a.name} · not checked in`;
      const col = !inside || busy ? "#E9E3FF" : a.checkedIn ? "#3DDC97" : a.state === "leaving" ? "#A39CC4" : "#F5B544";
      setLabel(u.tag, txt, { size: 36, color: col, border: col === "#E9E3FF" ? "rgba(196,181,253,0.7)" : col });
      u.tag.position.y = a.seated ? 1.55 : 2.0;
      // what Wi-Fi "feels": a soft disc under each person inside (shown in blind mode)
      let f = feels.get(a.id);
      if (!f) { f = new THREE.Mesh(feelGeo, new THREE.MeshBasicMaterial({ color: SILVER, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })); f.rotation.x = -Math.PI / 2; scene.add(f); feels.set(a.id, f); }
      f.position.copy(V(a.x, a.y, 0.02));
      f.visible = S.showFeel && inside;
      f.material.opacity = 0.18 + 0.12 * Math.sin(t * 3 + a.id);
      f.scale.setScalar(0.8 + 0.25 * Math.sin(t * 2 + a.id));
    }
    for (const [id, g] of people) if (!seen.has(id)) { scene.remove(g); people.delete(id); const f = feels.get(id); if (f) { scene.remove(f); feels.delete(id); } }

    controls.update();
    renderer.render(scene, camera);
  };
  loop();
  return api;
}
