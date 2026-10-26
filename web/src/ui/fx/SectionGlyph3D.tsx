import { Environment, Float, Lightformer, RoundedBox } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import type { SectionVariant } from './gradients';
import { glyphPlacement } from './layout';
import { useMediaQuery } from './support';

/**
 * Стеклянный знак раздела в шапке: мишень у целей, стопка карточек у задач,
 * столбики у отчёта, раскрытая книга у базы знаний и так далее. Тот же язык,
 * что у 3D-знака offix на Пульсе, но у каждого раздела — свой предмет.
 *
 * Стекло — встроенная прозрачность three.js (transmission): один общий проход
 * на всю сцену, поэтому даже знак из нескольких деталей не тяжелее одного.
 */
export function SectionGlyph3D({ kind, animate }: { kind: SectionVariant; animate: boolean }) {
  const rig = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const { camera, size } = useThree();
  const narrow = useMediaQuery('(max-width: 900px)');
  const place = glyphPlacement(size.width, size.height, narrow, (camera as THREE.PerspectiveCamera).fov ?? 45, 2);

  useFrame((state, delta) => {
    if (!rig.current || !body.current) return;
    rig.current.position.copy(state.camera.position);
    rig.current.quaternion.copy(state.camera.quaternion);
    if (!animate) return;
    const k = 1 - Math.exp(-delta * 3);
    body.current.rotation.y += (state.pointer.x * 0.5 - body.current.rotation.y) * k;
    body.current.rotation.x += (-state.pointer.y * 0.3 - body.current.rotation.x) * k;
  });

  const shape = <group ref={body}>{GLYPHS[kind]()}</group>;

  return (
    <group ref={rig}>
      <Environment resolution={128} frames={1}>
        <Lightformer form="rect" intensity={4} position={[0, 4, 4]} scale={[8, 2, 1]} />
        <Lightformer form="rect" intensity={2} position={[-5, 0, 2]} rotation-y={Math.PI / 2} scale={[6, 2, 1]} />
        <Lightformer form="rect" intensity={1.6} position={[5, -1, 1]} rotation-y={-Math.PI / 2} scale={[6, 2, 1]} />
        <Lightformer form="ring" intensity={2.4} color="#c4ccff" position={[4, 1, 3]} scale={2} />
      </Environment>
      <group position={[place.x, place.y, -place.distance]} scale={place.scale}>
        <directionalLight position={[3, 4, 5]} intensity={2.2} />
        <ambientLight intensity={1} />
        {animate ? (
          <Float speed={1.3} rotationIntensity={0.3} floatIntensity={0.5}>
            {shape}
          </Float>
        ) : (
          shape
        )}
      </group>
    </group>
  );
}

/**
 * Стекло знаков. Знак часто стоит на тёмной части градиента, и чистое стекло
 * там почти пропадает, поэтому оно слегка молочное и с радужной плёнкой:
 * края ловят свет даже на чёрном.
 */
function Glass({ tint = '#f2f4ff' }: { tint?: string }) {
  return (
    <meshPhysicalMaterial
      transmission={0.9}
      thickness={0.5}
      roughness={0.12}
      ior={1.4}
      color={tint}
      attenuationColor="#dfe4ff"
      attenuationDistance={1.2}
      clearcoat={1}
      clearcoatRoughness={0.04}
      iridescence={0.7}
      iridescenceIOR={1.3}
      envMapIntensity={2.2}
    />
  );
}
function Solid() {
  return <meshPhysicalMaterial color="#f2f4ff" roughness={0.18} clearcoat={1} clearcoatRoughness={0.06} envMapIntensity={1.2} />;
}
/** Белая «галочка» из двух капсул, как штрихи «›» в знаке offix. */
function Check({ position, scale = 1 }: { position: [number, number, number]; scale?: number }) {
  return (
    <group position={position} scale={scale}>
      <mesh position={[-0.13, -0.04, 0]} rotation={[0, 0, Math.PI / 4]}>
        <capsuleGeometry args={[0.06, 0.18, 8, 16]} />
        <Solid />
      </mesh>
      <mesh position={[0.09, 0.07, 0]} rotation={[0, 0, -Math.PI / 4.6]}>
        <capsuleGeometry args={[0.06, 0.38, 8, 16]} />
        <Solid />
      </mesh>
    </group>
  );
}

