"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

/** Pointer state shared with the wrapper — written at window level so the
 * canvas itself can stay pointer-events-none under the hero links. */
export type RigPointer = {
  x: number;
  y: number;
  inside: boolean;
  fine: boolean;
  reduced: boolean;
};

/* ───────────────────────── deterministic rng ───────────────────────── */

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ───────────────────────── rig construction ─────────────────────────
 * Geometry-nodes thinking, in three: every part of the camera is a group
 * with a `home` (assembled) and `exploded` transform. A per-frame proximity
 * field — smoothstep over distance(part, cursor) — drives the lerp between
 * the two. `lag` staggers the build order: chassis first, garnish last. */

type Part = {
  node: THREE.Group;
  homeP: THREE.Vector3;
  homeQ: THREE.Quaternion;
  expP: THREE.Vector3;
  expQ: THREE.Quaternion;
  lag: number;
  seed: number;
  amp: number;
};

type Rig = {
  outer: THREE.Group;
  inner: THREE.Group;
  parts: Part[];
  mats: {
    accent: THREE.MeshStandardMaterial;
    iris: THREE.MeshStandardMaterial;
    screen: THREE.MeshStandardMaterial;
    rec: THREE.MeshStandardMaterial;
  };
  anim: { focusRing: THREE.Mesh; ffWheel: THREE.Mesh };
  dispose: () => void;
};

const LY = 0.06; // lens axis height
const CENTER = new THREE.Vector3(0, 0.05, 0.15);

