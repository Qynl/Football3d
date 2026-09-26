import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const root = document.getElementById('game-root');
const hud = document.getElementById('hud');
const startScreen = document.getElementById('start-screen');
const endScreen = document.getElementById('end-screen');
const startSimButton = document.getElementById('start-sim');
const startClickButton = document.getElementById('start-click');
const restartButton = document.getElementById('restart');
const playerScoreEl = document.getElementById('player-score');
const rivalScoreEl = document.getElementById('rival-score');
const clockEl = document.getElementById('game-clock');
const speedEl = document.getElementById('speed-readout');
const possessionEl = document.getElementById('possession-readout');
const shotEl = document.getElementById('shot-readout');
const modePill = document.getElementById('mode-pill');
const powerFill = document.getElementById('power-fill');
const toastEl = document.getElementById('toast');
const finalTitle = document.getElementById('final-title');
const finalCopy = document.getElementById('final-copy');
const staminaReadout = document.getElementById('stamina-readout');
const staminaFill = document.getElementById('stamina-fill');
const skillReadout = document.getElementById('skill-readout');
const skillFill = document.getElementById('skill-fill');
const momentumReadout = document.getElementById('momentum-readout');
const coachTip = document.getElementById('coach-tip');
const lastShotSpeed = document.getElementById('last-shot-speed');
const lastShotType = document.getElementById('last-shot-type');
const radarPlayer = document.getElementById('radar-player');
const radarRival = document.getElementById('radar-rival');
const radarPuck = document.getElementById('radar-puck');

const RINK = {
  width: 28,
  length: 62,
  halfW: 14,
  halfL: 31,
  wallX: 13.28,
  wallZ: 30.45,
  goalLine: 28.85,
  goalWidth: 6.8,
};

const TEAM = {
  player: 0x55f7ff,
  rival: 0xff455b,
  gold: 0xffe16b,
  ice: 0xbff8ff,
};

const clamp = THREE.MathUtils.clamp;
const damp = THREE.MathUtils.damp;
const lerp = THREE.MathUtils.lerp;

let renderer;
let scene;
let camera;
let composer;
let bloomPass;
let clock;
let icePlane;
let clickTargetMarker;
let aimLine;
let puckTrail;
let audioContext;

const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const tmpVec3 = new THREE.Vector3();
const tmpVec3B = new THREE.Vector3();
const tmpVec2 = new THREE.Vector2();
const tmpVec2B = new THREE.Vector2();

const keys = new Set();

const state = {
  running: false,
  gameOver: false,
  mode: 'simulation',
  timeRemaining: 180,
  goalPause: 0,
  playerScore: 0,
  rivalScore: 0,
  lastToastTime: 0,
  cameraShake: 0,
  cameraKick: 0,
  possession: 'player',
  possessionGrace: 0,
  crowdPulse: 0,
  momentum: 0,
  skillMultiplier: 1,
  shotStreak: 0,
  lastShotKmh: 0,
  lastShotLabel: 'Charge a shot',
  coachTimer: 0,
};

const player = {
  pos: new THREE.Vector2(0, 18),
  vel: new THREE.Vector2(0, 0),
  yaw: 0,
  pitch: -0.08,
  bob: 0,
  sprintHeat: 0,
  stamina: 1,
  stealCooldown: 0,
};

const ai = {
  pos: new THREE.Vector2(0, -10),
  vel: new THREE.Vector2(0, 0),
  yaw: Math.PI,
  cooldown: 0,
  aggression: 0.66,
  stun: 0,
  dekeClock: 0,
  group: null,
};

const puck = {
  pos: new THREE.Vector2(0, 16.2),
  vel: new THREE.Vector2(0, 0),
  spin: 0,
  air: 0,
  airVel: 0,
  shotHigh: 0,
  group: null,
  lastShotBy: 'player',
};

const goalies = {
  rival: { x: 0, z: -RINK.goalLine + 0.72, dir: 1, color: 0xff455b, group: null, saveFlash: 0, recovery: 0, saveCount: 0 },
  player: { x: 0, z: RINK.goalLine - 0.72, dir: -1, color: 0x55f7ff, group: null, saveFlash: 0, recovery: 0, saveCount: 0 },
};

const mouse = {
  ndc: new THREE.Vector2(0, 0),
  worldTarget: new THREE.Vector3(0, 0, -RINK.goalLine),
  charging: false,
  charge: 0,
  chargeStart: 0,
  flick: 0,
  movementAccumulator: 0,
  draggingPuck: false,
  leftDown: false,
};

const particles = [];
const crowdMats = [];
let playerStick;
let playerGloveL;
let playerGloveR;
let speedLines = [];
let skillTarget;
let iceReflection;
const iceRails = [];
let animationFrameId = 0;
let booted = false;

export function bootNeonIce() {
  if (booted) return;
  booted = true;
  init();
  animate();
  window.__NEON_ICE_DISPOSE__ = () => {
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
  };
}

function init() {
  clock = new THREE.Clock();

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x030713);
  scene.fog = new THREE.FogExp2(0x050b18, 0.034);

  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 260);
  camera.rotation.order = 'YXZ';
  scene.add(camera);

  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.72;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  root.appendChild(renderer.domElement);

  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.18, 0.34, 0.62);
  composer.addPass(bloomPass);

  createLights();
  createArena();
  createPuck();
  createAiSkater();
  createGoalies();
  createPlayerStick();
  createParticlePool();
  createAimHelpers();
  resetRound(true);
  updateCamera(0);
  updateHud();
  showToast('Choose a mode. Simulation locks your mouse for real first-person control.', 9000);

  window.addEventListener('resize', onResize);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', (event) => keys.delete(event.code));
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('contextmenu', (event) => event.preventDefault());
  document.addEventListener('pointerlockchange', onPointerLockChange);

  startSimButton.addEventListener('click', () => startMatch('simulation'));
  startClickButton.addEventListener('click', () => startMatch('click'));
  restartButton.addEventListener('click', () => startMatch(state.mode));
}

function createLights() {
  const hemi = new THREE.HemisphereLight(0x89c9df, 0x02040c, 0.54);
  scene.add(hemi);

  const moon = new THREE.DirectionalLight(0xa7d9ff, 0.86);
  moon.position.set(-14, 28, 18);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  moon.shadow.camera.left = -42;
  moon.shadow.camera.right = 42;
  moon.shadow.camera.top = 42;
  moon.shadow.camera.bottom = -42;
  scene.add(moon);

  const neonCyan = new THREE.SpotLight(0x3ec6ff, 82, 88, Math.PI / 5.2, 0.55, 1.3);
  neonCyan.position.set(-18, 18, 3);
  neonCyan.target.position.set(0, 0, 0);
  neonCyan.castShadow = true;
  scene.add(neonCyan, neonCyan.target);

  const neonPink = new THREE.SpotLight(0xff3df5, 58, 86, Math.PI / 5.4, 0.5, 1.35);
  neonPink.position.set(18, 15, -8);
  neonPink.target.position.set(0, 0, 0);
  scene.add(neonPink, neonPink.target);

  for (let z = -24; z <= 24; z += 12) {
    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(17, 0.06, 0.34),
      new THREE.MeshStandardMaterial({ color: 0x8db7c9, emissive: 0x2aa6c8, emissiveIntensity: 0.54, roughness: 0.32 })
    );
    strip.position.set(0, 8.9, z);
    strip.castShadow = false;
    scene.add(strip);

    const light = new THREE.PointLight(z % 24 === 0 ? 0x4bc7ff : 0xaedcff, 7.5, 22, 2.0);
    light.position.set(0, 8.4, z);
    scene.add(light);
  }
}

function createArena() {
  createIce();
  createRinkLines();
  createBoardsAndGlass();
  createGoals();
  createSkillTarget();
  createCrowd();
  createCeiling();
}

function createIce() {
  const { map, roughnessMap } = makeIceTextures();
  const iceMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x6f93a7,
    map,
    roughnessMap,
    roughness: 0.42,
    metalness: 0.0,
    clearcoat: 0.62,
    clearcoatRoughness: 0.3,
    transmission: 0.0,
    transparent: true,
    opacity: 0.88,
  });

  icePlane = new THREE.Mesh(new THREE.PlaneGeometry(RINK.width, RINK.length, 24, 48), iceMaterial);
  icePlane.rotation.x = -Math.PI / 2;
  icePlane.receiveShadow = true;
  scene.add(icePlane);

  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(RINK.width * 0.98, RINK.length * 0.98),
    new THREE.MeshBasicMaterial({ color: 0x2b8aa4, transparent: true, opacity: 0.016, blending: THREE.AdditiveBlending })
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.018;
  scene.add(glow);

  createIceRails();
}

function createIceRails() {
  const colors = [0x55f7ff, 0xff3df5, 0xffe16b];
  for (let i = 0; i < 18; i += 1) {
    const mat = new THREE.MeshBasicMaterial({
      color: colors[i % colors.length],
      transparent: true,
      opacity: 0.025,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const rail = new THREE.Mesh(new THREE.PlaneGeometry(0.035 + Math.random() * 0.025, RINK.length * (0.42 + Math.random() * 0.52)), mat);
    rail.rotation.x = -Math.PI / 2;
    rail.position.set(-RINK.halfW + 1.8 + Math.random() * (RINK.width - 3.6), 0.031, (Math.random() - 0.5) * 8);
    rail.userData.phase = Math.random() * Math.PI * 2;
    rail.userData.base = mat.opacity;
    iceRails.push(rail);
    scene.add(rail);
  }
}

function makeIceTextures() {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  const gradient = ctx.createLinearGradient(0, 0, size, size);
  gradient.addColorStop(0, '#183246');
  gradient.addColorStop(0.45, '#4f7e95');
  gradient.addColorStop(1, '#223f50');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < 900; i += 1) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const len = 12 + Math.random() * 150;
    const angle = (Math.random() * 0.6 - 0.3) + (Math.random() > 0.5 ? 0 : Math.PI / 2);
    ctx.strokeStyle = `rgba(226,246,255,${0.018 + Math.random() * 0.055})`;
    ctx.lineWidth = Math.random() * 1.3 + 0.25;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
    ctx.stroke();
  }

  ctx.globalCompositeOperation = 'multiply';
  for (let i = 0; i < 70; i += 1) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 20 + Math.random() * 120;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(7, 21, 34, 0.16)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;

  const rough = document.createElement('canvas');
  rough.width = size;
  rough.height = size;
  const rctx = rough.getContext('2d');
  rctx.fillStyle = '#777';
  rctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 1200; i += 1) {
    rctx.strokeStyle = `rgba(${160 + Math.random() * 95},${160 + Math.random() * 95},${160 + Math.random() * 95},${0.08 + Math.random() * 0.25})`;
    rctx.lineWidth = Math.random() * 2 + 0.5;
    rctx.beginPath();
    const x = Math.random() * size;
    const y = Math.random() * size;
    rctx.moveTo(x, y);
    rctx.lineTo(x + (Math.random() - 0.5) * 240, y + (Math.random() - 0.5) * 45);
    rctx.stroke();
  }
  const roughnessMap = new THREE.CanvasTexture(rough);
  roughnessMap.anisotropy = 8;

  return { map, roughnessMap };
}