const GLYPHS: Record<SectionVariant, () => ReactNode> = {
  // Мишень: три стеклянных кольца и белое «яблочко».
  goals: () => (
    <group rotation={[0.25, -0.35, 0]}>
      {[0.78, 0.5].map((r) => (
        <mesh key={r}>
          <torusGeometry args={[r, 0.1, 32, 96]} />
          <Glass />
        </mesh>
      ))}
      <mesh>
        <sphereGeometry args={[0.15, 32, 32]} />
        <Solid />
      </mesh>
    </group>
  ),
  // Задачи: чек-лист из стеклянных строк — первые две отмечены, у третьей пустой кружок.
  tasks: () => (
    <group rotation={[0.3, -0.45, 0.04]}>
      {[0.5, 0, -0.5].map((y, i) => (
        <group key={y} position={[i * 0.12 - 0.12, y, -i * 0.1]}>
          <RoundedBox args={[1.7, 0.36, 0.12]} radius={0.08} smoothness={4}>
            <Glass />
          </RoundedBox>
          {i < 2 ? (
            <Check position={[-0.6, 0, 0.12]} scale={0.7} />
          ) : (
            <mesh position={[-0.6, 0, 0.1]}>
              <torusGeometry args={[0.1, 0.03, 12, 48]} />
              <Solid />
            </mesh>
          )}
          <mesh position={[0.15, 0, 0.08]} rotation={[0, 0, Math.PI / 2]}>
            <capsuleGeometry args={[0.035, i === 2 ? 0.6 : 0.9, 6, 12]} />
            <Solid />
          </mesh>
        </group>
      ))}
    </group>
  ),
  // Отчёт: столбики, последний — белый, это «сейчас».
  report: () => (
    <group rotation={[0.3, -0.55, 0]} position={[0, -0.15, 0]}>
      {[0.55, 0.95, 0.75, 1.35].map((h, i) => (
        <RoundedBox key={i} args={[0.32, h, 0.32]} radius={0.08} smoothness={4} position={[(i - 1.5) * 0.44, h / 2 - 0.6, 0]}>
          {i === 3 ? <Solid /> : <Glass />}
        </RoundedBox>
      ))}
    </group>
  ),
  // База знаний: раскрытая книга, страницы чуть приподняты к зрителю; на правой — строки текста.
  knowledge: () => (
    <group rotation={[0.55, -0.25, 0.05]}>
      {[1, -1].map((side) => (
        <RoundedBox key={side} args={[0.98, 1.3, 0.06]} radius={0.03} smoothness={4} position={[0.5 * side, 0, -0.06]} rotation={[0, -0.28 * side, 0]}>
          <Glass />
        </RoundedBox>
      ))}
      <mesh>
        <capsuleGeometry args={[0.045, 1.24, 8, 16]} />
        <Solid />
      </mesh>
      {[0.36, 0.16, -0.04, -0.24].map((y, i) => (
        <mesh key={y} position={[0.5 - (i === 3 ? 0.1 : 0), y, 0.08]} rotation={[0, -0.28, Math.PI / 2]}>
          <capsuleGeometry args={[0.03, i === 3 ? 0.36 : 0.56, 6, 12]} />
          <Solid />
        </mesh>
      ))}
    </group>
  ),
  // Интеграции: два сцепленных звена — стеклянное и белое.
  integrations: () => (
    <group rotation={[0.2, -0.3, 0.35]}>
      <mesh position={[-0.36, 0, 0]}>
        <torusGeometry args={[0.5, 0.14, 32, 96]} />
        <Glass />
      </mesh>
      <mesh position={[0.36, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.5, 0.14, 32, 96]} />
        <Solid />
      </mesh>
    </group>
  ),
  // Уведомления: стеклянная сфера в кольце и белая точка нового.
  inbox: () => (
    <group rotation={[0.2, -0.3, 0]}>
      <mesh>
        <sphereGeometry args={[0.55, 48, 48]} />
        <Glass />
      </mesh>
      <mesh rotation={[1.2, 0.2, 0]}>
        <torusGeometry args={[0.82, 0.05, 16, 96]} />
        <Glass />
      </mesh>
      <mesh position={[0.5, 0.52, 0.2]}>
        <sphereGeometry args={[0.16, 32, 32]} />
        <Solid />
      </mesh>
    </group>
  ),
  // Организация: три человека-узла, связанные белыми перемычками.
  org: () => {
    const nodes: [number, number, number][] = [
      [0, 0.55, 0],
      [-0.6, -0.4, 0],
      [0.6, -0.4, 0],
    ];
    return (
      <group rotation={[0.25, -0.35, 0]}>
        {nodes.map((p, i) => (
          <mesh key={i} position={p}>
            <sphereGeometry args={[i === 0 ? 0.32 : 0.26, 40, 40]} />
            <Glass />
          </mesh>
        ))}
        {[1, 2].map((i) => {
          const a = new THREE.Vector3(...nodes[0]!);
          const b = new THREE.Vector3(...nodes[i]!);
          const mid = a.clone().add(b).multiplyScalar(0.5);
          const angle = Math.atan2(b.y - a.y, b.x - a.x) - Math.PI / 2;
          return (
            <mesh key={i} position={mid} rotation={[0, 0, angle]}>
              <capsuleGeometry args={[0.05, a.distanceTo(b) - 0.6, 8, 16]} />
              <Solid />
            </mesh>
          );
        })}
      </group>
    );
  },
  // Чаты: стеклянное облачко с хвостиком и белое поменьше с тремя точками «печатает».
  chats: () => (
    <group rotation={[0.22, -0.4, 0.04]}>
      <group position={[-0.22, 0.2, 0]}>
        <RoundedBox args={[1.5, 0.95, 0.3]} radius={0.3} smoothness={6}>
          <Glass />
        </RoundedBox>
        <mesh position={[-0.5, -0.5, 0]} rotation={[0, 0, Math.PI / 5]}>
          <coneGeometry args={[0.17, 0.36, 24]} />
          <Glass />
        </mesh>
      </group>
      <group position={[0.42, -0.42, 0.34]}>
        <RoundedBox args={[0.92, 0.56, 0.22]} radius={0.22} smoothness={6}>
          <Solid />
        </RoundedBox>
        {[-0.22, 0, 0.22].map((x) => (
          <mesh key={x} position={[x, 0, 0.13]}>
            <sphereGeometry args={[0.065, 24, 24]} />
            <meshPhysicalMaterial color="#3050ff" roughness={0.2} clearcoat={1} />
          </mesh>
        ))}
      </group>
    </group>
  ),
  // Новая цель: стеклянный кристалл и белая искра рядом.
  create: () => (
    <group rotation={[0.3, -0.4, 0.2]}>
      <mesh>
        <icosahedronGeometry args={[0.66, 0]} />
        <Glass />
      </mesh>
      <mesh position={[0.72, 0.5, 0.2]} rotation={[0.4, 0.6, 0]}>
        <octahedronGeometry args={[0.2, 0]} />
        <Solid />
      </mesh>
    </group>
  ),
};