function buildRig(): Rig {
  const outer = new THREE.Group();
  const inner = new THREE.Group();
  outer.add(inner);
  const parts: Part[] = [];
  const rng = mulberry32(20260612);
  const owned: { dispose(): void }[] = [];

  /* shared geometry — unit primitives, scaled per mesh */
  const gBox = new THREE.BoxGeometry(1, 1, 1);
  const gCyl = new THREE.CylinderGeometry(1, 1, 1, 48);
  const gKnurl = new THREE.CylinderGeometry(1, 1, 1, 28); // flat-shaded grip rings
  const gFlare = new THREE.CylinderGeometry(1.26, 1, 1, 48); // front barrel
  const gHood = new THREE.CylinderGeometry(1, 0.66, 1, 4, 1, true, Math.PI / 4);
  const gSphere = new THREE.SphereGeometry(1, 20, 14);
  const gTorus = new THREE.TorusGeometry(1, 0.16, 10, 36);
  owned.push(gBox, gCyl, gKnurl, gFlare, gHood, gSphere, gTorus);
  const rb = (w: number, h: number, d: number, r = 0.05) => {
    const g = new RoundedBoxGeometry(w, h, d, 3, r);
    owned.push(g);
    return g;
  };

  /* shared materials */
  const matBody = new THREE.MeshStandardMaterial({ color: 0x232530, metalness: 0.75, roughness: 0.38 });
  const matDark = new THREE.MeshStandardMaterial({ color: 0x16161c, metalness: 0.4, roughness: 0.55 });
  const matGrip = new THREE.MeshStandardMaterial({ color: 0x1b1c24, metalness: 0.5, roughness: 0.45, flatShading: true });
  const matSteel = new THREE.MeshStandardMaterial({ color: 0xaab1bc, metalness: 1, roughness: 0.28 });
  const matAccent = new THREE.MeshStandardMaterial({ color: 0x38bdf8, metalness: 0.7, roughness: 0.32, emissive: 0x38bdf8, emissiveIntensity: 0.35 });
  const matGlass = new THREE.MeshPhysicalMaterial({ color: 0x0c1420, metalness: 0.9, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.1, envMapIntensity: 2.2 });
  const matIris = new THREE.MeshStandardMaterial({ color: 0x05070c, emissive: 0x38bdf8, emissiveIntensity: 0.3 });
  const matScreen = new THREE.MeshStandardMaterial({ color: 0x05070c, emissive: 0x38bdf8, emissiveIntensity: 0.25 });
  const matRec = new THREE.MeshStandardMaterial({ color: 0x140607, emissive: 0xf43f5e, emissiveIntensity: 0.6 });
  owned.push(matBody, matDark, matGrip, matSteel, matAccent, matGlass, matIris, matScreen, matRec);

  const part = (p: [number, number, number], opts: { lag?: number; spread?: number } = {}) => {
    const g = new THREE.Group();
    g.position.set(...p);
    inner.add(g);
    const homeP = g.position.clone();
    const homeQ = g.quaternion.clone();
    const dir = homeP.clone().sub(CENTER);
    if (dir.lengthSq() < 1e-4) dir.set(rng() - 0.5, rng() - 0.5, rng() - 0.5);
    dir.normalize();
    dir.x += (rng() - 0.5) * 0.8;
    dir.y += (rng() - 0.5) * 0.8;
    dir.z += (rng() - 0.5) * 0.8;
    dir.normalize();
    const expP = homeP.clone().addScaledVector(dir, (0.7 + rng() * 1.2) * (opts.spread ?? 1));
    /* keep the drift cloud right of the centred copy — including the
     * leftward swing the rig's yaw gives forward (z+) parts */
    expP.x = THREE.MathUtils.clamp(expP.x, -0.5, 2.2);
    expP.y = THREE.MathUtils.clamp(expP.y, -1.6, 1.8);
    expP.z = THREE.MathUtils.clamp(expP.z, -1.9, 2.1);
    const wx = 0.7 * expP.x - 0.72 * expP.z;
    if (wx < -1.0) expP.x = Math.min((-1.0 + 0.72 * expP.z) / 0.7, 2.2);
    const expQ = homeQ
      .clone()
      .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler((rng() - 0.5) * 1.6, (rng() - 0.5) * 1.6, (rng() - 0.5) * 1.2)));
    parts.push({ node: g, homeP, homeQ, expP, expQ, lag: opts.lag ?? rng() * 0.25, seed: rng() * 100, amp: 0.05 + rng() * 0.08 });
    g.position.copy(expP); // first paint = drifting cloud
    g.quaternion.copy(expQ);
    return g;
  };

  const M = (
    parent: THREE.Object3D,
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    p: [number, number, number] = [0, 0, 0],
    s: [number, number, number] | number = 1,
    r: [number, number, number] = [0, 0, 0],
  ) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(...p);
    if (typeof s === "number") m.scale.setScalar(s);
    else m.scale.set(...s);
    m.rotation.set(...r);
    parent.add(m);
    return m;
  };

  const X = Math.PI / 2;

  /* body + chassis */
  const body = part([0, 0, -0.62], { lag: 0 });
  M(body, rb(0.92, 0.8, 1.05, 0.07), matBody);
  M(body, gBox, matDark, [0, -0.28, 0.12], [0.94, 0.18, 0.5]);

  const frontPlate = part([0, 0.02, -0.06], { lag: 0.05 });
  M(frontPlate, rb(0.86, 0.72, 0.1, 0.04), matBody);
  for (const [sx, sy] of [[-0.34, 0.27], [0.34, 0.27], [-0.34, -0.27], [0.34, -0.27]] as const)
    M(frontPlate, gCyl, matSteel, [sx, sy, 0.05], [0.022, 0.03, 0.022], [X, 0, 0]);

  const topPlate = part([0, 0.46, -0.55], { lag: 0.2 });
  M(topPlate, rb(0.5, 0.07, 0.95, 0.03), matDark);
  M(topPlate, gBox, matAccent, [0, 0.045, 0], [0.46, 0.012, 0.88]);

  const vents = part([0.47, 0, -0.7], { lag: 0.15 });
  for (let i = 0; i < 5; i++) M(vents, gBox, matDark, [0, 0, i * 0.11 - 0.22], [0.025, 0.42, 0.05]);

  const dials = part([0.48, 0.1, -0.32], { lag: 0.3 });
  M(dials, gCyl, matSteel, [0, 0.1, -0.08], [0.06, 0.05, 0.06], [0, 0, X]);
  M(dials, gCyl, matSteel, [0, 0.1, -0.32], [0.05, 0.05, 0.05], [0, 0, X]);
  M(dials, gCyl, matAccent, [0, -0.14, -0.2], [0.045, 0.05, 0.045], [0, 0, X]);

  const recDot = part([-0.47, 0.25, -0.2], { lag: 0.45 });
  M(recDot, gCyl, matRec, [0, 0, 0], [0.04, 0.03, 0.04], [0, 0, X]);

  /* lens stack — pl mount to front glass */
  const mount = part([0, LY, 0.04], { lag: 0 });
  M(mount, gCyl, matSteel, [0, 0, 0], [0.3, 0.1, 0.3], [X, 0, 0]);
  M(mount, gCyl, matAccent, [0, 0, 0.06], [0.27, 0.02, 0.27], [X, 0, 0]);

  const lensRear = part([0, LY, 0.2], { lag: 0.05 });
  M(lensRear, gCyl, matDark, [0, 0, 0], [0.27, 0.22, 0.27], [X, 0, 0]);

  const focusGrp = part([0, LY, 0.44], { lag: 0.1 });
  const focusRing = M(focusGrp, gKnurl, matGrip, [0, 0, 0], [0.31, 0.24, 0.31], [X, 0, 0]);

  const ring1 = part([0, LY, 0.585], { lag: 0.35 });
  M(ring1, gCyl, matAccent, [0, 0, 0], [0.315, 0.045, 0.315], [X, 0, 0]);

  const lensMid = part([0, LY, 0.74], { lag: 0.08 });
  M(lensMid, gCyl, matBody, [0, 0, 0], [0.27, 0.26, 0.27], [X, 0, 0]);
  M(lensMid, gBox, matSteel, [0, 0.276, 0.04], [0.015, 0.015, 0.05]);
  M(lensMid, gBox, matSteel, [0.196, 0.196, -0.04], [0.015, 0.015, 0.05], [0, 0, -Math.PI / 4]);

  const irisGrp = part([0, LY, 0.95], { lag: 0.15 });
  M(irisGrp, gKnurl, matGrip, [0, 0, 0], [0.3, 0.16, 0.3], [X, 0, 0]);

  const ring2 = part([0, LY, 1.05], { lag: 0.4 });
  M(ring2, gCyl, matAccent, [0, 0, 0], [0.305, 0.035, 0.305], [X, 0, 0]);

  const frontBarrel = part([0, LY, 1.22], { lag: 0.05 });
  M(frontBarrel, gFlare, matDark, [0, 0, 0], [0.28, 0.3, 0.28], [X, 0, 0]);

  const frontRim = part([0, LY, 1.41], { lag: 0.2 });
  M(frontRim, gCyl, matBody, [0, 0, 0], [0.355, 0.07, 0.355], [X, 0, 0]);
  M(frontRim, gCyl, matGlass, [0, 0, -0.005], [0.3, 0.05, 0.3], [X, 0, 0]);
  M(frontRim, gCyl, matIris, [0, 0, 0.026], [0.2, 0.012, 0.2], [X, 0, 0]);
  M(frontRim, gTorus, matAccent, [0, 0, 0.034], 0.26);

  /* matte box + flags */
  const hood = part([0, LY + 0.04, 1.62], { lag: 0.25, spread: 1.2 });
  M(hood, gHood, matDark, [0, 0, 0], [0.52, 0.4, 0.44], [X, 0, 0]);

  const topFlag = part([0, LY + 0.42, 1.66], { lag: 0.5, spread: 1.3 });
  topFlag.rotation.x = -1.15;
  topFlag.quaternion.setFromEuler(topFlag.rotation);
  M(topFlag, gBox, matDark, [0, 0, 0.17], [0.72, 0.02, 0.4]);
  M(topFlag, gCyl, matSteel, [0, 0, -0.03], [0.022, 0.7, 0.022], [0, 0, X]);

  for (const side of [-1, 1] as const) {
    const flag = part([side * 0.44, LY + 0.12, 1.64], { lag: 0.55, spread: 1.2 });
    flag.rotation.y = side * -0.5;
    flag.quaternion.setFromEuler(flag.rotation);
    M(flag, gBox, matDark, [0, 0, 0.14], [0.02, 0.44, 0.32]);
  }

  /* top handle + mic */
  const posts = part([0, 0.52, -0.5], { lag: 0.2 });
  M(posts, gCyl, matBody, [0, 0.06, 0.18], [0.045, 0.26, 0.045]);
  M(posts, gCyl, matBody, [0, 0.06, -0.28], [0.045, 0.26, 0.045]);

  const grip = part([0, 0.72, -0.5], { lag: 0.1 });
  M(grip, gCyl, matGrip, [0, 0, 0], [0.075, 0.82, 0.075], [X, 0, 0]);
  M(grip, gSphere, matBody, [0, 0, 0.41], 0.075);
  M(grip, gSphere, matBody, [0, 0, -0.41], 0.075);
  M(grip, gCyl, matAccent, [0, 0, 0.32], [0.078, 0.03, 0.078], [X, 0, 0]);

  const micMount = part([0, 0.84, -0.18], { lag: 0.45 });
  M(micMount, gCyl, matSteel, [0, -0.06, 0], [0.025, 0.14, 0.025]);
  M(micMount, gTorus, matAccent, [0, 0.08, 0.05], 0.085);

  const mic = part([0, 0.92, 0.05], { lag: 0.35, spread: 1.2 });
  mic.rotation.x = 0.05;
  mic.quaternion.setFromEuler(mic.rotation);
  M(mic, gCyl, matDark, [0, 0, 0.1], [0.045, 0.95, 0.045], [X, 0, 0]);
  M(mic, gCyl, matSteel, [0, 0, 0.6], [0.046, 0.06, 0.046], [X, 0, 0]);
  M(mic, gTorus, matAccent, [0, 0, -0.25], 0.085);

  /* evf + monitor */
  const evf = part([-0.2, 0.6, 0.08], { lag: 0.3 });
  M(evf, rb(0.26, 0.2, 0.34, 0.04), matBody);
  M(evf, gCyl, matGrip, [0, 0, -0.21], [0.095, 0.1, 0.095], [X, 0, 0]);
  M(evf, gBox, matAccent, [0, 0.11, 0.05], [0.03, 0.012, 0.03]);

  const arm = part([-0.52, 0.5, -0.15], { lag: 0.35 });
  M(arm, gSphere, matSteel, [0, 0, 0], 0.045);
  M(arm, gCyl, matSteel, [-0.16, 0.09, 0.1], [0.022, 0.42, 0.022], [0.5, 0, 0.7]);
  M(arm, gSphere, matSteel, [-0.3, 0.18, 0.2], 0.045);

  const monitor = part([-0.88, 0.66, 0.12], { lag: 0.15, spread: 1.25 });
  monitor.rotation.set(0, 0.5, -0.04);
  monitor.quaternion.setFromEuler(monitor.rotation);
  M(monitor, rb(0.62, 0.4, 0.05, 0.02), matBody);
  M(monitor, gBox, matScreen, [0, 0, 0.028], [0.55, 0.33, 0.012]);

  /* power + support */
  const battery = part([0, 0.04, -1.27], { lag: 0.25 });
  M(battery, rb(0.46, 0.52, 0.18, 0.03), matDark);
  M(battery, gBox, matAccent, [0, 0.12, 0], [0.47, 0.05, 0.19]);
  M(battery, gBox, matSteel, [0, 0, 0.1], [0.4, 0.44, 0.02]);

  const basePlate = part([0, -0.47, -0.5], { lag: 0.1 });
  M(basePlate, rb(0.5, 0.08, 0.62, 0.02), matBody);

  const clamp = part([0, -0.57, -0.42], { lag: 0.2 });
  M(clamp, gBox, matBody, [0, 0, 0], [0.48, 0.13, 0.14]);
  M(clamp, gCyl, matAccent, [0.27, 0, 0], [0.04, 0.05, 0.04], [0, 0, X]);
  M(clamp, gCyl, matAccent, [-0.27, 0, 0], [0.04, 0.05, 0.04], [0, 0, X]);

  for (const side of [-1, 1] as const) {
    const rail = part([side * 0.155, -0.57, 0.25], { lag: side < 0 ? 0.3 : 0.38, spread: 1.15 });
    M(rail, gCyl, matSteel, [0, 0, 0], [0.032, 1.9, 0.032], [X, 0, 0]);
    M(rail, gCyl, matAccent, [0, 0, 0.96], [0.034, 0.025, 0.034], [X, 0, 0]);
  }

  /* follow focus */
  const ffBracket = part([-0.28, -0.45, 0.44], { lag: 0.4 });
  M(ffBracket, gBox, matBody, [0.06, -0.06, 0], [0.1, 0.22, 0.1]);
  M(ffBracket, gBox, matDark, [0.12, -0.12, 0], [0.08, 0.08, 0.12]);

  const ffGrp = part([-0.42, -0.32, 0.44], { lag: 0.3 });
  const ffWheel = M(ffGrp, gKnurl, matGrip, [0, 0, 0], [0.17, 0.05, 0.17], [0, 0, X]);
  M(ffGrp, gCyl, matAccent, [-0.04, 0, 0], [0.06, 0.02, 0.06], [0, 0, X]);

  const dispose = () => {
    for (const o of owned) o.dispose();
  };

  return {
    outer,
    inner,
    parts,
    mats: { accent: matAccent, iris: matIris, screen: matScreen, rec: matRec },
    anim: { focusRing, ffWheel },
    dispose,
  };
}

