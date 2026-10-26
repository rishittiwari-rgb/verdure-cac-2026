"use client";

import { Suspense, useEffect, useState } from "react";
import { Canvas } from "@react-three/fiber";
import {
  Float,
  PresentationControls,
  RoundedBox,
  Sparkles,
  useTexture,
} from "@react-three/drei";
import * as THREE from "three";

/**
 * HeroLogo3D — the Verdure logo rebuilt as a tactile 3D clay medallion.
 *
 * A thick, bevel-edged cream tile carries the logo on its face; users can grab
 * and spin it (PresentationControls), it breathes with a gentle float, and a
 * cloud of gold "bits" orbits it (the gold-flecks the team asked for). One warm
 * key light from the top-left keeps it consistent with every clay surface on
 * the page. WebGL, DPR-capped, paused under prefers-reduced-motion.
 */

function Medallion({ reduce }: { reduce: boolean })
{
  let logo = useTexture("/verdure-logo.png");
  // Crisp logo + correct color space.
  logo.colorSpace = THREE.SRGBColorSpace;
  logo.anisotropy = 8;

  return (
    <Float
      enabled={!reduce}
      speed={1.4}
      rotationIntensity={0.5}
      floatIntensity={0.7}
      floatingRange={[-0.08, 0.08]}
    >
      {/* The clay tile. Cream-tinted so the logo's white plate reads as clay. */}
      <RoundedBox args={[2.7, 2.7, 0.42]} radius={0.26} smoothness={8} castShadow>
        <meshStandardMaterial color="#f6f4e6" roughness={0.62} metalness={0.04} />
      </RoundedBox>

      {/* Logo printed on the front face, sitting just proud of the tile. */}
      <mesh position={[0, 0, 0.212]}>
        <planeGeometry args={[2.34, 2.34]} />
        <meshStandardMaterial
          map={logo}
          roughness={0.55}
          metalness={0}
          transparent
        />
      </mesh>

      {/* Orbiting gold bits */}
      <Sparkles
        count={36}
        scale={[4.6, 4.6, 2.2]}
        size={3.2}
        speed={reduce ? 0 : 0.45}
        opacity={0.85}
        color="#cf9f2e"
      />
    </Float>
  );
}

export default function HeroLogo3D()
{
  let [mobile, setMobile] = useState(false);
  let [reduce, setReduce] = useState(false);

  useEffect(function ()
  {
    let mqMobile = window.matchMedia("(max-width: 768px)");
    let mqReduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    setMobile(mqMobile.matches);
    setReduce(mqReduce.matches);

    let onMobile = function ()
    {
      setMobile(mqMobile.matches);
    };
    let onReduce = function ()
    {
      setReduce(mqReduce.matches);
    };
    mqMobile.addEventListener("change", onMobile);
    mqReduce.addEventListener("change", onReduce);
    return function ()
    {
      mqMobile.removeEventListener("change", onMobile);
      mqReduce.removeEventListener("change", onReduce);
    };
  }, []);

  return (
    <Canvas
      camera={{ position: [0, 0, 6], fov: 38 }}
      dpr={mobile ? [1, 1.5] : [1, 2]}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      frameloop={reduce ? "demand" : "always"}
      style={{ width: "100%", height: "100%" }}
    >
      {/* One key light, TOP-LEFT — matches every clay element on the page */}
      <ambientLight intensity={0.75} />
      <directionalLight position={[-5, 6, 5]} intensity={2.0} color="#fff6e0" />
      <pointLight position={[5, -3, 3]} intensity={0.5} color="#16bfa5" />

      <Suspense fallback={null}>
        <PresentationControls
          global
          enabled={!reduce}
          snap
          cursor
          speed={1.4}
          polar={[-0.35, 0.35]}
          azimuth={[-0.6, 0.6]}
          config={{ mass: 1, tension: 170, friction: 26 }}
        >
          <Medallion reduce={reduce} />
        </PresentationControls>
      </Suspense>
    </Canvas>
  );
}