function createRinkLines() {
  const red = new THREE.MeshBasicMaterial({ color: 0xb51d31, transparent: true, opacity: 0.58 });
  const blue = new THREE.MeshBasicMaterial({ color: 0x1858b8, transparent: true, opacity: 0.54 });
  const white = new THREE.MeshBasicMaterial({ color: 0xb9d2db, transparent: true, opacity: 0.28 });
  const cyan = new THREE.MeshBasicMaterial({ color: 0x3cc8df, transparent: true, opacity: 0.34 });

  addIceStripe(RINK.width * 0.96, 0.16, 0, 0, red);
  addIceStripe(RINK.width * 0.96, 0.22, 0, -10.3, blue);
  addIceStripe(RINK.width * 0.96, 0.22, 0, 10.3, blue);
  addIceStripe(RINK.width * 0.84, 0.12, 0, -RINK.goalLine, red);
  addIceStripe(RINK.width * 0.84, 0.12, 0, RINK.goalLine, red);

  addIceStripe(0.12, RINK.length * 0.9, -RINK.halfW + 1.1, 0, white);
  addIceStripe(0.12, RINK.length * 0.9, RINK.halfW - 1.1, 0, white);

  addCircle(0, 0, 3.4, 0.06, red, 0.66);
  addCircle(-7.2, -18, 2.55, 0.055, red, 0.58);
  addCircle(7.2, -18, 2.55, 0.055, red, 0.58);
  addCircle(-7.2, 18, 2.55, 0.055, red, 0.58);
  addCircle(7.2, 18, 2.55, 0.055, red, 0.58);
  addCircle(0, 0, 0.35, 0.08, cyan, 0.9);

  const logo = createLogoTexture();
  const logoMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(8.6, 4.2),
    new THREE.MeshBasicMaterial({ map: logo, transparent: true, opacity: 0.42, blending: THREE.NormalBlending })
  );
  logoMesh.rotation.x = -Math.PI / 2;
  logoMesh.position.y = 0.024;
  scene.add(logoMesh);
}

function addIceStripe(width, depth, x, z, material) {
  const stripe = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), material);
  stripe.rotation.x = -Math.PI / 2;
  stripe.position.set(x, 0.022, z);
  scene.add(stripe);
}

function addCircle(x, z, radius, tube, material, opacity) {
  const mat = material.clone();
  mat.opacity = opacity;
  const ring = new THREE.Mesh(new THREE.RingGeometry(radius - tube, radius + tube, 96), mat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, 0.025, z);
  scene.add(ring);
}

function createLogoTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(5, 14, 26, 0.35)';
  roundRect(ctx, 150, 118, 724, 276, 52);
  ctx.fill();
  ctx.strokeStyle = 'rgba(94, 247, 255, 0.85)';
  ctx.lineWidth = 8;
  ctx.stroke();
  ctx.font = '900 144px Arial Black, Impact, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#effcff';
  ctx.shadowColor = '#55f7ff';
  ctx.shadowBlur = 28;
  ctx.fillText('1V1', 512, 220);
  ctx.font = '900 48px Arial Black, Impact, sans-serif';
  ctx.fillStyle = '#ff3df5';
  ctx.shadowColor = '#ff3df5';
  ctx.fillText('NEON ICE', 512, 306);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function createBoardsAndGlass() {
  const boardMat = new THREE.MeshStandardMaterial({ color: 0x8fa0aa, roughness: 0.46, metalness: 0.02 });
  const yellowMat = new THREE.MeshStandardMaterial({ color: 0xb58e27, roughness: 0.38, emissive: 0x201000, emissiveIntensity: 0.04 });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x5fb4cf,
    roughness: 0.12,
    metalness: 0,
    transparent: true,
    opacity: 0.12,
    transmission: 0.16,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    side: THREE.DoubleSide,
  });

  addBox(new THREE.BoxGeometry(0.52, 0.9, RINK.length + 1.2), boardMat, -RINK.halfW - 0.36, 0.45, 0, true);
  addBox(new THREE.BoxGeometry(0.52, 0.9, RINK.length + 1.2), boardMat, RINK.halfW + 0.36, 0.45, 0, true);
  addBox(new THREE.BoxGeometry(RINK.width + 1.2, 0.9, 0.52), boardMat, 0, 0.45, -RINK.halfL - 0.36, true);
  addBox(new THREE.BoxGeometry(RINK.width + 1.2, 0.9, 0.52), boardMat, 0, 0.45, RINK.halfL + 0.36, true);

  addBox(new THREE.BoxGeometry(0.58, 0.16, RINK.length + 1.2), yellowMat, -RINK.halfW - 0.34, 0.1, 0, false);
  addBox(new THREE.BoxGeometry(0.58, 0.16, RINK.length + 1.2), yellowMat, RINK.halfW + 0.34, 0.1, 0, false);
  addBox(new THREE.BoxGeometry(RINK.width + 1.2, 0.16, 0.58), yellowMat, 0, 0.1, -RINK.halfL - 0.34, false);
  addBox(new THREE.BoxGeometry(RINK.width + 1.2, 0.16, 0.58), yellowMat, 0, 0.1, RINK.halfL + 0.34, false);

  addBox(new THREE.BoxGeometry(0.18, 1.72, RINK.length + 0.4), glassMat, -RINK.halfW - 0.43, 1.78, 0, false);
  addBox(new THREE.BoxGeometry(0.18, 1.72, RINK.length + 0.4), glassMat, RINK.halfW + 0.43, 1.78, 0, false);
  addBox(new THREE.BoxGeometry(RINK.width + 0.4, 1.72, 0.18), glassMat, 0, 1.78, -RINK.halfL - 0.43, false);
  addBox(new THREE.BoxGeometry(RINK.width + 0.4, 1.72, 0.18), glassMat, 0, 1.78, RINK.halfL + 0.43, false);

  const adMatA = new THREE.MeshStandardMaterial({ color: 0x041323, emissive: 0x007a90, emissiveIntensity: 0.14, roughness: 0.44 });
  const adMatB = new THREE.MeshStandardMaterial({ color: 0x160514, emissive: 0x8a1685, emissiveIntensity: 0.12, roughness: 0.44 });
  for (let z = -24; z <= 24; z += 8) {
    addBox(new THREE.BoxGeometry(0.04, 0.42, 4.8), z % 16 === 0 ? adMatA : adMatB, -RINK.halfW - 0.64, 0.62, z, false);
    addBox(new THREE.BoxGeometry(0.04, 0.42, 4.8), z % 16 === 0 ? adMatB : adMatA, RINK.halfW + 0.64, 0.62, z, false);
  }
}

function addBox(geometry, material, x, y, z, shadows) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = shadows;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

function createGoals() {
  makeGoal(-RINK.goalLine, -1, TEAM.rival);
  makeGoal(RINK.goalLine, 1, TEAM.player);
}

function createSkillTarget() {
  const group = new THREE.Group();
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffe16b, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending });
  const coreMat = new THREE.MeshBasicMaterial({ color: 0x55f7ff, transparent: true, opacity: 0.34, blending: THREE.AdditiveBlending });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.035, 12, 72), ringMat);
  ring.name = 'target-ring';
  group.add(ring);

  const core = new THREE.Mesh(new THREE.CircleGeometry(0.48, 48), coreMat);
  core.name = 'target-core';
  group.add(core);

  const horizontal = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.035, 0.02), ringMat.clone());
  const vertical = new THREE.Mesh(new THREE.BoxGeometry(0.035, 1.35, 0.02), ringMat.clone());
  group.add(horizontal, vertical);

  const light = new THREE.PointLight(0xffe16b, 7, 6, 2);
  light.position.set(0, 0, 0.2);
  group.add(light);

  skillTarget = {
    group,
    x: 0,
    y: 1.12,
    cycle: 0,
    spots: [-2.55, -1.25, 0, 1.25, 2.55],
  };
  scene.add(group);
  moveSkillTarget(true);
}

function moveSkillTarget(force = false) {
  if (!skillTarget) return;
  const oldX = skillTarget.x;
  let next = oldX;
  let attempts = 0;
  do {
    next = skillTarget.spots[Math.floor(Math.random() * skillTarget.spots.length)];
    attempts += 1;
  } while (!force && Math.abs(next - oldX) < 0.2 && attempts < 12);
  skillTarget.x = next;
  skillTarget.y = 0.92 + Math.random() * 0.64;
  skillTarget.cycle = 5.5 + Math.random() * 3;
  skillTarget.group.position.set(skillTarget.x, skillTarget.y, -RINK.goalLine + 0.06);
}

function updateSkillTarget(dt) {
  if (!skillTarget) return;
  skillTarget.cycle -= dt;
  if (skillTarget.cycle <= 0) moveSkillTarget();
  const pulse = 1 + Math.sin(clock.elapsedTime * 7.5) * 0.12;
  skillTarget.group.scale.setScalar(pulse);
  skillTarget.group.rotation.z = Math.sin(clock.elapsedTime * 2.1) * 0.12;
  skillTarget.group.visible = state.running && !state.gameOver;
}

