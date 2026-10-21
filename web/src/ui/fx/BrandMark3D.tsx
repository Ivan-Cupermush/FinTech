import { Environment, Float, Lightformer, MeshTransmissionMaterial } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import { markPlacement } from './layout';

/**
 * Знак offix в объёме: стеклянное «o» — где мы сейчас, белый «›» — куда движемся
 * (на синем фоне знак инвертирован, как светлая версия логотипа).
 * Знак привязан к камере градиента и стоит перед ней, поэтому стекло
 * преломляет живой градиент за собой. Слегка поворачивается за курсором.
 */
export function BrandMark3D({ animate }: { animate: boolean }) {
  const rig = useRef<THREE.Group>(null);
  const mark = useRef<THREE.Group>(null);
  const { camera, size } = useThree();
  const place = markPlacement(size.width, size.height, (camera as THREE.PerspectiveCamera).fov ?? 45);

  useFrame((state, delta) => {
    if (!rig.current || !mark.current) return;
    rig.current.position.copy(state.camera.position);
    rig.current.quaternion.copy(state.camera.quaternion);
    if (!animate) return;
    const k = 1 - Math.exp(-delta * 3);
    mark.current.rotation.y += (state.pointer.x * 0.45 - mark.current.rotation.y) * k;
    mark.current.rotation.x += (-state.pointer.y * 0.3 - mark.current.rotation.x) * k;
  });

  const body = (
    <group ref={mark}>
      <mesh position={[-0.5, 0, 0]}>
        <torusGeometry args={[0.62, 0.24, 48, 128]} />
        <MeshTransmissionMaterial
          samples={6}
          resolution={512}
          thickness={1.1}
          roughness={0.12}
          ior={1.45}
          chromaticAberration={0.12}
          anisotropicBlur={0.2}
          distortion={0.25}
          distortionScale={0.5}
          temporalDistortion={animate ? 0.08 : 0}
          backside
          backsideThickness={0.4}
          color="#eef1ff"
          attenuationColor="#c7d0ff"
          attenuationDistance={1.2}
          envMapIntensity={1.4}
        />
      </mesh>
      <group position={[1.02, 0, 0.1]}>
        {[1, -1].map((s) => (
          <mesh key={s} position={[-0.21, 0.21 * s, 0]} rotation={[0, 0, (Math.PI / 4) * s]}>
            <capsuleGeometry args={[0.12, 0.6, 12, 32]} />
            <meshPhysicalMaterial color="#e4e8ff" roughness={0.16} metalness={0} clearcoat={1} clearcoatRoughness={0.06} envMapIntensity={1.2} />
          </mesh>
        ))}
      </group>
    </group>
  );

  return (
    <group ref={rig}>
      {/* Отражения из «студийного света», собранного прямо в сцене: без загрузки HDR из сети. */}
      <Environment resolution={256} frames={1}>
        <Lightformer form="rect" intensity={3} position={[0, 4, 4]} scale={[8, 2, 1]} />
        <Lightformer form="rect" intensity={1.6} position={[-5, 0, 2]} rotation-y={Math.PI / 2} scale={[6, 2, 1]} />
        <Lightformer form="ring" intensity={2} color="#b9c3ff" position={[4, 1, 3]} scale={2} />
      </Environment>
      <group position={[place.x, place.y, -place.distance]} scale={place.scale}>
        <directionalLight position={[3, 4, 5]} intensity={2.4} />
        <ambientLight intensity={1.1} />
        {animate ? (
          <Float speed={1.4} rotationIntensity={0.35} floatIntensity={0.6}>
            {body}
          </Float>
        ) : (
          body
        )}
      </group>
    </group>
  );
}
