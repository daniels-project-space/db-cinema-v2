"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

/** Pointer state shared with the wrapper — written at window level so the
 * canvas itself can stay pointer-events-none under the hero links. */
export type RigPointer = {
  x: number;
  y: number;
  inside: boolean;
  fine: boolean;
  reduced: boolean;
};

const MODEL_URL = "/models/hero-rig.glb";

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
 * restyles the rig lighting along with the rest of the site. */
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

/** AI-generated cinema rig (fal.ai flux → Hunyuan3D-2.1 PBR paint stage —
 * proper dark albedo + real metallic/roughness maps, used as baked). */
function ModelRig({
  ptr,
  accent,
  onAssembly,
}: {
  ptr: { current: RigPointer };
  accent: string;
  onAssembly: (v: number) => void;
}) {
  const { scene: glb } = useGLTF(MODEL_URL, true, true);
  const outer = useMemo(() => new THREE.Group(), []);
  const inner = useMemo(() => new THREE.Group(), []);
  const lightRef = useRef<THREE.PointLight>(null);
  const sm = useRef({ px: 0, py: 0, track: 0, entrance: 0 });

  useEffect(() => {
    glb.traverse((o) => {
      if (!(o as THREE.Mesh).isMesh) return;
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial;
      m.envMapIntensity = 1.1;
      m.needsUpdate = true;
    });
    /* normalise: centre at origin, max dimension = 3 world units */
    const box = new THREE.Box3().setFromObject(glb);
    const size = box.getSize(new THREE.Vector3());
    const s = 3.3 / (Math.max(size.x, size.y, size.z) || 1);
    glb.scale.setScalar(s);
    const box2 = new THREE.Box3().setFromObject(glb);
    glb.position.sub(box2.getCenter(new THREE.Vector3()));
    inner.add(glb);
    outer.add(inner);
  }, [glb, inner, outer]);

  useFrame((state, deltaRaw) => {
    const dt = Math.min(deltaRaw, 0.066);
    const t = state.clock.elapsedTime;
    const p = ptr.current;
    const { damp, clamp, smoothstep } = THREE.MathUtils;

    /* responsive placement — right of the centred wordmark on lg+,
     * dimmed backdrop behind it below */
    const wide = state.size.width >= 1024;
    const halfW = state.viewport.width / 2;
    const tx = wide ? clamp(halfW - 2.3, 1.7, 3.0) : 0;
    const ty = wide ? 0.08 : -0.2;
    const ts = wide ? clamp(halfW / 5.2, 0.8, 1.02) : 0.72;

    if (p.reduced) {
      outer.position.set(tx, ty, 0);
      outer.scale.setScalar(ts);
      inner.rotation.set(0.05, -0.85, 0);
      onAssembly(1);
      return;
    }

    /* one-time entrance: rise + scale in */
    sm.current.entrance = Math.min(1, sm.current.entrance + dt * 0.8);
    const e = 1 - Math.pow(1 - sm.current.entrance, 3);

    outer.position.x = damp(outer.position.x, tx, 4, dt);
    outer.position.y = damp(outer.position.y, ty - (1 - e) * 0.6, 4, dt);
    const s = damp(outer.scale.x, ts * (0.7 + 0.3 * e), 4, dt);
    outer.scale.setScalar(s);

    const interactive = p.fine;
    sm.current.px = damp(sm.current.px, p.inside ? p.x : 0, 4, dt);
    sm.current.py = damp(sm.current.py, p.inside ? p.y : 0, 4, dt);
    const { px, py } = sm.current;

    /* cursor → world point on the rig plane; coarse pointers roam on their own */
    let prox = 0;
    if (interactive && p.inside) {
      _ray.setFromCamera(_ndc.set(p.x, p.y), state.camera);
      if (_ray.ray.intersectPlane(_plane, _cursor)) {
        prox = 1 - smoothstep(_cursor.distanceTo(outer.position), 0.6, 3.4);
      }
    } else if (!interactive) {
      _cursor.set(Math.sin(t * 0.4) * 2.2, Math.sin(t * 0.27 + 1.2) * 1.1, 0);
      prox = 0.45 + 0.45 * Math.sin(t * 0.3);
    }
    sm.current.track = damp(sm.current.track, prox, 2.2, dt);
    const track = sm.current.track;

    /* the rig films the visitor: lens swings toward the cursor as it nears */
    const lookYaw = interactive ? px * 0.55 : Math.sin(t * 0.21) * 0.4;
    const lookPitch = interactive ? -py * 0.22 : Math.sin(t * 0.16) * 0.1;
    inner.rotation.y = -0.85 + Math.sin(t * 0.07) * 0.1 + lookYaw * (0.35 + 0.65 * track);
    inner.rotation.x = 0.05 + Math.sin(t * 0.09) * 0.03 + lookPitch * (0.3 + 0.7 * track);
    inner.rotation.z = px * py * 0.04 * track;
    inner.position.y = Math.sin(t * 0.5) * 0.05;

    /* accent light chases the cursor and flares with proximity */
    const L = lightRef.current;
    if (L) {
      L.position.x = damp(L.position.x, (interactive && p.inside ? _cursor.x : -2.8) - outer.position.x, 5, dt);
      L.position.y = damp(L.position.y, (interactive && p.inside ? _cursor.y : 1.6) - outer.position.y, 5, dt);
      L.intensity = damp(L.intensity, 14 + track * 46, 4, dt);
    }

    onAssembly(track);
  });

  return (
    <primitive object={outer}>
      <pointLight ref={lightRef} position={[-2.8, 1.6, 3.2]} intensity={14} distance={12} decay={2} color={accent} />
    </primitive>
  );
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
      <ambientLight intensity={0.3} />
      <directionalLight position={[5, 7, 6]} intensity={1.7} color="#ffe9d2" />
      <directionalLight position={[-6, -2, -4]} intensity={0.55} color="#bcd8ff" />
      <ModelRig ptr={ptr} accent={accent} onAssembly={onAssembly} />
    </Canvas>
  );
}

useGLTF.preload(MODEL_URL, true, true);