function makeGoal(goalZ, dir, accent) {
  const group = new THREE.Group();
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xff243e, emissive: 0x8f0012, emissiveIntensity: 0.45, roughness: 0.24, metalness: 0.15 });
  const netMat = new THREE.MeshBasicMaterial({ color: 0xeafcff, transparent: true, opacity: 0.2, wireframe: true });
  const postGeo = new THREE.CylinderGeometry(0.075, 0.075, 1.55, 20);
  const barGeo = new THREE.CylinderGeometry(0.072, 0.072, RINK.goalWidth, 20);
  const depthGeo = new THREE.CylinderGeometry(0.045, 0.045, 1.55, 12);

  const leftPost = new THREE.Mesh(postGeo, frameMat);
  leftPost.position.set(-RINK.goalWidth / 2, 0.78, goalZ);
  const rightPost = new THREE.Mesh(postGeo, frameMat);
  rightPost.position.set(RINK.goalWidth / 2, 0.78, goalZ);
  const cross = new THREE.Mesh(barGeo, frameMat);
  cross.rotation.z = Math.PI / 2;
  cross.position.set(0, 1.55, goalZ);
  group.add(leftPost, rightPost, cross);

  const back = new THREE.Mesh(barGeo, frameMat);
  back.rotation.z = Math.PI / 2;
  back.position.set(0, 1.2, goalZ + dir * 1.45);
  group.add(back);

  for (const x of [-RINK.goalWidth / 2, RINK.goalWidth / 2]) {
    const topRail = new THREE.Mesh(depthGeo, frameMat);
    topRail.rotation.x = Math.PI / 2;
    topRail.position.set(x, 1.28, goalZ + dir * 0.72);
    group.add(topRail);
  }

  const net = new THREE.Mesh(new THREE.BoxGeometry(RINK.goalWidth, 1.5, 1.55, 8, 4, 6), netMat);
  net.position.set(0, 0.78, goalZ + dir * 0.78);
  group.add(net);

  const creaseMat = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.13, blending: THREE.AdditiveBlending });
  const crease = new THREE.Mesh(new THREE.CircleGeometry(4.15, 64, 0, Math.PI), creaseMat);
  crease.rotation.x = -Math.PI / 2;
  crease.rotation.z = dir > 0 ? Math.PI : 0;
  crease.position.set(0, 0.028, goalZ - dir * 0.02);
  group.add(crease);

  const light = new THREE.PointLight(accent, 14, 10, 2);
  light.position.set(0, 1.8, goalZ + dir * 1.6);
  group.add(light);

  group.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  scene.add(group);
}

function createGoalies() {
  buildGoalie('rival', goalies.rival.z, TEAM.rival, 0x270711);
  buildGoalie('player', goalies.player.z, TEAM.player, 0x041b25);
}

function buildGoalie(key, z, accent, darkColor) {
  const goalie = goalies[key];
  const group = new THREE.Group();
  goalie.group = group;

  const jerseyMat = new THREE.MeshStandardMaterial({ color: darkColor, emissive: accent, emissiveIntensity: 0.18, roughness: 0.46, metalness: 0.02 });
  const padMat = new THREE.MeshStandardMaterial({ color: 0xc8d4da, roughness: 0.5, metalness: 0.03, emissive: accent, emissiveIntensity: 0.05 });
  const cageMat = new THREE.MeshStandardMaterial({ color: 0x09111b, roughness: 0.36, metalness: 0.18 });
  const glowMat = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.42, blending: THREE.AdditiveBlending });

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.44, 0.58, 8, 16), jerseyMat);
  torso.position.y = 1.02;
  torso.scale.set(1.18, 1, 0.8);
  torso.castShadow = true;
  group.add(torso);

  const mask = new THREE.Mesh(new THREE.SphereGeometry(0.27, 24, 14), padMat);
  mask.position.y = 1.72;
  mask.castShadow = true;
  group.add(mask);

  const cage = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.01, 8, 30), cageMat);
  cage.position.set(0, 1.72, goalie.dir * -0.21);
  cage.rotation.x = Math.PI / 2;
  group.add(cage);

  for (const x of [-0.34, 0.34]) {
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.72, 0.18), padMat);
    pad.position.set(x, 0.42, goalie.dir * -0.08);
    pad.rotation.z = x > 0 ? -0.08 : 0.08;
    pad.castShadow = true;
    group.add(pad);

    const skate = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, 0.48), cageMat);
    skate.position.set(x, 0.07, goalie.dir * -0.16);
    skate.castShadow = true;
    group.add(skate);
  }

  const glove = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.28, 0.24), padMat);
  glove.position.set(-0.72, 1.04, goalie.dir * -0.22);
  glove.rotation.z = 0.26;
  glove.castShadow = true;
  group.add(glove);

  const blocker = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.46, 0.16), padMat);
  blocker.position.set(0.72, 0.98, goalie.dir * -0.24);
  blocker.rotation.z = -0.2;
  blocker.castShadow = true;
  group.add(blocker);

  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.024, 1.25, 10), cageMat);
  stick.position.set(0.82, 0.48, goalie.dir * -0.55);
  stick.rotation.set(0.78 * goalie.dir, 0.12, -0.34);
  stick.castShadow = true;
  group.add(stick);

  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.055, 0.14), cageMat);
  blade.position.set(0.75, 0.08, goalie.dir * -0.95);
  blade.castShadow = true;
  group.add(blade);

  const creaseGlow = new THREE.Mesh(new THREE.CircleGeometry(2.25, 60), glowMat);
  creaseGlow.rotation.x = -Math.PI / 2;
  creaseGlow.position.set(0, 0.032, 0);
  group.add(creaseGlow);

  const light = new THREE.PointLight(accent, 0.9, 3.6, 2);
  light.position.set(0, 1.1, goalie.dir * -0.25);
  group.add(light);

  group.position.set(goalie.x, 0, z);
  group.rotation.y = goalie.dir > 0 ? 0 : Math.PI;
  group.traverse((child) => {
    if (child.isMesh) {
      child.receiveShadow = true;
      child.userData.homeY = child.position.y;
    }
  });
  scene.add(group);
}

function updateGoalies(dt) {
  for (const key of Object.keys(goalies)) {
    const goalie = goalies[key];
    if (!goalie.group) continue;
    goalie.recovery = Math.max(0, goalie.recovery - dt);
    goalie.saveFlash = Math.max(0, goalie.saveFlash - dt);

    const puckComing = key === 'rival' ? puck.vel.y < -2 || puck.pos.y < -8 : puck.vel.y > 2 || puck.pos.y > 8;
    const lead = puckComing ? puck.vel.x * 0.16 : 0;
    const targetX = clamp(puck.pos.x + lead, -RINK.goalWidth / 2 + 0.55, RINK.goalWidth / 2 - 0.55);
    const homeBias = key === 'rival' && state.possession === 'player' ? 1 : key === 'player' && state.possession === 'ai' ? 1 : 0.42;
    const wantedX = lerp(0, targetX, homeBias);
    const maxStep = (goalie.recovery > 0 ? 2.6 : 6.4) * dt;
    goalie.x += clamp(wantedX - goalie.x, -maxStep, maxStep);

    goalie.group.position.x = goalie.x;
    goalie.group.position.y = Math.sin(clock.elapsedTime * 8 + (key === 'rival' ? 0 : 1.7)) * 0.015 + goalie.saveFlash * 0.08;
    goalie.group.children.forEach((child, index) => {
      if (!child.isMesh) return;
      const homeY = child.userData.homeY ?? child.position.y;
      child.position.y = homeY + goalie.saveFlash * (index % 2 === 0 ? 0.06 : 0.025);
    });
  }
}

function tryGoalieSave(key, before, speed) {
  const goalie = goalies[key];
  if (!goalie || !goalie.group || goalie.recovery > 0.22) return false;
  const crossed = key === 'rival'
    ? before.y > goalie.z && puck.pos.y <= goalie.z
    : before.y < goalie.z && puck.pos.y >= goalie.z;
  if (!crossed || Math.abs(puck.pos.x) > RINK.goalWidth / 2 + 0.45) return false;

  const targetSnipe = key === 'rival' && skillTarget && Math.abs(puck.pos.x - skillTarget.x) < 0.68 && Math.abs(puck.air - skillTarget.y) < 0.62 && speed > 24;
  const lateral = Math.abs(puck.pos.x - goalie.x);
  const highShot = puck.air > 0.82;
  const bodySave = lateral < (highShot ? 0.7 : 0.92) && puck.air < 1.62;
  const padSave = !highShot && lateral < 1.62;
  const gloveSave = highShot && lateral < 1.22 && Math.random() < 0.48 - clamp((speed - 24) / 44, 0, 0.18);
  const desperationSave = !highShot && lateral < 2.25 && Math.random() < 0.46 - clamp((speed - 22) / 38, 0, 0.22);
  if (targetSnipe && lateral > 0.58) return false;
  if (!bodySave && !padSave && !gloveSave && !desperationSave) return false;

  const reboundDir = key === 'rival' ? 1 : -1;
  puck.pos.y = goalie.z + reboundDir * 0.34;
  puck.pos.x = clamp(puck.pos.x, -RINK.goalWidth / 2 + 0.12, RINK.goalWidth / 2 - 0.12);
  puck.vel.y = Math.abs(puck.vel.y) * reboundDir * (0.46 + Math.random() * 0.2);
  puck.vel.x += (puck.pos.x - goalie.x) * (2.4 + Math.random() * 2.4) + (Math.random() - 0.5) * 2.1;
  puck.vel.multiplyScalar(0.72);
  puck.airVel = highShot ? -Math.abs(puck.airVel) * 0.18 : 0.7 + Math.random() * 1.1;
  puck.air = Math.max(0.05, puck.air * 0.42);
  state.possession = null;
  state.possessionGrace = 0.38;
  goalie.saveFlash = 0.38;
  goalie.recovery = 0.42;
  goalie.saveCount += 1;
  state.lastShotLabel = key === 'rival' ? 'Goalie save' : 'Your goalie save';
  state.momentum = clamp(state.momentum + (key === 'rival' ? -0.16 : 0.12), -1, 1);
  spray(new THREE.Vector3(puck.pos.x, 0.32, goalie.z), 34, key === 'rival' ? TEAM.rival : TEAM.player, 1.7);
  state.cameraShake = Math.max(state.cameraShake, 0.08);
  showToast(key === 'rival' ? 'Goalie got a piece — chase the rebound.' : 'Your goalie bails you out. Go counter.', 1500);
  playTone(210, 0.08, 'square', 0.035);
  playTone(118, 0.12, 'triangle', 0.026, 0.03);
  return true;
}

