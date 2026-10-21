/**
 * Где стоит 3D-знак перед камерой: на широком экране — в правой половине,
 * на узком — над заголовком. Считаем в единицах сцены на расстоянии `distance`,
 * чтобы знак не уезжал за край при любом соотношении сторон.
 */
export function markPlacement(width: number, height: number, fovDeg = 45, distance = 2) {
  const aspect = width > 0 && height > 0 ? width / height : 1;
  const viewH = 2 * distance * Math.tan(((fovDeg * Math.PI) / 180) / 2);
  const viewW = viewH * aspect;
  if (aspect >= 1.15) {
    // Знак шириной ~2.8 единицы: не крупнее трети ширины и 45% высоты.
    const scale = Math.min(viewW / 3 / 2.8, (viewH * 0.45) / 1.4, 1.5);
    return { x: viewW * 0.22, y: viewH * 0.13, distance, scale };
  }
  const scale = Math.min((viewW * 0.6) / 2.8, (viewH * 0.24) / 1.4, 1.2);
  return { x: 0, y: viewH * 0.3, distance, scale };
}
