import { Environment, Lightformer, RoundedBox } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import { kpiBarHeights } from './layout';

export interface Bar {
  value: number;
  label: string;
  /** Целевой столбик светится фирменным цветом. */
  target?: boolean;
}

/** Один столбик: растёт из нуля, когда график появляется, с небольшой задержкой друг за другом. */
function Column({ x, height, delay, target, animate }: { x: number; height: number; delay: number; target: boolean; animate: boolean }) {
  const ref = useRef<THREE.Group>(null);
  const t0 = useRef<number | null>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    if (!animate) {
      ref.current.scale.y = 1;
      return;
    }
    if (t0.current === null) t0.current = clock.elapsedTime;
    const t = Math.min(1, Math.max(0, (clock.elapsedTime - t0.current - delay) / 1.1));
    const ease = 1 - Math.pow(1 - t, 3);
    ref.current.scale.y = Math.max(0.001, ease);
  });
  return (
    <group ref={ref} position={[x, -1, 0]}>
      <RoundedBox args={[0.8, height, 0.8]} radius={0.12} smoothness={6} position={[0, height / 2, 0]}>
        {target ? (
          <meshPhysicalMaterial color="#3b5bff" emissive="#2f4bff" emissiveIntensity={0.9} roughness={0.15} metalness={0.1} clearcoat={1} clearcoatRoughness={0.04} envMapIntensity={0.6} />
        ) : (
          <meshPhysicalMaterial color="#ffffff" transmission={0.9} thickness={0.8} roughness={0.22} ior={1.4} clearcoat={1} attenuationColor="#c9d2ff" attenuationDistance={2} />
        )}
      </RoundedBox>
    </group>
  );
}

function Rig({ children, animate }: { children: React.ReactNode; animate: boolean }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((state, delta) => {
    if (!ref.current || !animate) return;
    const k = 1 - Math.exp(-delta * 2.5);
    ref.current.rotation.y += (-0.45 + state.pointer.x * 0.35 - ref.current.rotation.y) * k;
    ref.current.rotation.x += (0.12 - state.pointer.y * 0.12 - ref.current.rotation.x) * k;
  });
  return (
    <group ref={ref} rotation={[0.12, -0.45, 0]}>
      {children}
    </group>
  );
}

/** 3D-график пилота: «было → сейчас → цель» стеклянными столбиками, цель — синяя. */
export default function PilotChart3D({ bars, animate }: { bars: Bar[]; animate: boolean }) {
  const heights = kpiBarHeights(
    bars.map((b) => b.value),
    2.2,
  );
  const gap = 1.25;
  return (
    <Canvas dpr={[1, 1.75]} camera={{ position: [0, 0.7, 5.6], fov: 40 }} gl={{ alpha: true, antialias: true }} frameloop={animate ? 'always' : 'demand'} style={{ position: 'absolute', inset: 0 }}>
      <Environment resolution={128} frames={1}>
        <Lightformer form="rect" intensity={3} position={[0, 4, 4]} scale={[8, 2, 1]} />
        <Lightformer form="rect" intensity={1.4} position={[-5, 0, 2]} rotation-y={Math.PI / 2} scale={[6, 2, 1]} />
        <Lightformer form="ring" intensity={2} color="#b9c3ff" position={[4, 1, 3]} scale={2} />
      </Environment>
      <ambientLight intensity={0.9} />
      <directionalLight position={[3, 5, 4]} intensity={2.4} />
      <directionalLight position={[-4, 2, -2]} intensity={1} color="#b9c3ff" />
      <Rig animate={animate}>
        {bars.map((b, i) => (
          <Column key={b.label} x={(i - (bars.length - 1) / 2) * gap} height={heights[i]!} delay={i * 0.18} target={!!b.target} animate={animate} />
        ))}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.001, 0]}>
          <circleGeometry args={[2.1, 64]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.07} />
        </mesh>
      </Rig>
    </Canvas>
  );
}