function createCrowd() {
  const standMat = new THREE.MeshStandardMaterial({ color: 0x071021, roughness: 0.82, metalness: 0.04 });
  for (let tier = 0; tier < 5; tier += 1) {
    const y = 1.08 + tier * 0.42;
    const offset = RINK.halfW + 2.3 + tier * 0.92;
    const geo = new THREE.BoxGeometry(1.1, 0.3, RINK.length + 7);
    addBox(geo, standMat, -offset, y, 0, false);
    addBox(geo, standMat, offset, y, 0, false);
  }

  const colors = [0x55f7ff, 0xff3df5, 0xffe16b, 0xffffff, 0x6cff85];
  const seatGeo = new THREE.BoxGeometry(0.18, 0.34, 0.18);
  colors.forEach((color) => {
    crowdMats.push(new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, roughness: 0.5 }));
  });

  const countPerMat = 90;
  crowdMats.forEach((mat, matIndex) => {
    const mesh = new THREE.InstancedMesh(seatGeo, mat, countPerMat);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < countPerMat; i += 1) {
      const side = Math.random() > 0.5 ? 1 : -1;
      const tier = Math.floor(Math.random() * 5);
      const x = side * (RINK.halfW + 2.1 + tier * 0.92 + Math.random() * 0.35);
      const y = 1.32 + tier * 0.42 + Math.random() * 0.24;
      const z = -RINK.halfL - 2 + Math.random() * (RINK.length + 4);
      matrix.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(1, 1 + Math.random() * 1.4, 1));
      mesh.setMatrixAt(i, matrix);
    }
    mesh.userData.phase = matIndex * 0.75;
    scene.add(mesh);
  });

  const ribbonMat = new THREE.MeshStandardMaterial({ color: 0x07152b, emissive: 0x00d5ff, emissiveIntensity: 0.58, roughness: 0.3 });
  addBox(new THREE.BoxGeometry(0.08, 0.54, RINK.length + 5), ribbonMat, -RINK.halfW - 1.15, 2.82, 0, false);
  addBox(new THREE.BoxGeometry(0.08, 0.54, RINK.length + 5), ribbonMat, RINK.halfW + 1.15, 2.82, 0, false);
}

function createCeiling() {
  const beamMat = new THREE.MeshStandardMaterial({ color: 0x081224, emissive: 0x010711, roughness: 0.6, metalness: 0.2 });
  for (let z = -30; z <= 30; z += 10) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(36, 0.18, 0.26), beamMat);
    beam.position.set(0, 8.25, z);
    scene.add(beam);
  }
  for (let x = -16; x <= 16; x += 8) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.18, 72), beamMat);
    beam.position.set(x, 8.05, 0);
    scene.add(beam);
  }
}

function createPuck() {
  puck.group = new THREE.Group();
  const puckMat = new THREE.MeshStandardMaterial({ color: 0x020204, roughness: 0.48, metalness: 0.04, emissive: 0x050607, emissiveIntensity: 0.5 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.16, 48), puckMat);
  body.castShadow = true;
  body.receiveShadow = true;
  puck.group.add(body);

  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(0.325, 0.018, 8, 56),
    new THREE.MeshBasicMaterial({ color: 0x55f7ff, transparent: true, opacity: 0.78 })
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.006;
  puck.group.add(rim);

  puck.group.position.set(puck.pos.x, 0.12, puck.pos.y);
  scene.add(puck.group);

  const trailGeo = new THREE.BufferGeometry();
  const trailPositions = new Float32Array(90 * 3);
  trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
  puckTrail = new THREE.Line(
    trailGeo,
    new THREE.LineBasicMaterial({ color: 0x8ffaff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending })
  );
  puckTrail.frustumCulled = false;
  scene.add(puckTrail);
}

function createAiSkater() {
  ai.group = new THREE.Group();
  const jersey = new THREE.MeshStandardMaterial({ color: 0x9b0b1d, emissive: 0xff1f46, emissiveIntensity: 0.22, roughness: 0.38, metalness: 0.05 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x080a12, roughness: 0.5, metalness: 0.15 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf8fbff, roughness: 0.38 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xd4fbff, emissive: 0x234b5b, emissiveIntensity: 0.18, roughness: 0.2, metalness: 0.55 });

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.72, 8, 16), jersey);
  torso.position.y = 1.0;
  torso.scale.set(1.05, 1.05, 0.82);
  torso.castShadow = true;
  ai.group.add(torso);

  const chestGlow = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.06, 0.04), new THREE.MeshBasicMaterial({ color: 0xffe16b }));
  chestGlow.position.set(0, 1.18, -0.35);
  ai.group.add(chestGlow);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 24, 16), white);
  head.position.y = 1.73;
  head.castShadow = true;
  ai.group.add(head);

  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.27, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), dark);
  helmet.position.y = 1.78;
  helmet.castShadow = true;
  ai.group.add(helmet);

  for (const x of [-0.22, 0.22]) {
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.48, 6, 10), dark);
    leg.position.set(x, 0.42, 0.03);
    leg.castShadow = true;
    ai.group.add(leg);

    const skate = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.07, 0.48), metal);
    skate.position.set(x, 0.08, -0.04);
    skate.castShadow = true;
    ai.group.add(skate);
  }

  for (const x of [-0.52, 0.52]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.095, 0.58, 6, 10), jersey);
    arm.position.set(x, 1.02, -0.04);
    arm.rotation.z = x > 0 ? -0.32 : 0.32;
    arm.castShadow = true;
    ai.group.add(arm);
  }

  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 1.8, 12), dark);
  stick.position.set(0.63, 0.55, -0.52);
  stick.rotation.set(0.78, 0.1, -0.36);
  stick.castShadow = true;
  ai.group.add(stick);

  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.07, 0.13), dark);
  blade.position.set(0.62, 0.08, -1.08);
  blade.rotation.y = -0.22;
  blade.castShadow = true;
  ai.group.add(blade);

  const markerLight = new THREE.PointLight(0xff2e4b, 2.5, 4, 2);
  markerLight.position.set(0, 1.4, 0);
  ai.group.add(markerLight);

  scene.add(ai.group);
}

function createPlayerStick() {
  playerStick = new THREE.Group();
  const shaftMat = new THREE.MeshStandardMaterial({ color: 0x151821, roughness: 0.32, metalness: 0.16 });
  const tapeMat = new THREE.MeshStandardMaterial({ color: 0xf3fbff, emissive: 0x1ea9ff, emissiveIntensity: 0.12, roughness: 0.52 });
  const gloveMat = new THREE.MeshStandardMaterial({ color: 0x033b52, emissive: 0x00dfff, emissiveIntensity: 0.18, roughness: 0.42 });

  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.034, 1.62, 14), shaftMat);
  shaft.position.set(0.42, -0.52, -0.92);
  shaft.rotation.set(-0.95, 0.05, 0.26);
  playerStick.add(shaft);

  const lowerShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.88, 14), tapeMat);
  lowerShaft.position.set(0.55, -0.84, -1.28);
  lowerShaft.rotation.set(-1.12, 0.08, 0.36);
  playerStick.add(lowerShaft);

  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.07, 0.16), tapeMat);
  blade.position.set(0.64, -1.09, -1.61);
  blade.rotation.set(0.06, -0.27, 0.04);
  playerStick.add(blade);

  playerGloveL = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.22, 0.32), gloveMat);
  playerGloveL.position.set(0.16, -0.42, -0.62);
  playerGloveL.rotation.set(0.2, -0.25, 0.2);
  playerStick.add(playerGloveL);

  playerGloveR = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.24, 0.34), gloveMat);
  playerGloveR.position.set(0.58, -0.68, -1.06);
  playerGloveR.rotation.set(0.42, -0.18, -0.1);
  playerStick.add(playerGloveR);

  const glow = new THREE.PointLight(0x55f7ff, 0.7, 3.5, 2);
  glow.position.set(0.65, -1, -1.5);
  playerStick.add(glow);

  camera.add(playerStick);

  for (let i = 0; i < 8; i += 1) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x7ff9ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending });
    const line = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.018, 1.4 + Math.random()), mat);
    line.position.set((Math.random() - 0.5) * 5, -0.2 + Math.random() * 1.2, -2.5 - Math.random() * 4);
    line.rotation.z = (Math.random() - 0.5) * 0.2;
    camera.add(line);
    speedLines.push(line);
  }
}

function createParticlePool() {
  const mat = new THREE.MeshBasicMaterial({ color: 0xe9ffff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending });
  const geo = new THREE.SphereGeometry(0.035, 8, 6);
  for (let i = 0; i < 180; i += 1) {
    const mesh = new THREE.Mesh(geo, mat.clone());
    mesh.visible = false;
    scene.add(mesh);
    particles.push({ mesh, vel: new THREE.Vector3(), life: 0, maxLife: 1 });
  }
}

function createAimHelpers() {
  clickTargetMarker = new THREE.Mesh(
    new THREE.RingGeometry(0.42, 0.52, 40),
    new THREE.MeshBasicMaterial({ color: 0xffe16b, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending })
  );
  clickTargetMarker.rotation.x = -Math.PI / 2;
  clickTargetMarker.position.y = 0.06;
  scene.add(clickTargetMarker);

  const aimGeo = new THREE.BufferGeometry();
  aimGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  aimLine = new THREE.Line(
    aimGeo,
    new THREE.LineBasicMaterial({ color: 0xffe16b, transparent: true, opacity: 0.82, blending: THREE.AdditiveBlending })
  );
  aimLine.frustumCulled = false;
  scene.add(aimLine);
}

function startMatch(mode) {
  resumeAudio();
  state.mode = mode;
  state.running = true;
  state.gameOver = false;
  state.playerScore = 0;
  state.rivalScore = 0;
  state.timeRemaining = 180;
  state.goalPause = 0;
  state.cameraShake = 0;
  state.cameraKick = 0;
  player.yaw = 0;
  player.pitch = -0.08;
  player.vel.set(0, 0);
  player.stamina = 1;
  state.momentum = 0;
  state.skillMultiplier = 1;
  state.shotStreak = 0;
  state.lastShotKmh = 0;
  state.lastShotLabel = 'Charge a shot';
  ai.cooldown = 0.8;
  ai.stun = 0;
  resetRound(true);
  startScreen.classList.add('hidden');
  endScreen.classList.add('hidden');
  hud.classList.remove('hidden');
  setModeVisuals();
  showToast(mode === 'simulation'
    ? 'Simulation on: click the ice if the cursor appears, then use mouse-look and hold-release LMB to rip shots.'
    : 'Click-to-shoot on: point at the ice or net with your cursor, then click or hold-release to fire.', 7000);
  if (mode === 'simulation') {
    requestPointerLock();
  } else if (document.pointerLockElement) {
    document.exitPointerLock();
  }
  playTone(220, 0.08, 'sawtooth', 0.045);
  playTone(440, 0.14, 'triangle', 0.035, 0.04);
}

function requestPointerLock() {
  renderer.domElement.requestPointerLock?.();
}

function setModeVisuals() {
  modePill.textContent = state.mode === 'simulation' ? 'SIMULATION' : 'CLICK TO SHOOT';
  clickTargetMarker.visible = state.mode === 'click' && state.running;
  aimLine.visible = state.mode === 'click' && state.running;
}

