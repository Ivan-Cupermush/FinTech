import { Canvas, useFrame, useThree } from '@react-three/fiber/native';
import { Component, useMemo, useRef, type ReactNode } from 'react';
import { View } from 'react-native';
import * as THREE from 'three';
import { heroMarkPlacement, hexToRgb, HERO_COLORS } from '../../lib/fx';

/**
 * Живой градиент — наш шейдер по мотивам ShaderGradient: сама библиотека
 * работает только в браузере, поэтому в приложении те же три цвета
 * текут в собственном фрагментном шейдере на React Three Fiber.
 */
const vertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.9999, 1.0);
}`;

const fragment = /* glsl */ `
precision highp float;
uniform float uTime;
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uC3;
varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

void main() {
  float t = uTime * 0.07;
  float n = noise(vUv * 2.2 + vec2(t, -t * 0.7)) * 0.6 + noise(vUv * 4.5 - vec2(t * 1.3, t)) * 0.4;
  float band = smoothstep(0.1, 0.9, vUv.x * 0.55 + (1.0 - vUv.y) * 0.55 + (n - 0.5) * 0.9);
  vec3 col = mix(uC1, uC2, band);
  float glow = smoothstep(0.6, 0.0, distance(vUv, vec2(0.18 + 0.08 * sin(t * 3.0), 0.82 + 0.05 * cos(t * 2.0))));
  col = mix(col, uC3, glow * 0.75);
  gl_FragColor = vec4(col, 1.0);
}`;

function GradientPlane({ animate }: { animate: boolean }) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        depthWrite: false,
        uniforms: {
          uTime: { value: 8 },
          uC1: { value: new THREE.Vector3(...hexToRgb(HERO_COLORS[0])) },
          uC2: { value: new THREE.Vector3(...hexToRgb(HERO_COLORS[1])) },
          uC3: { value: new THREE.Vector3(...hexToRgb(HERO_COLORS[2])) },
        },
      }),
    [],
  );
  useFrame((_, delta) => {
    if (animate) material.uniforms.uTime!.value += delta;
  });
  return (
    <mesh renderOrder={-1} frustumCulled={false} material={material}>
      <planeGeometry args={[2, 2]} />
    </mesh>
  );
}

/** Знак «o›» в объёме, как на сайте: стеклянное кольцо и белая стрелка. */
function BrandMark({ animate }: { animate: boolean }) {
  const group = useRef<THREE.Group>(null);
  const { size } = useThree();
  const place = heroMarkPlacement(size.width, size.height);
  useFrame(({ clock }) => {
    if (!group.current || !animate) return;
    const t = clock.getElapsedTime();
    group.current.rotation.y = Math.sin(t * 0.6) * 0.35;
    group.current.rotation.x = Math.cos(t * 0.5) * 0.12;
    group.current.position.y = place.y + Math.sin(t * 1.1) * 0.06;
  });
  return (
    <group ref={group} position={[place.x, place.y, 0]} scale={place.scale}>
      <mesh position={[-0.5, 0, 0]}>
        <torusGeometry args={[0.62, 0.24, 32, 96]} />
        <meshPhysicalMaterial transmission={0.92} thickness={0.6} roughness={0.15} ior={1.4} color="#ffffff" attenuationColor="#dfe5ff" attenuationDistance={3} clearcoat={1} emissive="#5a72ff" emissiveIntensity={0.25} />
      </mesh>
      <group position={[1.02, 0, 0.1]}>
        {[1, -1].map((s) => (
          <mesh key={s} position={[-0.21, 0.21 * s, 0]} rotation={[0, 0, (Math.PI / 4) * s]}>
            <capsuleGeometry args={[0.12, 0.6, 8, 24]} />
            <meshPhysicalMaterial color="#e4e8ff" roughness={0.18} clearcoat={1} clearcoatRoughness={0.08} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/** Сбой GL (старый телефон, потеря контекста) — тихо остаёмся на статичном градиенте. */
class GlBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

export default function HeroScene({ animate }: { animate: boolean }) {
  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} pointerEvents="none">
      <GlBoundary>
        <Canvas flat linear frameloop={animate ? 'always' : 'demand'} camera={{ position: [0, 0, 5], fov: 45 }} gl={{ antialias: true }}>
          <ambientLight intensity={1.2} />
          <directionalLight position={[3, 4, 5]} intensity={2.4} />
          <directionalLight position={[-4, -1, 3]} intensity={0.8} color="#b9c3ff" />
          <GradientPlane animate={animate} />
          <BrandMark animate={animate} />
        </Canvas>
      </GlBoundary>
    </View>
  );
}
