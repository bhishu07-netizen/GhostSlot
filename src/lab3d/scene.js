// three.js scene for the Live Sensing Room. Pure rendering: the simulation
// state (agents, beams, link levels) is pushed in each frame by Lab3D.jsx.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { NODES, PAIRS, LINKS, LAMBDA } from "../lab/physics";
import { ROOM_W, ROOM_D, DOOR, BEAM_A, BEAM_B, SCANNER, SEATS } from "./sim";

const V = (x, y, h = 0) => new THREE.Vector3(x - ROOM_W / 2, h, y - ROOM_D / 2); // plan (x,y) + height -> world
const NODE_H = 1.25;
const BEAM_H = 1.0;
const VIOLET = 0x8b5cf6, SILVER = 0xc4b5fd;

function labelSprite(text, { color = "#F4F1FF", bg = "rgba(18,15,30,0.85)", size = 44, border = "#C4B5FD" } = {}) {
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d");
  ctx.font = `700 ${size}px Inter, system-ui, sans-serif`;
  const w = Math.ceil(ctx.measureText(text).width) + 40, h = size + 26;
  c.width = w; c.height = h;
  ctx.font = `700 ${size}px Inter, system-ui, sans-serif`;
  ctx.fillStyle = bg; ctx.strokeStyle = border; ctx.lineWidth = 4;
  const r = 18;
  ctx.beginPath(); ctx.moveTo(r, 2); ctx.arcTo(w - 2, 2, w - 2, h - 2, r); ctx.arcTo(w - 2, h - 2, 2, h - 2, r); ctx.arcTo(2, h - 2, 2, 2, r); ctx.arcTo(2, 2, w - 2, 2, r); ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = color; ctx.textBaseline = "middle"; ctx.fillText(text, 20, h / 2 + 2);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  const k = 0.0042;
  sp.scale.set(w * k, h * k, 1);
  sp.renderOrder = 10;
  sp.userData.text = text;
  return sp;
}
function setLabel(sp, text, opts) {
  if (sp.userData.text === text && !opts) return;
  const n = labelSprite(text, opts);
  sp.material.map.dispose(); sp.material.dispose();
  sp.material = n.material; sp.scale.copy(n.scale); sp.userData.text = text;
}

function qrTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, 128, 128); ctx.fillStyle = "#0A0812";
  let s = 7; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (rnd() > 0.52) ctx.fillRect(8 + x * 7, 8 + y * 7, 7, 7);
  for (const [x, y] of [[8, 8], [85, 8], [8, 85]]) { ctx.fillRect(x, y, 35, 35); ctx.fillStyle = "#fff"; ctx.fillRect(x + 5, y + 5, 25, 25); ctx.fillStyle = "#0A0812"; ctx.fillRect(x + 10, y + 10, 15, 15); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter; return t;
}

// An ESP32-S3 dev board on a stand, facing the room centre.
function makeBoard(n) {
  const g = new THREE.Group();
  const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, NODE_H - 0.06, 12), new THREE.MeshStandardMaterial({ color: 0x2a2540, metalness: 0.6, roughness: 0.4 }));
  stand.position.y = (NODE_H - 0.06) / 2; stand.castShadow = true; g.add(stand);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.03, 20), stand.material); base.position.y = 0.015; g.add(base);
  const board = new THREE.Group(); board.position.y = NODE_H;
  // PCB (scaled ~3x so it is visible from across the room)
  const pcb = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.012, 0.085), new THREE.MeshStandardMaterial({ color: 0x0f3d2e, roughness: 0.6 }));
  board.add(pcb);
  const shield = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.014, 0.06), new THREE.MeshStandardMaterial({ color: 0xd8dbe2, metalness: 0.9, roughness: 0.25 }));
  shield.position.set(0.035, 0.013, 0); board.add(shield);
  const ant = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.004, 0.06), new THREE.MeshStandardMaterial({ color: 0x1a1a1a }));
  ant.position.set(0.09, 0.008, 0); board.add(ant);
  const usb = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.012, 0.03), new THREE.MeshStandardMaterial({ color: 0xaaaaaa, metalness: 0.8 }));
  usb.position.set(-0.1, 0.012, 0); board.add(usb);
  for (let i = 0; i < 2; i++) for (let j = 0; j < 10; j++) {
    const pin = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.01, 0.006), new THREE.MeshStandardMaterial({ color: 0xc9a227, metalness: 0.9 }));
    pin.position.set(-0.08 + j * 0.017, -0.01, i ? 0.036 : -0.036); board.add(pin);
  }
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.009, 10, 8), new THREE.MeshBasicMaterial({ color: 0x3b82f6 }));
  led.position.set(-0.06, 0.012, 0.025); board.add(led);
  const glow = new THREE.PointLight(0x3b82f6, 0, 0.6); glow.position.copy(led.position); board.add(glow);
  board.rotation.x = -0.35;
  g.add(board);
  const label = labelSprite(`S3·${n.id}`); label.position.y = NODE_H + 0.32; g.add(label);
  const p = V(n.x, n.y); g.position.copy(p);
  g.lookAt(new THREE.Vector3(0, 0, 0)); g.rotation.x = 0; g.rotation.z = 0;
  g.userData = { led, glow, label, ledOn: 0, pcb };
  return g;
}