function resetRound(opening = false) {
  player.pos.set(0, 18);
  player.vel.set(0, 0);
  ai.pos.set(0, -8.5);
  ai.vel.set(0, 0);
  ai.yaw = Math.PI;
  for (const goalie of Object.values(goalies)) {
    goalie.x = 0;
    goalie.saveFlash = 0;
    goalie.recovery = 0;
    if (goalie.group) goalie.group.position.set(0, 0, goalie.z);
  }
  puck.pos.set(0, opening ? 16.2 : 0.2);
  puck.vel.set(0, 0);
  puck.spin = 0;
  puck.air = 0;
  puck.airVel = 0;
  puck.shotHigh = 0;
  state.possession = opening ? 'player' : null;
  state.possessionGrace = 0.35;
  mouse.charge = 0;
  mouse.charging = false;
  mouse.leftDown = false;
  moveSkillTarget(true);
  updatePuckMesh();
  updateAiMesh(0);
  seedTrail();
}

function onResize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
  composer.setSize(width, height);
  bloomPass.setSize(width, height);
}

function onKeyDown(event) {
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight', 'Space'].includes(event.code)) {
    event.preventDefault();
  }
  if (event.code === 'KeyM' && state.running) {
    toggleMode();
    return;
  }
  if (event.code === 'KeyR' && state.running) {
    resetRound(false);
    showToast('Puck reset for a fresh rush.', 1800);
    return;
  }
  if (event.code === 'KeyE' && state.running) {
    tryPokeCheck();
  }
  keys.add(event.code);
}

function toggleMode() {
  state.mode = state.mode === 'simulation' ? 'click' : 'simulation';
  setModeVisuals();
  if (state.mode === 'simulation') {
    requestPointerLock();
    showToast('Simulation mode: pointer locked. Mouse-look is live.', 2600);
  } else {
    if (document.pointerLockElement) document.exitPointerLock();
    showToast('Click-to-shoot mode: cursor aim is live.', 2600);
  }
}

function onMouseMove(event) {
  if (state.mode === 'simulation' && document.pointerLockElement === renderer.domElement) {
    const mx = event.movementX || 0;
    const my = event.movementY || 0;
    const magnitude = Math.hypot(mx, my);
    player.yaw -= mx * 0.0022;
    player.pitch = clamp(player.pitch - my * 0.00165, -0.82, 0.34);
    mouse.flick = Math.max(mouse.flick, magnitude / 0.016);
    mouse.movementAccumulator += magnitude;
    return;
  }

  mouse.ndc.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.ndc.y = -(event.clientY / window.innerHeight) * 2 + 1;

  if (state.mode === 'click') {
    player.yaw = damp(player.yaw, mouse.ndc.x * 0.72, 2.4, 0.016);
  }
}

function onMouseDown(event) {
  if (!state.running || state.gameOver) return;
  if (state.mode === 'simulation' && document.pointerLockElement !== renderer.domElement) {
    requestPointerLock();
    return;
  }
  if (event.button === 0) {
    mouse.leftDown = true;
    mouse.charging = true;
    mouse.chargeStart = clock.elapsedTime;
    mouse.charge = 0;
    shotEl.textContent = 'charging';
  }
  if (event.button === 2) {
    mouse.draggingPuck = true;
    showToast('Soft hands: puck drag/deke active.', 900);
  }
}

function onMouseUp(event) {
  if (event.button === 0 && mouse.charging) {
    shootPuck();
    mouse.leftDown = false;
    mouse.charging = false;
    mouse.charge = 0;
  }
  if (event.button === 2) {
    mouse.draggingPuck = false;
  }
}

function onPointerLockChange() {
  if (!state.running || state.mode !== 'simulation') return;
  if (document.pointerLockElement === renderer.domElement) {
    showToast('Mouse locked. Skate, aim, charge, release. Go bar down.', 2600);
  } else {
    showToast('Mouse unlocked. Click back into the rink to keep playing simulation mode.', 3600);
  }
}

function animate() {
  animationFrameId = requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.033);
  update(dt);
  composer.render();
}

function update(dt) {
  if (!state.running) {
    player.yaw += dt * 0.08;
    player.pitch = -0.16 + Math.sin(clock.elapsedTime * 0.6) * 0.03;
    updateCamera(dt, true);
    updateCrowd(dt);
    return;
  }

  if (!state.gameOver) {
    state.timeRemaining = Math.max(0, state.timeRemaining - dt);
    state.momentum = damp(state.momentum, 0, 0.06, dt);
    state.skillMultiplier = damp(state.skillMultiplier, 1, 0.035, dt);
    if (state.timeRemaining <= 0) {
      finishGame();
    }
  }

  updateMouseCharge(dt);
  updatePlayer(dt);
  updateAi(dt);
  updateGoalies(dt);
  updatePuck(dt);
  updateCamera(dt);
  updatePlayerStick(dt);
  updateParticles(dt);
  updateTrail();
  updateAimHelpers();
  updateSkillTarget(dt);
  updateCrowd(dt);
  updateHud();
}

function updateMouseCharge(dt) {
  mouse.flick = damp(mouse.flick, 0, 6.5, dt);
  mouse.movementAccumulator = damp(mouse.movementAccumulator, 0, 2.2, dt);
  if (mouse.charging) {
    const held = clock.elapsedTime - mouse.chargeStart;
    mouse.charge = clamp(held / 1.05, 0, 1);
    if (mouse.charge >= 1) {
      state.cameraShake = Math.max(state.cameraShake, 0.04 + Math.sin(clock.elapsedTime * 36) * 0.01);
    }
  }
}

function updatePlayer(dt) {
  const forward = getPlayerForward();
  const right = getPlayerRight();
  const input = new THREE.Vector2(0, 0);
  if (keys.has('KeyW')) input.add(forward);
  if (keys.has('KeyS')) input.sub(forward);
  if (keys.has('KeyD')) input.add(right);
  if (keys.has('KeyA')) input.sub(right);

  const hasInput = input.lengthSq() > 0.001;
  if (hasInput) input.normalize();

  const wantsSprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
  const braking = keys.has('Space');
  const sprinting = wantsSprint && hasInput && player.stamina > 0.06;
  player.stamina = clamp(
    player.stamina + (sprinting ? -0.23 : braking ? 0.21 : 0.145) * dt,
    0,
    1
  );
  const fatigue = lerp(0.76, 1, player.stamina);
  const maxSpeed = sprinting ? 14.9 * fatigue : 10.4 * lerp(0.88, 1, player.stamina);
  const accel = sprinting ? 26 * fatigue : 19 * lerp(0.9, 1, player.stamina);

  if (hasInput) {
    player.vel.addScaledVector(input, accel * dt);
  }

  const speed = player.vel.length();
  if (speed > maxSpeed) player.vel.multiplyScalar(maxSpeed / speed);

  const friction = braking ? 5.8 : hasInput ? 0.58 : 1.02;
  player.vel.multiplyScalar(Math.exp(-friction * dt));

  player.pos.addScaledVector(player.vel, dt);

  if (player.pos.x < -RINK.wallX + 0.6) {
    player.pos.x = -RINK.wallX + 0.6;
    player.vel.x = Math.abs(player.vel.x) * 0.22;
    boardImpact(new THREE.Vector3(player.pos.x, 0.08, player.pos.y));
  } else if (player.pos.x > RINK.wallX - 0.6) {
    player.pos.x = RINK.wallX - 0.6;
    player.vel.x = -Math.abs(player.vel.x) * 0.22;
    boardImpact(new THREE.Vector3(player.pos.x, 0.08, player.pos.y));
  }

  if (player.pos.y < -RINK.wallZ + 1.8) {
    player.pos.y = -RINK.wallZ + 1.8;
    player.vel.y = Math.abs(player.vel.y) * 0.16;
  } else if (player.pos.y > RINK.wallZ - 1.8) {
    player.pos.y = RINK.wallZ - 1.8;
    player.vel.y = -Math.abs(player.vel.y) * 0.16;
  }

  player.bob += dt * (2.5 + player.vel.length() * 1.25);
  player.sprintHeat = damp(player.sprintHeat, sprinting && hasInput ? 1 : 0, 5, dt);
  if (sprinting && Math.random() < dt * 5.5) {
    spray(new THREE.Vector3(player.pos.x, 0.07, player.pos.y), 2, TEAM.ice, 0.5);
  }
  player.stealCooldown = Math.max(0, player.stealCooldown - dt);
}

function updateAi(dt) {
  ai.cooldown = Math.max(0, ai.cooldown - dt);
  ai.stun = Math.max(0, ai.stun - dt);
  ai.dekeClock += dt;
  const pressure = clamp((state.playerScore - state.rivalScore) * 0.08 + (180 - state.timeRemaining) / 180 * 0.12, -0.05, 0.34);
  ai.aggression = damp(ai.aggression, 0.66 + pressure - state.momentum * 0.06, 0.65, dt);

  const desired = new THREE.Vector2();
  const puckPos = puck.pos;
  const toPuck = tmpVec2.copy(puckPos).sub(ai.pos);
  const distToPuck = toPuck.length();
  const toPlayer = tmpVec2B.copy(player.pos).sub(ai.pos);

  if (state.goalPause > 0 || state.gameOver) {
    desired.set(0, 0);
  } else if (state.possession === 'ai') {
    const laneX = Math.sin(ai.dekeClock * 2.8) * 2.5 + Math.sin(ai.dekeClock * 6.2) * 0.65;
    desired.set(laneX, RINK.goalLine - 3.6).sub(ai.pos);
    if (ai.pos.y > 12.8 && ai.cooldown <= 0) {
      aiShoot();
    }
  } else if (state.possession === 'player') {
    const defendSpot = tmpVec2.copy(player.pos).lerp(new THREE.Vector2(0, -RINK.goalLine + 2.5), 0.55);
    defendSpot.x += Math.sin(clock.elapsedTime * 1.8) * 1.2;
    desired.copy(defendSpot).sub(ai.pos);
    if (toPlayer.length() < 2.2 && ai.cooldown <= 0 && state.possessionGrace <= 0) {
      stealFromPlayer();
    }
  } else {
    const futurePuck = tmpVec2.copy(puck.pos).addScaledVector(puck.vel, 0.2);
    desired.copy(futurePuck).sub(ai.pos);
    if (distToPuck < 1.24 && puck.vel.length() < 28) {
      state.possession = 'ai';
      ai.cooldown = 0.9;
      showToast('Rival wins the puck — backcheck!', 1800);
    }
  }

  const desiredLength = desired.length();
  if (desiredLength > 0.05 && ai.stun <= 0) {
    desired.normalize();
    const maxSpeed = state.possession === 'ai' ? 9.4 : 10.7;
    ai.vel.addScaledVector(desired, (state.possession === 'player' ? 18 : 15) * dt * ai.aggression);
    const speed = ai.vel.length();
    if (speed > maxSpeed) ai.vel.multiplyScalar(maxSpeed / speed);
  }

  ai.vel.multiplyScalar(Math.exp((ai.stun > 0 ? -3.5 : -0.86) * dt));
  ai.pos.addScaledVector(ai.vel, dt);
  ai.pos.x = clamp(ai.pos.x, -RINK.wallX + 0.75, RINK.wallX - 0.75);
  ai.pos.y = clamp(ai.pos.y, -RINK.wallZ + 1.4, RINK.wallZ - 1.4);

  if (ai.vel.lengthSq() > 0.02) {
    ai.yaw = Math.atan2(ai.vel.x, -ai.vel.y);
  }

  if (state.possession === 'ai') {
    const forward = getAiForward();
    const right = getAiRight();
    puck.pos.copy(ai.pos).addScaledVector(forward, 1.05).addScaledVector(right, -0.34 + Math.sin(ai.dekeClock * 8) * 0.18);
    puck.vel.copy(ai.vel);
    puck.air = 0;
    puck.airVel = 0;
  }

  updateAiMesh(dt);
}

