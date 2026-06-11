"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Float, useGLTF } from "@react-three/drei";
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

const R2 = "https://pub-761e4d18b3b84542809dddc11936a8df.r2.dev/models";
const CANON = `${R2}/canon-dslr.glb`;
const LEICA = `${R2}/leica.glb`;
const LENS = `${R2}/lens.glb`;

/** Loads a GLB, normalises it to a target size, and recenters it at origin. */
function Model({
  url,
  target,
  rotation = [0, 0, 0],
}: {
  url: string;
  target: number;
  rotation?: [number, number, number];
}) {
  const { scene } = useGLTF(url);
  const obj = useMemo(() => scene.clone(true), [scene]);
  const ref = useRef<THREE.Group>(null);

  useLayoutEffect(() => {
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const s = target / maxDim;
    obj.scale.setScalar(s);
    const box2 = new THREE.Box3().setFromObject(obj);
    const center = box2.getCenter(new THREE.Vector3());
    obj.position.sub(center);
  }, [obj, target]);

  return (
    <group ref={ref} rotation={rotation}>
      <primitive object={obj} />
    </group>
  );
}

type Item = {
  url: string;
  pos: [number, number, number];
  target: number;
  rot: [number, number, number];
  speed: number;
};

// edge-positioned, clear of the centred wordmark (text spans ~x[-2,2] y[-1.2,1.2])
const ITEMS: Item[] = [
  { url: CANON, pos: [-3.5, 1.05, -0.5], target: 2.3, rot: [0.15, 0.7, 0], speed: 1.1 },
  { url: LEICA, pos: [3.7, -1.25, -1.0], target: 2.0, rot: [0.15, -0.6, 0], speed: 0.95 },
  { url: LENS, pos: [3.45, 1.45, -0.6], target: 1.7, rot: [1.2, 0, 0.4], speed: 1.35 },
  { url: LENS, pos: [-3.2, -1.55, -1.0], target: 1.45, rot: [1.0, 0.6, 0], speed: 1.2 },
];

/** Whole-scene rig that eases toward the pointer — gear leans with the mouse. */
function ParallaxRig({ reduced, children }: { reduced: boolean; children: React.ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  const { pointer } = useThree();
  useFrame(() => {
    const g = ref.current;
    if (!g || reduced) return;
    g.rotation.y += (pointer.x * 0.16 - g.rotation.y) * 0.05;
    g.rotation.x += (-pointer.y * 0.1 - g.rotation.x) * 0.05;
    g.position.x += (pointer.x * 0.25 - g.position.x) * 0.05;
    g.position.y += (pointer.y * 0.15 - g.position.y) * 0.05;
  });
  return <group ref={ref}>{children}</group>;
}

function Scene({ reduced }: { reduced: boolean }) {
  return (
    <>
      <ambientLight intensity={0.95} />
      <directionalLight position={[5, 6, 5]} intensity={1.5} color="#fff5e6" />
      <directionalLight position={[-4, 2, -3]} intensity={0.7} color="#94b8ff" />
      {/* front fill so the dark lens/camera bodies read clearly */}
      <directionalLight position={[0, 0, 8]} intensity={1.0} color="#ffffff" />
      <pointLight position={[-5, 2, 3]} intensity={50} color="#38bdf8" />
      <pointLight position={[4, -3, 2]} intensity={32} color="#0ea5e9" />
      <ParallaxRig reduced={reduced}>
        {ITEMS.map((it, i) => (
          <Float
            key={i}
            speed={reduced ? 0 : it.speed}
            rotationIntensity={reduced ? 0 : 0.35}
            floatIntensity={reduced ? 0 : 1.3}
            floatingRange={[-0.18, 0.18]}
          >
            <group position={it.pos}>
              <Model url={it.url} target={it.target} rotation={it.rot} />
            </group>
          </Float>
        ))}
      </ParallaxRig>
    </>
  );
}

useGLTF.preload(CANON);
useGLTF.preload(LEICA);
useGLTF.preload(LENS);

export default function Hero3D() {
  const [reduced, setReduced] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const h = () => setReduced(mq.matches);
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, []);

  // fade the canvas out as the hero scrolls away (transform/opacity only)
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const vh = window.innerHeight || 1;
        const p = Math.min(1, window.scrollY / (vh * 0.7));
        el.style.opacity = String(1 - p);
        el.style.transform = `translateY(${p * 60}px)`;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div ref={wrap} className="pointer-events-none absolute inset-0 will-change-transform" aria-hidden>
      <Canvas
        camera={{ position: [0, 0, 7], fov: 50 }}
        dpr={[1, 1.5]}
        gl={{ alpha: true, antialias: true }}
        style={{ background: "transparent" }}
        eventSource={typeof document !== "undefined" ? document.body : undefined}
      >
        <Suspense fallback={null}>
          <Scene reduced={reduced} />
        </Suspense>
      </Canvas>
    </div>
  );
}