// A low-poly person built from primitives.
function makePerson(agent) {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0xc68e6a, roughness: 0.7 });
  const shirt = new THREE.MeshStandardMaterial({ color: agent.shirt, roughness: 0.6 });
  const pants = new THREE.MeshStandardMaterial({ color: 0x2a2f45, roughness: 0.8 });
  const mk = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; return m; };
  const hips = new THREE.Group(); hips.position.y = 0.92; g.add(hips);
  const legGeo = new THREE.CapsuleGeometry(0.065, 0.62, 4, 8); legGeo.translate(0, -0.38, 0);
  const legL = mk(legGeo, pants, 0, 0, 0.09), legR = mk(legGeo, pants, 0, 0, -0.09);
  hips.add(legL, legR);
  const torso = mk(new THREE.CapsuleGeometry(0.17, 0.42, 4, 10), shirt, 0, 0.36, 0); torso.scale.set(0.75, 1, 1); hips.add(torso);
  const armGeo = new THREE.CapsuleGeometry(0.05, 0.5, 4, 8); armGeo.translate(0, -0.27, 0);
  const armL = mk(armGeo, shirt, 0, 0.6, 0.21), armR = mk(armGeo, shirt, 0, 0.6, -0.21);
  hips.add(armL, armR);
  const head = mk(new THREE.SphereGeometry(0.115, 16, 12), skin, 0, 0.83, 0); hips.add(head);
  const hair = mk(new THREE.SphereGeometry(0.12, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1b1410 }), -0.01, 0.86, 0); hips.add(hair);
  const phone = mk(new THREE.BoxGeometry(0.02, 0.14, 0.075), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x000000 }), 0.05, -0.5, 0);
  phone.visible = false; armR.add(phone);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.34, 32), new THREE.MeshBasicMaterial({ color: 0xf5b544, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02; ring.visible = false; g.add(ring);
  const tag = labelSprite(`#${agent.id}`, { size: 40 }); tag.position.y = 2.05; g.add(tag);
  g.userData = { hips, legL, legR, armL, armR, phone, ring, tag, torso, meshes: [legL, legR, torso, armL, armR, head, hair], agentId: agent.id };
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
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07060c);
  scene.fog = new THREE.Fog(0x07060c, 14, 26);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 80);
  camera.position.set(5.6, 6.4, -6.9);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.target.set(0, 0.6, 0.2);
  controls.maxPolarAngle = Math.PI * 0.49; controls.minDistance = 3; controls.maxDistance = 18;

  // lights
  scene.add(new THREE.HemisphereLight(0xb9a7ff, 0x0b0814, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(4, 9, -3); key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 25 });
  scene.add(key);
  const fill = new THREE.PointLight(0x8b5cf6, 6, 12); fill.position.set(0, 3, 0); scene.add(fill);

  // floor + corridor
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W, ROOM_D), new THREE.MeshStandardMaterial({ color: 0x17132a, roughness: 0.92 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; floor.userData.floor = true; scene.add(floor);
  const grid = new THREE.GridHelper(6, 12, 0x3b2f66, 0x231c3d); grid.position.y = 0.002; scene.add(grid);
  const corridor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W + 2, 2.8), new THREE.MeshStandardMaterial({ color: 0x0e0c18, roughness: 1 }));
  corridor.rotation.x = -Math.PI / 2; corridor.position.copy(V(3, -1.4, -0.001)); corridor.receiveShadow = true; scene.add(corridor);
  const corrLabel = labelSprite("CORRIDOR", { size: 34, color: "#A39CC4", border: "#3b2f66" }); corrLabel.position.copy(V(1.2, -1.6, 0.3)); scene.add(corrLabel);

  // walls (glass-like so you can see in), front wall has the door
  const WALL_H = 2.8;
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x2a2148, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false });
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x6d5bd0, transparent: true, opacity: 0.6 });
  const wall = (w, x, y, rotY) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, WALL_H), wallMat); m.position.copy(V(x, y, WALL_H / 2)); m.rotation.y = rotY; scene.add(m);
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), edgeMat); e.position.copy(m.position); e.rotation.copy(m.rotation); scene.add(e);
  };
  wall(ROOM_W, 3, ROOM_D, 0);                 // back
  wall(ROOM_D, 0, 3, Math.PI / 2);            // left
  wall(ROOM_D, ROOM_W, 3, Math.PI / 2);       // right
  const dl = DOOR.x - DOOR.half, dr = DOOR.x + DOOR.half;
  wall(dl, dl / 2, 0, 0); wall(ROOM_W - dr, (dr + ROOM_W) / 2, 0, 0); // front, with a gap for the door
  const lintel = new THREE.Mesh(new THREE.PlaneGeometry(2 * DOOR.half, WALL_H - 2.1), wallMat); lintel.position.copy(V(DOOR.x, 0, 2.1 + (WALL_H - 2.1) / 2)); scene.add(lintel);
  // door frame posts with IR emitters/receivers
  const postMat = new THREE.MeshStandardMaterial({ color: 0x3a3156, metalness: 0.5, roughness: 0.5 });
  for (const x of [dl - 0.04, dr + 0.04]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.1, 0.32), postMat); post.position.copy(V(x, 0, 1.05)); post.castShadow = true; scene.add(post);
  }
  const doorLabel = labelSprite("DOOR · IR counter", { size: 34 }); doorLabel.position.copy(V(DOOR.x, -0.05, 2.45)); scene.add(doorLabel);
  const beamGeo = new THREE.CylinderGeometry(0.012, 0.012, 2 * DOOR.half + 0.06, 8); beamGeo.rotateZ(Math.PI / 2);
  const mkBeam = (y, name) => {
    const mat = new THREE.MeshBasicMaterial({ color: 0xff2d2d, transparent: true, opacity: 0.9 });
    const m = new THREE.Mesh(beamGeo, mat); m.position.copy(V(DOOR.x, y, BEAM_H)); scene.add(m);
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xff2d2d, transparent: true, opacity: 0.18 });
    const gl = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2 * DOOR.half + 0.06, 8).rotateZ(Math.PI / 2), glowMat); gl.position.copy(m.position); scene.add(gl);
    for (const [x, col] of [[dl - 0.02, 0xff4444], [dr + 0.02, 0x222222]]) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.06), new THREE.MeshStandardMaterial({ color: 0x15121f, emissive: col, emissiveIntensity: 0.4 }));
      box.position.copy(V(x, y, BEAM_H)); scene.add(box);
    }
    const lab = labelSprite(name, { size: 30, border: "#ff6b6b" }); lab.position.copy(V(dr + 0.42, y + (y < 0 ? -0.18 : 0.18), BEAM_H + 0.05)); scene.add(lab);
    return { m, gl, mat, glowMat };
  };
  const beamA = mkBeam(BEAM_A, "IR beam A (outside)");
  const beamB = mkBeam(BEAM_B, "IR beam B (inside)");
  // door QR on the wall inside
  const qr = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.28), new THREE.MeshBasicMaterial({ map: qrTexture() }));
  qr.position.copy(V(SCANNER.x, SCANNER.y + 0.005, 1.45)); scene.add(qr);
  const qrFrame = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.44), new THREE.MeshStandardMaterial({ color: 0x8b5cf6, emissive: 0x3b2a7a, emissiveIntensity: 0.6 }));
  qrFrame.position.copy(V(SCANNER.x, SCANNER.y + 0.003, 1.42)); scene.add(qrFrame);
  const qrLabel = labelSprite("Door QR · check in", { size: 30 }); qrLabel.position.copy(V(SCANNER.x + 0.15, SCANNER.y + 0.25, 1.85)); scene.add(qrLabel);

  // desks and chairs
  const deskMat = new THREE.MeshStandardMaterial({ color: 0x3b3355, roughness: 0.7 });
  const chairMat = new THREE.MeshStandardMaterial({ color: 0x241f38, roughness: 0.8 });
  for (const row of [2.6, 4.3]) {
    const desk = new THREE.Mesh(new THREE.BoxGeometry(5.0, 0.05, 0.55), deskMat); desk.position.copy(V(3, row, 0.74)); desk.castShadow = true; desk.receiveShadow = true; scene.add(desk);
    for (const x of [0.6, 5.4]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.72, 0.5), deskMat); leg.position.copy(V(x, row, 0.36)); scene.add(leg); }
  }
  for (const s of SEATS) {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.05, 0.42), chairMat); seat.position.copy(V(s.x, s.y + 0.05, 0.46)); seat.castShadow = true; scene.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.45, 0.04), chairMat); back.position.copy(V(s.x, s.y + 0.26, 0.7)); scene.add(back);
  }

  // ESP32-S3 boards
  const boards = NODES.map((n) => { const b = makeBoard(n); scene.add(b); return b; });

  // Wi-Fi links: one glowing tube per pair + travelling packets per direction
  const nodePos = (id) => V(NODES[id - 1].x, NODES[id - 1].y, NODE_H + 0.02);
  const links = PAIRS.map(([a, b]) => {
    const curve = new THREE.LineCurve3(nodePos(a), nodePos(b));
    const mat = new THREE.MeshBasicMaterial({ color: VIOLET, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending });
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 1, 0.018, 8, false), mat);
    scene.add(tube);
    return { a, b, tube, mat };
  });
  const packetGeo = new THREE.SphereGeometry(0.035, 10, 8);
  const packets = LINKS.map(([a, b], i) => {
    const m = new THREE.Mesh(packetGeo, new THREE.MeshBasicMaterial({ color: SILVER, transparent: true, opacity: 0.95 }));
    m.userData = { a, b, t: Math.random(), speed: 0.55 + (i % 3) * 0.08 };
    scene.add(m);
    return m;
  });
  // Fresnel zone of the selected pair (first zone, ellipsoid around the link)
  const fresnel = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.MeshBasicMaterial({ color: SILVER, transparent: true, opacity: 0.07, depthWrite: false }));
  const fresnelWire = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.SphereGeometry(1, 16, 8)), new THREE.LineBasicMaterial({ color: SILVER, transparent: true, opacity: 0.18 }));
  scene.add(fresnel, fresnelWire);

  // people
  const people = new Map();
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let downAt = null;
  const onDown = (e) => { downAt = { x: e.clientX, y: e.clientY }; };
  const onUp = (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 6) { downAt = null; return; } // it was a drag (orbit)
    downAt = null;
    const r = canvas.getBoundingClientRect();
    pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const personMeshes = []; people.forEach((g) => g.visible && g.traverse((o) => o.isMesh && personMeshes.push(o)));
    const hitP = raycaster.intersectObjects(personMeshes, false)[0];
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

  let state = { agents: [], beams: { a: false, b: false }, pairLevel: new Array(6).fill(0), nodesOn: [true, true, true, true], blind: false, selectedId: null, fresnelPair: 2, tick: 0 };
  const api = {
    update(s) { state = { ...state, ...s }; },
    view(name) {
      const presets = { iso: [6.5, 7.2, -7.8, 0, 0.6, 0.2], top: [0.01, 13, 0.4, 0, 0, 0], door: [2.4, 2.2, -4.2, 0, 1.0, -2.4], corner: [-4.6, 3.2, -4.6, 0.5, 0.8, 0.5] };
      const p = presets[name]; if (!p) return;
      camera.position.set(p[0], p[1], p[2]); controls.target.set(p[3], p[4], p[5]); controls.update();
    },
    dispose() {
      cancelAnimationFrame(raf); ro.disconnect();
      canvas.removeEventListener("pointerdown", onDown); canvas.removeEventListener("pointerup", onUp);
      controls.dispose(); renderer.dispose();
      scene.traverse((o) => { o.geometry?.dispose?.(); if (o.material) [].concat(o.material).forEach((m) => { m.map?.dispose?.(); m.dispose?.(); }); });
    },
  };

  const clock = new THREE.Clock();
  let raf;
  const loop = () => {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.05, clock.getDelta());
    const t = clock.elapsedTime;
    const S = state;

    // beams
    const setBeam = (bm, cut) => {
      bm.mat.opacity = cut ? 0.12 : 0.9; bm.glowMat.opacity = cut ? 0.04 : 0.18 + 0.06 * Math.sin(t * 6);
      bm.mat.color.setHex(cut ? 0x552222 : 0xff2d2d);
    };
    setBeam(beamA, S.beams.a); setBeam(beamB, S.beams.b);

    // boards + links + packets
    boards.forEach((b, i) => {
      const on = S.nodesOn[i];
      const blink = on && (Math.sin(t * 9 + i) > 0.6);
      b.userData.led.material.color.setHex(on ? (blink ? 0x60a5fa : 0x1e3a8a) : 0x5a1010);
      b.userData.glow.intensity = blink ? 0.6 : 0;
    });
    links.forEach((L, i) => {
      const on = S.nodesOn[L.a - 1] && S.nodesOn[L.b - 1];
      const k = Math.max(0, Math.min(1, S.pairLevel[i] || 0));
      L.tube.visible = on;
      L.mat.opacity = 0.18 + 0.75 * k;
      L.mat.color.setRGB(0.55 + 0.45 * k, 0.36 + 0.5 * k, 0.96);
      L.tube.scale.set(1, 1, 1);
    });
    packets.forEach((p) => {
      const { a, b } = p.userData;
      const on = S.nodesOn[a - 1] && S.nodesOn[b - 1];
      p.visible = on;
      if (!on) return;
      p.userData.t = (p.userData.t + dt * p.userData.speed) % 1;
      const A = nodePos(a), B = nodePos(b);
      const side = new THREE.Vector3().subVectors(B, A).cross(new THREE.Vector3(0, 1, 0)).normalize().multiplyScalar(0.04);
      p.position.lerpVectors(A, B, p.userData.t).add(side);
      const pairIdx = PAIRS.findIndex(([x, y]) => (x === a && y === b) || (x === b && y === a));
      const k = S.pairLevel[pairIdx] || 0;
      p.material.color.setRGB(0.8 + 0.2 * k, 0.75 + 0.25 * k, 1);
      p.scale.setScalar(0.8 + 0.8 * k);
    });
    // Fresnel ellipsoid for the selected pair
    const fp = PAIRS[S.fresnelPair];
    if (S.showFresnel && fp && S.nodesOn[fp[0] - 1] && S.nodesOn[fp[1] - 1]) {
      const A = nodePos(fp[0]), B = nodePos(fp[1]);
      const d = A.distanceTo(B);
      const r = Math.sqrt(LAMBDA * d / 4) + 0.18; // first Fresnel radius at the middle + body width
      [fresnel, fresnelWire].forEach((m) => {
        m.visible = true;
        m.position.lerpVectors(A, B, 0.5);
        m.scale.set(d / 2, r, r);
        m.rotation.set(0, -Math.atan2(B.z - A.z, B.x - A.x), 0);
      });
    } else { fresnel.visible = fresnelWire.visible = false; }

    // people
    const seen = new Set();
    for (const a of S.agents) {
      if (a.state === "gone") continue;
      seen.add(a.id);
      let g = people.get(a.id);
      if (!g) { g = makePerson(a); people.set(a.id, g); scene.add(g); }
      const u = g.userData;
      g.visible = !S.blind;
      g.position.copy(V(a.x + (a.fidgetX || 0), a.y + (a.fidgetY || 0)));
      // face the walking direction (plan heading -> world yaw)
      const yaw = -a.heading; // the model faces +x; plan heading atan2(dy, dx) -> world yaw
      g.rotation.y += ((yaw - g.rotation.y + Math.PI * 3) % (Math.PI * 2) - Math.PI) * Math.min(1, dt * 10);
      const sw = Math.sin(a.walk) * (a.walk ? 0.55 : 0);
      if (a.seated) {
        u.hips.position.y = 0.52; u.legL.rotation.z = u.legR.rotation.z = Math.PI / 2.1;
        u.armL.rotation.z = u.armR.rotation.z = 0.9;
      } else {
        u.hips.position.y = 0.92 + Math.abs(Math.sin(a.walk)) * 0.025;
        u.legL.rotation.z = sw; u.legR.rotation.z = -sw;
        u.armL.rotation.z = -sw * 0.8; u.armR.rotation.z = a.state === "scanning" ? 1.35 : sw * 0.8;
      }
      u.phone.visible = a.state === "scanning";
      u.phone.material.emissive.setHex(a.state === "scanning" ? 0x7c5cff : 0x000000);
      u.ring.visible = S.selectedId === a.id;
      const inside = a.y > 0.02;
      const busy = a.state === "entering" || a.state === "toScanner" || a.state === "scanning";
      const txt = !inside || a.state === "entering" ? `#${a.id} ${a.name}` : a.checkedIn ? `#${a.id} ✓ checked in` : busy ? `#${a.id} scanning…` : a.state === "leaving" ? `#${a.id} leaving` : `#${a.id} not scanned`;
      const col = !inside || busy ? "#C4B5FD" : a.checkedIn ? "#3DDC97" : a.state === "leaving" ? "#A39CC4" : "#F5B544";
      if (u.tag.userData.text !== txt) setLabel(u.tag, txt, { size: 40, color: col, border: col });
      u.tag.position.y = a.seated ? 1.65 : 2.05;
    }
    for (const [id, g] of people) if (!seen.has(id)) { scene.remove(g); people.delete(id); }

    controls.update();
    renderer.render(scene, camera);
  };
  loop();
  return api;
}