/* ───────────────────────── scene helpers ───────────────────────── */

/** Studio reflections from three's built-in RoomEnvironment — zero network. */
function Studio() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const tex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = tex;
    scene.environmentIntensity = 0.85;
    pmrem.dispose();
    return () => {
      scene.environment = null;
      tex.dispose();
    };
  }, [gl, scene]);
  return null;
}

/** Live accent colour — follows html[data-accent] so the AccentPicker
 * restyles the rig along with the rest of the site. */
function useAccent() {
  const [c, setC] = useState("#38bdf8");
  useEffect(() => {
    const read = () =>
      setC(getComputedStyle(document.documentElement).getPropertyValue("--color-accent-400").trim() || "#38bdf8");
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-accent"] });
    return () => mo.disconnect();
  }, []);
  return c;
}

/* ───────────────────────── animation ───────────────────────── */

const _ndc = new THREE.Vector2();
const _ray = new THREE.Raycaster();
const _plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const _cursor = new THREE.Vector3();
const _vT = new THREE.Vector3();
const _qT = new THREE.Quaternion();
const _qW = new THREE.Quaternion();
const _e = new THREE.Euler();

function CameraRig({
  ptr,
  accent,
  onAssembly,
}: {
  ptr: { current: RigPointer };
  accent: string;
  onAssembly: (v: number) => void;
}) {
  const rig = useMemo(() => buildRig(), []);
  useEffect(() => () => rig.dispose(), [rig]);

  useEffect(() => {
    rig.mats.accent.color.set(accent);
    rig.mats.accent.emissive.set(accent);
    rig.mats.iris.emissive.set(accent);
    rig.mats.screen.emissive.set(accent);
  }, [rig, accent]);

  const sm = useRef({ px: 0, py: 0, global: 0 });

  useFrame((state, deltaRaw) => {
    const dt = Math.min(deltaRaw, 0.066);
    const t = state.clock.elapsedTime;
    const p = ptr.current;
    const { outer, inner, parts, mats, anim } = rig;
    const { damp, clamp, smoothstep } = THREE.MathUtils;

    /* responsive placement — right of the centred wordmark on lg+,
     * dimmed backdrop behind it below */
    const wide = state.size.width >= 1024;
    const halfW = state.viewport.width / 2;
    const tx = wide ? clamp(halfW - 2.3, 1.7, 3.0) : 0;
    const ty = wide ? 0.12 : -0.2;
    const ts = wide ? clamp(halfW / 5.2, 0.8, 1.02) : 0.72;

    if (p.reduced) {
      outer.position.set(tx, ty, 0);
      outer.scale.setScalar(ts);
      inner.rotation.set(0.04, -0.8, 0);
      for (const pt of parts) {
        pt.node.position.copy(pt.homeP);
        pt.node.quaternion.copy(pt.homeQ);
      }
      mats.screen.emissiveIntensity = 1;
      mats.iris.emissiveIntensity = 1;
      onAssembly(1);
      return;
    }

    outer.position.x = damp(outer.position.x, tx, 4, dt);
    outer.position.y = damp(outer.position.y, ty, 4, dt);
    const s = damp(outer.scale.x, ts, 4, dt);
    outer.scale.setScalar(s);

    const interactive = p.fine;
    sm.current.px = damp(sm.current.px, p.inside ? p.x : 0, 4, dt);
    sm.current.py = damp(sm.current.py, p.inside ? p.y : 0, 4, dt);

    inner.rotation.y = -0.8 + Math.sin(t * 0.07) * 0.12 + sm.current.px * 0.14;
    inner.rotation.x = 0.04 + Math.sin(t * 0.09) * 0.04 - sm.current.py * 0.08;
    inner.position.y = Math.sin(t * 0.5) * 0.045;
    outer.updateMatrixWorld(true);

    /* cursor → rig-local point; coarse pointers get a roaming attractor */
    let hasCursor = false;
    if (interactive && p.inside) {
      _ray.setFromCamera(_ndc.set(p.x, p.y), state.camera);
      if (_ray.ray.intersectPlane(_plane, _cursor)) {
        inner.worldToLocal(_cursor);
        hasCursor = true;
      }
    } else if (!interactive) {
      _cursor.set(Math.sin(t * 0.5) * 1.4, Math.sin(t * 0.33 + 1.2) * 0.9, 0.4);
      hasCursor = true;
    }

    const gTarget = interactive ? (p.inside ? 0.42 : 0.05) : Math.max(0, 0.4 + 0.42 * Math.sin(t * 0.35));
    sm.current.global = damp(sm.current.global, gTarget, 1.4, dt);
    const localGain = interactive ? 0.95 : 0.55;

    /* the proximity field — geonodes math, one part at a time */
    let sum = 0;
    const k = 1 - Math.exp(-7.5 * dt);
    for (const pt of parts) {
      let local = 0;
      if (hasCursor) local = 1 - smoothstep(pt.homeP.distanceTo(_cursor), 0.35, 2.5);
      let a = clamp(sm.current.global + local * localGain, 0, 1);
      a = clamp((a - pt.lag) / (1 - pt.lag), 0, 1);
      a = a * a * (3 - 2 * a);
      sum += a;

      const w = 1 - a;
      _vT.lerpVectors(pt.expP, pt.homeP, a);
      _vT.x += Math.sin(t * 0.55 + pt.seed) * pt.amp * w;
      _vT.y += Math.sin(t * 0.42 + pt.seed * 1.7) * pt.amp * 1.2 * w;
      _vT.z += Math.cos(t * 0.5 + pt.seed * 2.3) * pt.amp * w;
      pt.node.position.lerp(_vT, k);

      _qT.copy(pt.expQ).slerp(pt.homeQ, a);
      if (w > 0.001) {
        _e.set(
          Math.sin(t * 0.4 + pt.seed) * 0.25 * w,
          Math.sin(t * 0.34 + pt.seed * 2) * 0.25 * w,
          Math.sin(t * 0.3 + pt.seed * 3) * 0.2 * w,
        );
        _qT.multiply(_qW.setFromEuler(_e));
      }
      pt.node.quaternion.slerp(_qT, k);
    }
    const mean = sum / parts.length;

    /* assembled flourishes: focus hunt, follow-focus counter-spin, rec blink */
    const spin = Math.sin(t * 0.5) * 0.7 + sm.current.px * 0.6;
    anim.focusRing.rotation.y = spin * mean;
    anim.ffWheel.rotation.x = -spin * 1.9 * mean;
    mats.rec.emissiveIntensity = mean > 0.88 ? (Math.sin(t * 6) > 0 ? 2.4 : 0.3) : 0.45;
    mats.screen.emissiveIntensity = 0.15 + mean * 1.05;
    mats.iris.emissiveIntensity = 0.2 + mean * 0.95 + Math.sin(t * 1.3) * 0.05;
    mats.accent.emissiveIntensity = 0.15 + mean * 0.3;

    onAssembly(mean);
  });

  return <primitive object={rig.outer} />;
}

/* ───────────────────────── canvas ───────────────────────── */

export function HeroRig3D({
  ptr,
  onAssembly,
  frameloop,
}: {
  ptr: { current: RigPointer };
  onAssembly: (v: number) => void;
  frameloop: "always" | "demand" | "never";
}) {
  const accent = useAccent();
  return (
    <Canvas
      frameloop={frameloop}
      dpr={[1, 1.75]}
      camera={{ fov: 38, position: [0, 0, 9] }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      onCreated={({ gl }) => {
        gl.toneMappingExposure = 1.12;
      }}
    >
      <Studio />
      <ambientLight intensity={0.22} />
      <directionalLight position={[5, 7, 6]} intensity={1.7} color="#ffe9d2" />
      <directionalLight position={[-6, -2, -4]} intensity={0.55} color="#bcd8ff" />
      <pointLight position={[-2.8, 1.6, 3.6]} intensity={42} distance={14} decay={2} color={accent} />
      <CameraRig ptr={ptr} accent={accent} onAssembly={onAssembly} />
    </Canvas>
  );
}
