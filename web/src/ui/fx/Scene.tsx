import { ShaderGradient, ShaderGradientCanvas } from '@shadergradient/react';
import { BrandMark3D } from './BrandMark3D';
import { gradientLook, type GradientVariant, type SectionVariant } from './gradients';
import { SectionGlyph3D } from './SectionGlyph3D';
import type { MarkMode } from './layout';

/**
 * WebGL-часть: живой градиент ShaderGradient и в той же сцене 3D-знак offix
 * (главная, Пульс) или стеклянный знак раздела (рабочие экраны).
 * Загружается отдельным чанком, чтобы не тормозить первый экран.
 */
export default function Scene({
  variant,
  dark,
  animate,
  mark,
  markMode,
  glyph,
}: {
  variant: GradientVariant;
  dark: boolean;
  animate: boolean;
  mark: boolean;
  markMode?: MarkMode;
  glyph?: SectionVariant;
}) {
  const g = gradientLook(variant, dark);
  return (
    <ShaderGradientCanvas style={{ position: 'absolute', inset: 0 }} pixelDensity={Math.min(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, 1.5)} fov={45} pointerEvents="none">
      <ShaderGradient
        control="props"
        type={g.type}
        animate={animate ? 'on' : 'off'}
        uTime={animate ? 0 : 1.6}
        uSpeed={g.uSpeed}
        uStrength={g.uStrength}
        uDensity={g.uDensity}
        uFrequency={g.uFrequency}
        uAmplitude={1}
        color1={g.colors[0]}
        color2={g.colors[1]}
        color3={g.colors[2]}
        brightness={g.brightness}
        cDistance={g.cDistance}
        cPolarAngle={g.cPolarAngle}
        cAzimuthAngle={g.cAzimuthAngle}
        cameraZoom={1}
        rotationX={g.rotation[0]}
        rotationY={g.rotation[1]}
        rotationZ={g.rotation[2]}
        positionX={g.position[0]}
        positionY={g.position[1]}
        positionZ={g.position[2]}
        reflection={0.1}
        lightType="3d"
        grain="off"
        enableTransition={false}
      />
      {mark && <BrandMark3D animate={animate} mode={markMode} />}
      {glyph && !mark && <SectionGlyph3D kind={glyph} animate={animate} />}
    </ShaderGradientCanvas>
  );
}
