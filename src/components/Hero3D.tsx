"use client";

import { Canvas } from "@react-three/fiber";
import { Float } from "@react-three/drei";
import { Suspense, useEffect, useState } from "react";

/* ── Stylized cinema camera, built from primitives (on-brand, no asset deps) ── */
function CinemaCamera() {
  const body = "#1a1a20";
  const metal = "#2a2a33";
  const accent = "#38bdf8";
  return (
    <group rotation={[0.2, 0.5, 0]}>
      {/* body */}
      <mesh castShadow>
        <boxGeometry args={[1.1, 0.85, 0.7]} />
        <meshStandardMaterial color={body} metalness={0.7} roughness={0.35} />
      </mesh>
      {/* lens barrel */}
      <mesh position={[0, 0, 0.6]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.32, 0.34, 0.5, 32]} />
        <meshStandardMaterial color={metal} metalness={0.85} roughness={0.25} />
      </mesh>
      {/* lens glass */}
      <mesh position={[0, 0, 0.86]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.26, 0.26, 0.04, 32]} />
        <meshStandardMaterial
          color={accent}
          emissive={accent}
          emissiveIntensity={0.5}
          metalness={0.9}
          roughness={0.1}
        />
      </mesh>
      {/* top handle */}
      <mesh position={[0, 0.6, 0]}>
        <boxGeometry args={[0.7, 0.12, 0.5]} />
        <meshStandardMaterial color={metal} metalness={0.6} roughness={0.4} />
      </mesh>
      {/* viewfinder */}
      <mesh position={[-0.45, 0.25, -0.2]}>
        <boxGeometry args={[0.3, 0.25, 0.3]} />
        <meshStandardMaterial color={body} metalness={0.6} roughness={0.4} />
      </mesh>
      {/* record light */}
      <mesh position={[0.45, 0.25, 0.36]}>
        <sphereGeometry args={[0.05, 16, 16]} />
        <meshStandardMaterial color="#ff3b3b" emissive="#ff3b3b" emissiveIntensity={1} />
      </mesh>
    </group>
  );
}

/* ── Stylized prime lens ── */
function PrimeLens() {
  const metal = "#26262e";
  const accent = "#38bdf8";
  return (
    <group rotation={[Math.PI / 2, 0, 0.3]}>
      <mesh>
        <cylinderGeometry args={[0.36, 0.4, 1.0, 40]} />
        <meshStandardMaterial color={metal} metalness={0.85} roughness={0.3} />
      </mesh>
      {/* focus rings */}
      {[-0.25, 0, 0.25].map((y, i) => (
        <mesh key={i} position={[0, y, 0]}>
          <torusGeometry args={[0.41, 0.03, 12, 40]} />
          <meshStandardMaterial color="#15151a" metalness={0.6} roughness={0.5} />
        </mesh>
      ))}
      {/* front element */}
      <mesh position={[0, 0.52, 0]}>
        <cylinderGeometry args={[0.3, 0.3, 0.06, 40]} />
        <meshStandardMaterial
          color={accent}
          emissive={accent}
          emissiveIntensity={0.6}
          metalness={0.95}
          roughness={0.08}
        />
      </mesh>
    </group>
  );
}

type Item = {
  pos: [number, number, number];
  scale: number;
  kind: "camera" | "lens";
  speed: number;
};

// positioned around the edges — clear of the centred wordmark/text
const ITEMS: Item[] = [
  { pos: [-3.4, 1.3, -1], scale: 0.95, kind: "camera", speed: 1.1 },
  { pos: [3.5, 1.0, -0.5], scale: 1.0, kind: "lens", speed: 1.4 },
  { pos: [-3.1, -1.6, -0.8], scale: 0.8, kind: "lens", speed: 1.25 },
  { pos: [3.2, -1.5, -1.3], scale: 0.8, kind: "camera", speed: 0.95 },
];

function Scene({ reduced }: { reduced: boolean }) {
  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 5, 5]} intensity={1.1} color="#fff5e6" />
      <pointLight position={[-5, 2, 3]} intensity={40} color="#38bdf8" />
      <pointLight position={[4, -3, 2]} intensity={25} color="#0ea5e9" />
      {ITEMS.map((it, i) => (
        <Float
          key={i}
          speed={reduced ? 0 : it.speed}
          rotationIntensity={reduced ? 0 : 0.4}
          floatIntensity={reduced ? 0 : 1.4}
          floatingRange={[-0.18, 0.18]}
        >
          <group position={it.pos} scale={it.scale}>
            {it.kind === "camera" ? <CinemaCamera /> : <PrimeLens />}
          </group>
        </Float>
      ))}
    </>
  );
}

export default function Hero3D() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const h = () => setReduced(mq.matches);
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, []);

  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      <Canvas
        camera={{ position: [0, 0, 7], fov: 50 }}
        dpr={[1, 1.5]}
        gl={{ alpha: true, antialias: true }}
        style={{ background: "transparent" }}
      >
        <Suspense fallback={null}>
          <Scene reduced={reduced} />
        </Suspense>
      </Canvas>
    </div>
  );
}