function updateAiMesh(dt) {
  if (!ai.group) return;
  ai.group.position.set(ai.pos.x, 0, ai.pos.y);
  ai.group.rotation.y = dampAngle(ai.group.rotation.y, ai.yaw, 7.5, dt || 0.016);

  const stride = Math.sin(clock.elapsedTime * (7 + ai.vel.length() * 0.55)) * Math.min(0.18, ai.vel.length() * 0.018);
  ai.group.children.forEach((child, index) => {
    if (child.isMesh && index > 4) {
      child.rotation.x += Math.sin(clock.elapsedTime * 3 + index) * 0.0007;
    }
  });
  ai.group.position.y = Math.abs(stride) * 0.08;
}

function updatePuck(dt) {
  state.possessionGrace = Math.max(0, state.possessionGrace - dt);

  if (state.goalPause > 0) {
    state.goalPause -= dt;
    if (state.goalPause <= 0) resetRound(false);
    updatePuckMesh();
    return;
  }

  if (state.possession === 'player') {
    const stick = getPlayerStickPosition2D();
    const handDeke = Math.sin(clock.elapsedTime * 10) * 0.08 * (mouse.draggingPuck ? 2 : 1);
    const right = getPlayerRight();
    puck.pos.copy(stick).addScaledVector(right, handDeke);
    puck.vel.copy(player.vel);
    puck.air = damp(puck.air, 0, 18, dt);
    puck.airVel = 0;

    if (ai.pos.distanceTo(player.pos) < 1.36 && ai.cooldown <= 0 && state.possessionGrace <= 0) {
      stealFromPlayer();
    }
  } else if (state.possession === null) {
    const before = puck.pos.clone();
    puck.pos.addScaledVector(puck.vel, dt);
    puck.vel.multiplyScalar(Math.exp(-1.15 * dt));
    puck.airVel -= 7.8 * dt;
    puck.air += puck.airVel * dt;
    if (puck.air <= 0) {
      if (puck.airVel < -2.2 && puck.vel.length() > 8) {
        spray(new THREE.Vector3(puck.pos.x, 0.08, puck.pos.y), 10, 0xdffcff, 0.8);
      }
      puck.air = 0;
      puck.airVel = Math.abs(puck.airVel) > 2.2 ? -puck.airVel * 0.16 : 0;
      puck.shotHigh *= 0.7;
    }
    puck.spin += puck.vel.length() * dt * (puck.air > 0.05 ? 8.5 : 5.5);

    handlePuckCollisions(before);
    checkLoosePuckPickup();
  }

  if (state.goalPause <= 0) {
    if (puck.pos.y < -RINK.goalLine && Math.abs(puck.pos.x) < RINK.goalWidth / 2) {
      scoreGoal('player');
    } else if (puck.pos.y > RINK.goalLine && Math.abs(puck.pos.x) < RINK.goalWidth / 2) {
      scoreGoal('rival');
    }
  }

  updatePuckMesh();
}

function handlePuckCollisions(before) {
  const speed = puck.vel.length();
  if (tryGoalieSave('rival', before, speed) || tryGoalieSave('player', before, speed)) {
    return;
  }
  if (puck.pos.y < -RINK.goalLine && Math.abs(puck.pos.x) < RINK.goalWidth / 2 && puck.air < 1.58) {
    scoreGoal('player');
    return;
  }
  if (puck.pos.y > RINK.goalLine && Math.abs(puck.pos.x) < RINK.goalWidth / 2 && puck.air < 1.58) {
    scoreGoal('rival');
    return;
  }

  const crossedGoalLine = puck.pos.y < -RINK.goalLine || puck.pos.y > RINK.goalLine;
  const inGoalMouthNow = Math.abs(puck.pos.x) < RINK.goalWidth / 2;
  if (crossedGoalLine && inGoalMouthNow && puck.air >= 1.58 && puck.air < 2.15 && speed > 10) {
    puck.pos.copy(before);
    puck.vel.y *= -0.52;
    puck.airVel = -Math.abs(puck.airVel) * 0.32;
    state.cameraShake = Math.max(state.cameraShake, 0.12);
    showToast('CROSSBAR! You went upstairs a little too much.', 1300);
    playTone(760, 0.075, 'triangle', 0.05);
    spray(new THREE.Vector3(puck.pos.x, 1.7, puck.pos.y), 28, TEAM.gold, 1.25);
    return;
  }

  const postBand = Math.abs(Math.abs(puck.pos.x) - RINK.goalWidth / 2) < 0.22;
  if (postBand && crossedGoalLine && puck.air < 1.64 && speed > 10) {
    puck.pos.copy(before);
    puck.vel.y *= -0.58;
    puck.vel.x += Math.sign(puck.pos.x) * 2.8;
    state.cameraShake = Math.max(state.cameraShake, 0.13);
    showToast('CLANG! Off the post.', 1200);
    playTone(620, 0.08, 'triangle', 0.055);
    spray(new THREE.Vector3(puck.pos.x, 0.45, puck.pos.y), 24, TEAM.gold, 1.4);
    return;
  }

  if (puck.pos.x < -RINK.wallX) {
    puck.pos.x = -RINK.wallX;
    puck.vel.x = Math.abs(puck.vel.x) * 0.74;
    boardImpact(new THREE.Vector3(puck.pos.x, 0.1, puck.pos.y), speed);
  } else if (puck.pos.x > RINK.wallX) {
    puck.pos.x = RINK.wallX;
    puck.vel.x = -Math.abs(puck.vel.x) * 0.74;
    boardImpact(new THREE.Vector3(puck.pos.x, 0.1, puck.pos.y), speed);
  }

  const inGoalMouth = Math.abs(puck.pos.x) < RINK.goalWidth / 2;
  if (puck.pos.y < -RINK.wallZ && !inGoalMouth) {
    puck.pos.y = -RINK.wallZ;
    puck.vel.y = Math.abs(puck.vel.y) * 0.74;
    boardImpact(new THREE.Vector3(puck.pos.x, 0.1, puck.pos.y), speed);
  } else if (puck.pos.y > RINK.wallZ && !inGoalMouth) {
    puck.pos.y = RINK.wallZ;
    puck.vel.y = -Math.abs(puck.vel.y) * 0.74;
    boardImpact(new THREE.Vector3(puck.pos.x, 0.1, puck.pos.y), speed);
  }

  if (speed > 7) {
    const playerDist = puck.pos.distanceTo(player.pos);
    if (playerDist < 0.82 && puck.lastShotBy !== 'player') {
      puck.vel.reflect(tmpVec2.copy(puck.pos).sub(player.pos).normalize()).multiplyScalar(0.62);
      spray(new THREE.Vector3(puck.pos.x, 0.12, puck.pos.y), 12, 0x55f7ff, 1.3);
      state.cameraShake = Math.max(state.cameraShake, 0.12);
    }

    const aiDist = puck.pos.distanceTo(ai.pos);
    if (aiDist < 0.78 && puck.lastShotBy !== 'ai') {
      puck.vel.reflect(tmpVec2.copy(puck.pos).sub(ai.pos).normalize()).multiplyScalar(0.58);
      ai.stun = 0.35;
      spray(new THREE.Vector3(puck.pos.x, 0.12, puck.pos.y), 16, 0xff455b, 1.5);
      showToast('Shot blocked off the rival pads!', 1300);
    }
  }

  if (before.distanceToSquared(puck.pos) > 0.04 && speed > 14 && Math.random() < 0.22) {
    spray(new THREE.Vector3(puck.pos.x, 0.08, puck.pos.y), 2, 0xeaffff, 0.55);
  }
}

function checkLoosePuckPickup() {
  const stickPos = getPlayerStickPosition2D();
  if (puck.pos.distanceTo(stickPos) < (mouse.draggingPuck ? 1.25 : 0.88) && puck.vel.length() < 17) {
    state.possession = 'player';
    state.possessionGrace = 0.24;
    showToast('Puck on your tape.', 1000);
    return;
  }

  if (puck.pos.distanceTo(ai.pos) < 1.05 && puck.vel.length() < 17) {
    state.possession = 'ai';
    state.possessionGrace = 0.24;
    ai.cooldown = 0.7;
    showToast('Rival corrals the loose puck.', 1200);
  }
}

function updatePuckMesh() {
  puck.group.position.set(puck.pos.x, 0.12 + puck.air, puck.pos.y);
  puck.group.rotation.y = puck.spin;
  puck.group.rotation.x = Math.sin(puck.spin * 0.7) * (puck.air > 0.05 ? 0.36 : 0.04);
  puck.group.scale.setScalar(1 + Math.min(0.12, puck.air * 0.04));
}

function updateCamera(dt, attract = false) {
  const speed = player.vel.length();
  const bobY = Math.sin(player.bob) * Math.min(0.055, speed * 0.006);
  const bobX = Math.cos(player.bob * 0.5) * Math.min(0.035, speed * 0.0035);
  const shake = state.cameraShake;
  state.cameraShake = damp(state.cameraShake, 0, 9, dt);
  state.cameraKick = damp(state.cameraKick, 0, 6, dt);

  if (attract) {
    camera.position.set(Math.sin(clock.elapsedTime * 0.08) * 8, 4.0, 23 + Math.cos(clock.elapsedTime * 0.08) * 4);
  } else {
    camera.position.set(
      player.pos.x + bobX + (Math.random() - 0.5) * shake,
      1.68 + bobY + (Math.random() - 0.5) * shake * 0.55,
      player.pos.y + (Math.random() - 0.5) * shake
    );
  }

  camera.rotation.y = player.yaw + (Math.random() - 0.5) * shake * 0.08;
  camera.rotation.x = player.pitch - state.cameraKick + (Math.random() - 0.5) * shake * 0.04;
  camera.rotation.z = clamp(-player.vel.x * 0.006, -0.065, 0.065);

  const fovTarget = 73 + clamp(speed - 6, 0, 9) * 0.85 - mouse.charge * 3.4;
  camera.fov = damp(camera.fov, fovTarget, 5.5, dt);
  camera.updateProjectionMatrix();

  const lineOpacity = clamp((speed - 7) / 8, 0, 0.34);
  speedLines.forEach((line, index) => {
    line.material.opacity = lineOpacity * (0.5 + Math.sin(clock.elapsedTime * 8 + index) * 0.3 + 0.3);
    line.position.z += dt * (4 + speed * 0.7);
    if (line.position.z > -1.5) line.position.z = -5 - Math.random() * 5;
  });
}

