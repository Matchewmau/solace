import { useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import type { Group } from "three";
import { brand } from "../brand";

/**
 * Isolated 3D showcase scene — the ONLY module that imports three.
 * Lazy-loaded by ShowcasePage so three/fiber weight lands in its own
 * chunk, never in the entry chunk or the POS chain.
 *
 * Minimal Solace-mark-inspired composition in brand ink/paper/accent:
 * a slow-rotating cup on a saucer beside a mono accent block.
 */

function Mark() {
  const ref = useRef<Group>(null);
  useFrame((_state, delta) => {
    if (ref.current) ref.current.rotation.y += delta * 0.3;
  });
  return (
    <group ref={ref}>
      {/* cup body */}
      <mesh position={[0, 0.75, 0]}>
        <cylinderGeometry args={[0.7, 0.55, 1.1, 32]} />
        <meshStandardMaterial color={brand.ink} />
      </mesh>
      {/* cup handle */}
      <mesh position={[0.75, 0.8, 0]} rotation={[0, 0, Math.PI / 2]}>
        <torusGeometry args={[0.32, 0.09, 16, 32]} />
        <meshStandardMaterial color={brand.ink} />
      </mesh>
      {/* saucer */}
      <mesh position={[0, 0.1, 0]}>
        <cylinderGeometry args={[1.1, 1.1, 0.12, 32]} />
        <meshStandardMaterial color={brand.muted} />
      </mesh>
      {/* mono accent block */}
      <mesh position={[1.7, 0.5, -0.4]}>
        <boxGeometry args={[0.9, 0.9, 0.9]} />
        <meshStandardMaterial color={brand.accent} />
      </mesh>
    </group>
  );
}

export default function ShowcaseScene() {
  return (
    <div aria-label="Solace 3D showcase" className="h-80 w-full bg-paper">
      <Canvas
        camera={{ position: [3.2, 2.2, 5], fov: 45 }}
        gl={{ antialias: true, powerPreference: "low-power" }}
        dpr={[1, 2]}
      >
        <color attach="background" args={[brand.paper]} />
        <ambientLight intensity={0.7} />
        <directionalLight position={[4, 6, 3]} intensity={1.2} />
        <Mark />
      </Canvas>
    </div>
  );
}