function updatePlayerStick(dt) {
  if (!playerStick) return;
  const speed = player.vel.length();
  const charge = mouse.charge;
  const sway = Math.sin(clock.elapsedTime * 8 + player.bob) * Math.min(0.08, speed * 0.009);
  const deke = mouse.draggingPuck ? Math.sin(clock.elapsedTime * 12) * 0.14 : 0;

  playerStick.position.set(0.03 + sway * 0.3 + deke, -0.01 + charge * 0.05, charge * 0.18);
  playerStick.rotation.set(
    -charge * 0.22 + Math.sin(player.bob * 0.5) * 0.01,
    deke * 0.4,
    -charge * 0.55 + sway
  );

  playerGloveR.position.z = -1.06 + charge * 0.34;
  playerGloveR.position.y = -0.68 + charge * 0.08;
  playerGloveL.position.x = 0.16 - charge * 0.07;
}

function updateParticles(dt) {
  particles.forEach((particle) => {
    if (particle.life <= 0) {
      particle.mesh.visible = false;
      return;
    }
    particle.life -= dt;
    particle.vel.y -= 3.4 * dt;
    particle.mesh.position.addScaledVector(particle.vel, dt);
    particle.mesh.material.opacity = Math.max(0, particle.life / particle.maxLife) * 0.88;
    particle.mesh.scale.setScalar(0.7 + (1 - particle.life / particle.maxLife) * 1.8);
    if (particle.mesh.position.y < 0.02) {
      particle.mesh.position.y = 0.02;
      particle.vel.y *= -0.18;
      particle.vel.x *= 0.58;
      particle.vel.z *= 0.58;
    }
  });
}

function updateTrail() {
  const positions = puckTrail.geometry.attributes.position.array;
  for (let i = positions.length - 3; i >= 3; i -= 3) {
    positions[i] = positions[i - 3];
    positions[i + 1] = positions[i - 2];
    positions[i + 2] = positions[i - 1];
  }
  positions[0] = puck.pos.x;
  positions[1] = 0.13 + puck.air * 0.45;
  positions[2] = puck.pos.y;
  puckTrail.material.opacity = clamp(puck.vel.length() / 24, 0.08, 0.58);
  puckTrail.geometry.attributes.position.needsUpdate = true;
}

function seedTrail() {
  if (!puckTrail) return;
  const positions = puckTrail.geometry.attributes.position.array;
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] = puck.pos.x;
    positions[i + 1] = 0.13;
    positions[i + 2] = puck.pos.y;
  }
  puckTrail.geometry.attributes.position.needsUpdate = true;
}

function updateAimHelpers() {
  setModeVisuals();
  if (state.mode !== 'click') return;

  raycaster.setFromCamera(mouse.ndc, camera);
  const hit = raycaster.ray.intersectPlane(groundPlane, mouse.worldTarget);
  if (!hit) {
    const forward = getPlayerForward();
    mouse.worldTarget.set(player.pos.x + forward.x * 20, 0, player.pos.y + forward.y * 20);
  }
  mouse.worldTarget.x = clamp(mouse.worldTarget.x, -RINK.wallX + 0.4, RINK.wallX - 0.4);
  mouse.worldTarget.z = clamp(mouse.worldTarget.z, -RINK.wallZ + 0.4, RINK.wallZ - 0.4);
  clickTargetMarker.position.set(mouse.worldTarget.x, 0.06, mouse.worldTarget.z);
  clickTargetMarker.rotation.z += 0.04;

  const linePositions = aimLine.geometry.attributes.position.array;
  linePositions[0] = puck.pos.x;
  linePositions[1] = 0.16;
  linePositions[2] = puck.pos.y;
  linePositions[3] = mouse.worldTarget.x;
  linePositions[4] = 0.16;
  linePositions[5] = mouse.worldTarget.z;
  aimLine.geometry.attributes.position.needsUpdate = true;
}

function updateCrowd(dt) {
  state.crowdPulse = damp(state.crowdPulse, 0, 1.8, dt);
  crowdMats.forEach((mat, index) => {
    mat.emissiveIntensity = 0.28 + Math.sin(clock.elapsedTime * 1.8 + index) * 0.08 + state.crowdPulse;
  });
  iceRails.forEach((rail, index) => {
    rail.material.opacity = rail.userData.base + Math.sin(clock.elapsedTime * 1.7 + rail.userData.phase) * 0.025 + Math.max(0, state.momentum) * 0.045;
    rail.position.z += Math.sin(clock.elapsedTime * 0.8 + index) * dt * 0.12;
  });
}

function updateHud() {
  playerScoreEl.textContent = state.playerScore;
  rivalScoreEl.textContent = state.rivalScore;
  const total = Math.ceil(state.timeRemaining);
  const mins = Math.floor(total / 60).toString().padStart(2, '0');
  const secs = (total % 60).toString().padStart(2, '0');
  clockEl.textContent = `${mins}:${secs}`;
  speedEl.textContent = `${player.vel.length().toFixed(1)} m/s`;
  possessionEl.textContent = state.possession === 'player' ? 'you' : state.possession === 'ai' ? 'rival' : 'loose';
  shotEl.textContent = mouse.charging ? `${Math.round(mouse.charge * 100)}%` : 'ready';
  powerFill.style.width = `${Math.round(mouse.charge * 100)}%`;

  const staminaPct = Math.round(player.stamina * 100);
  staminaReadout.textContent = `${staminaPct}%`;
  staminaFill.style.width = `${staminaPct}%`;
  const skillPct = clamp((state.skillMultiplier - 1) / 1.3, 0, 1) * 100;
  skillReadout.textContent = `x${state.skillMultiplier.toFixed(1)}`;
  skillFill.style.width = `${skillPct}%`;

  const momentumLabel = state.momentum > 0.35 ? 'heater' : state.momentum > 0.1 ? 'you' : state.momentum < -0.35 ? 'danger' : state.momentum < -0.1 ? 'rival' : 'neutral';
  momentumReadout.textContent = momentumLabel;
  lastShotSpeed.textContent = state.lastShotKmh ? `${state.lastShotKmh} km/h` : '-- km/h';
  lastShotType.textContent = state.lastShotLabel;

  updateCoachTip();
  setRadarDot(radarPlayer, player.pos);
  setRadarDot(radarRival, ai.pos);
  setRadarDot(radarPuck, puck.pos);
}

function setRadarDot(element, pos) {
  const left = clamp((pos.x + RINK.halfW) / RINK.width, 0, 1) * 100;
  const top = clamp((pos.y + RINK.halfL) / RINK.length, 0, 1) * 100;
  element.style.left = `${left}%`;
  element.style.top = `${top}%`;
}

function updateCoachTip() {
  if (!coachTip) return;
  if (mouse.charging && state.mode === 'simulation') {
    coachTip.textContent = 'Charging: move the mouse through release for power; aim higher/lower to beat the goalie.';
  } else if (player.stamina < 0.22) {
    coachTip.textContent = 'Stamina is cooked. Coast or brake for a second, then sprint again.';
  } else if (state.possession === 'ai') {
    coachTip.textContent = 'Rival has it. Close the gap and tap E for a poke check before the slot.';
  } else if (state.possession === 'player') {
    coachTip.textContent = 'You have the puck. Aim for the gold target on the far net for a skill bonus.';
  } else if (puck.vel.length() > 18) {
    coachTip.textContent = 'Loose rocket. Read the rebound off the glass and jump on it.';
  } else {
    coachTip.textContent = 'Loose puck. Angle your stick toward it, or use E to reach and collect.';
  }
}

function shootPuck() {
  if (state.goalPause > 0 || state.gameOver) return;
  const stick = getPlayerStickPosition2D();
  const distance = puck.pos.distanceTo(stick);
  const canShoot = state.possession === 'player' || distance < 1.65;
  if (!canShoot) {
    showToast('Get the puck on your tape first.', 1300);
    playTone(120, 0.08, 'sine', 0.04);
    return;
  }

  const held = clock.elapsedTime - mouse.chargeStart;
  const baseCharge = clamp(Math.max(mouse.charge, held / 1.05), 0.08, 1);
  const flickBoost = state.mode === 'simulation' ? clamp(mouse.movementAccumulator / 260, 0, 0.38) : 0.08;
  const finalPower = clamp(0.34 + baseCharge * 0.78 + flickBoost, 0.38, 1.38);
  const direction = getShotDirection();
  const spread = (1 - baseCharge) * 0.085 + (state.mode === 'simulation' ? 0.018 : 0.035);
  direction.rotateAround(new THREE.Vector2(0, 0), (Math.random() - 0.5) * spread);
  direction.normalize();

  const shotFromTape = state.possession === 'player';
  state.possession = null;
  state.possessionGrace = 0.18;
  puck.lastShotBy = 'player';
  if (shotFromTape) puck.pos.copy(stick);
  const shotSpeed = 15 + finalPower * 22;
  const pitchLift = state.mode === 'simulation'
    ? clamp(player.pitch + 0.22, 0, 0.72)
    : clamp(baseCharge * 0.32, 0.04, 0.32);
  puck.air = 0.02;
  puck.airVel = pitchLift * (4.6 + finalPower * 4.8);
  puck.shotHigh = clamp(puck.airVel / 5.8, 0, 1);
  puck.vel.copy(direction).multiplyScalar(shotSpeed).addScaledVector(player.vel, 0.32);
  puck.spin += shotSpeed * 0.16;

  const shotOrigin = new THREE.Vector3(puck.pos.x, 0.15, puck.pos.y);
  spray(shotOrigin, Math.floor(12 + finalPower * 22), TEAM.player, 1.25 + finalPower);
  state.cameraKick = 0.06 + finalPower * 0.04;
  state.cameraShake = Math.max(state.cameraShake, 0.08 + finalPower * 0.05);
  state.crowdPulse = Math.max(state.crowdPulse, 0.18 + finalPower * 0.1);
  mouse.movementAccumulator = 0;

  const label = finalPower > 1.1 ? 'ABSOLUTE LASER!' : finalPower > 0.82 ? 'Hard wrister.' : 'Quick release.';
  state.lastShotKmh = Math.round(shotSpeed * 3.6);
  state.lastShotLabel = `${label.replace('.', '')} · ${puck.shotHigh > 0.52 ? 'high' : 'low'} · ${state.mode === 'simulation' ? 'mouse flick' : 'cursor aim'}`;
  state.momentum = clamp(state.momentum + 0.08 + finalPower * 0.05, -1, 1);
  showToast(`${label} ${state.lastShotKmh} km/h`, 1500);
  playTone(80 + shotSpeed * 4, 0.07, 'sawtooth', 0.06);
  playTone(180 + shotSpeed * 6, 0.09, 'square', 0.025, 0.03);
}

function getShotDirection() {
  if (state.mode === 'click') {
    tmpVec2.set(mouse.worldTarget.x - puck.pos.x, mouse.worldTarget.z - puck.pos.y);
    if (tmpVec2.lengthSq() < 0.01) tmpVec2.set(0, -1);
    return tmpVec2.clone().normalize();
  }
  return getPlayerForward();
}

function aiShoot() {
  if (state.possession !== 'ai') return;
  const targetX = clamp(player.pos.x + (Math.random() - 0.5) * 2.8, -RINK.goalWidth / 2 + 0.35, RINK.goalWidth / 2 - 0.35);
  const target = new THREE.Vector2(targetX, RINK.goalLine + 0.3);
  const direction = target.sub(puck.pos).normalize();
  state.possession = null;
  state.possessionGrace = 0.22;
  puck.lastShotBy = 'ai';
  puck.air = 0.02;
  puck.airVel = 0.8 + Math.random() * 1.8;
  puck.shotHigh = clamp(puck.airVel / 5.8, 0, 1);
  puck.vel.copy(direction).multiplyScalar(18 + Math.random() * 7).addScaledVector(ai.vel, 0.28);
  puck.spin += 2.8;
  ai.cooldown = 2.2;
  state.lastShotKmh = Math.round(puck.vel.length() * 3.6);
  state.lastShotLabel = 'Rival release';
  state.momentum = clamp(state.momentum - 0.12, -1, 1);
  spray(new THREE.Vector3(puck.pos.x, 0.14, puck.pos.y), 18, TEAM.rival, 1.45);
  showToast('Rival snaps one at your net!', 1400);
  playTone(160, 0.09, 'sawtooth', 0.045);
}

function stealFromPlayer() {
  state.possession = 'ai';
  state.possessionGrace = 0.4;
  ai.cooldown = 1.0;
  player.vel.multiplyScalar(0.72);
  state.cameraShake = Math.max(state.cameraShake, 0.08);
  state.momentum = clamp(state.momentum - 0.18, -1, 1);
  spray(new THREE.Vector3(player.pos.x, 0.18, player.pos.y), 12, TEAM.rival, 1.0);
  showToast('Rival pokes it loose and takes off.', 1700);
  playTone(130, 0.1, 'square', 0.035);
}

function tryPokeCheck() {
  if (player.stealCooldown > 0) return;
  player.stealCooldown = 0.55;
  const dist = player.pos.distanceTo(ai.pos);
  if (state.possession === 'ai' && dist < 2.75) {
    state.possession = 'player';
    state.possessionGrace = 0.46;
    ai.stun = 0.45;
    ai.vel.multiplyScalar(0.38);
    puck.vel.copy(player.vel);
    state.momentum = clamp(state.momentum + 0.16, -1, 1);
    spray(new THREE.Vector3(ai.pos.x, 0.18, ai.pos.y), 18, TEAM.player, 1.3);
    showToast('Clean poke check. Your puck.', 1500);
    playTone(300, 0.07, 'triangle', 0.04);
  } else if (state.possession === null && puck.pos.distanceTo(getPlayerStickPosition2D()) < 2.15) {
    state.possession = 'player';
    state.possessionGrace = 0.25;
    showToast('Reached out and pulled it in.', 1200);
  } else if (dist < 1.55) {
    ai.stun = 0.35;
    ai.vel.addScaledVector(getPlayerForward(), 4.5);
    showToast('Shoulder-to-shoulder contact.', 1100);
    spray(new THREE.Vector3(ai.pos.x, 0.12, ai.pos.y), 10, 0xffffff, 1.0);
  } else {
    showToast('Poke missed.', 700);
  }
}

function scoreGoal(who) {
  if (state.goalPause > 0 || state.gameOver) return;
  const hitTarget = who === 'player' && skillTarget && Math.abs(puck.pos.x - skillTarget.x) < 0.74 && Math.abs(puck.air - skillTarget.y) < 0.64;
  if (who === 'player') {
    state.playerScore += 1;
    state.shotStreak = hitTarget ? state.shotStreak + 1 : Math.max(0, state.shotStreak - 1);
    state.skillMultiplier = clamp(state.skillMultiplier + (hitTarget ? 0.42 : 0.16), 1, 2.3);
    state.momentum = clamp(state.momentum + (hitTarget ? 0.55 : 0.32), -1, 1);
    showToast(hitTarget ? `TOP CHEDDAR TARGET HIT! Skill x${state.skillMultiplier.toFixed(1)}.` : 'GOAL! You buried it. Crowd is losing it.', 3000);
    playGoalHorn(TEAM.player);
    if (hitTarget) spray(new THREE.Vector3(skillTarget.x, skillTarget.y, -RINK.goalLine), 70, TEAM.gold, 2.6);
  } else {
    state.rivalScore += 1;
    state.shotStreak = 0;
    state.skillMultiplier = Math.max(1, state.skillMultiplier - 0.25);
    state.momentum = clamp(state.momentum - 0.48, -1, 1);
    showToast('Rival scores. Shake it off and answer back.', 2800);
    playGoalHorn(TEAM.rival);
    state.cameraShake = Math.max(state.cameraShake, 0.18);
  }
  moveSkillTarget(true);
  state.possession = null;
  state.goalPause = 1.85;
  state.crowdPulse = 1.0;
  puck.vel.set(0, 0);
  spray(new THREE.Vector3(puck.pos.x, 0.25, puck.pos.y), 80, who === 'player' ? TEAM.player : TEAM.rival, 3.0);
  updateHud();
}

function finishGame() {
  state.gameOver = true;
  state.running = false;
  mouse.charging = false;
  if (document.pointerLockElement) document.exitPointerLock();
  hud.classList.add('hidden');
  endScreen.classList.remove('hidden');
  const diff = state.playerScore - state.rivalScore;
  if (diff > 0) {
    finalTitle.textContent = 'YOU WIN';
    finalCopy.textContent = `Final score ${state.playerScore}-${state.rivalScore}. First-person filth confirmed.`;
  } else if (diff < 0) {
    finalTitle.textContent = 'RIVAL WINS';
    finalCopy.textContent = `Final score ${state.playerScore}-${state.rivalScore}. Run it back and light the lamp.`;
  } else {
    finalTitle.textContent = 'TIE GAME';
    finalCopy.textContent = `Final score ${state.playerScore}-${state.rivalScore}. Sudden death rematch?`;
  }
}

function boardImpact(position, speed = 8) {
  if (speed > 6) {
    spray(position, Math.floor(clamp(speed, 6, 24)), 0xdffcff, 1.1);
    state.cameraShake = Math.max(state.cameraShake, clamp(speed / 210, 0.02, 0.1));
    playTone(90 + speed * 5, 0.045, 'square', 0.018);
  }
}

function spray(origin, count, color, force = 1) {
  for (let i = 0; i < count; i += 1) {
    const particle = particles.find((candidate) => candidate.life <= 0);
    if (!particle) return;
    particle.life = 0.35 + Math.random() * 0.55;
    particle.maxLife = particle.life;
    particle.mesh.visible = true;
    particle.mesh.position.copy(origin);
    particle.mesh.material.color.setHex(color);
    particle.mesh.material.opacity = 0.82;
    particle.mesh.scale.setScalar(0.6 + Math.random() * 1.25);
    particle.vel.set(
      (Math.random() - 0.5) * 4.6 * force,
      (0.5 + Math.random() * 2.1) * force,
      (Math.random() - 0.5) * 4.6 * force
    );
  }
}

function getPlayerForward() {
  return new THREE.Vector2(Math.sin(player.yaw), -Math.cos(player.yaw)).normalize();
}

function getPlayerRight() {
  return new THREE.Vector2(Math.cos(player.yaw), Math.sin(player.yaw)).normalize();
}

function getAiForward() {
  return new THREE.Vector2(Math.sin(ai.yaw), -Math.cos(ai.yaw)).normalize();
}

function getAiRight() {
  return new THREE.Vector2(Math.cos(ai.yaw), Math.sin(ai.yaw)).normalize();
}

function getPlayerStickPosition2D() {
  const forward = getPlayerForward();
  const right = getPlayerRight();
  const reach = mouse.draggingPuck ? 1.05 : 1.42;
  const side = mouse.draggingPuck ? 0.18 : 0.52;
  return new THREE.Vector2(player.pos.x, player.pos.y).addScaledVector(forward, reach).addScaledVector(right, side);
}

function dampAngle(current, target, lambda, dt) {
  let delta = target - current;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return current + delta * (1 - Math.exp(-lambda * dt));
}

function showToast(message, duration = 1800) {
  toastEl.textContent = message;
  toastEl.classList.remove('faded');
  const token = performance.now();
  state.lastToastTime = token;
  window.setTimeout(() => {
    if (state.lastToastTime === token) toastEl.classList.add('faded');
  }, duration);
}

function resumeAudio() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioContext.state === 'suspended') audioContext.resume();
}

function playTone(frequency, duration, type = 'sine', volume = 0.04, delay = 0) {
  if (!audioContext) return;
  const start = audioContext.currentTime + delay;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.frequency.setValueAtTime(frequency, start);
  oscillator.type = type;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain).connect(audioContext.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

function playGoalHorn(color) {
  playTone(146, 0.35, 'sawtooth', 0.07);
  playTone(98, 0.42, 'sawtooth', 0.06, 0.04);
  playTone(196, 0.28, 'triangle', 0.05, 0.13);
  const goalColor = new THREE.Color(color);
  scene.background = goalColor.clone().lerp(new THREE.Color(0x030713), 0.86);
  window.setTimeout(() => {
    scene.background = new THREE.Color(0x020711);
  }, 180);
}
