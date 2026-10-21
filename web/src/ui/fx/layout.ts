/**
 * Где стоит 3D-знак перед камерой: на широком экране — в правой половине,
 * на узком — над заголовком. Считаем в единицах сцены на расстоянии `distance`,
 * чтобы знак не уезжал за край при любом соотношении сторон.
 */
export type MarkMode = 'landing' | 'side';

export function markPlacement(width: number, height: number, fovDeg = 45, distance = 2, mode: MarkMode = 'landing') {
  const aspect = width > 0 && height > 0 ? width / height : 1;
  const viewH = 2 * distance * Math.tan(((fovDeg * Math.PI) / 180) / 2);
  const viewW = viewH * aspect;
  if (mode === 'side') {
    // Шапка экрана: знак сбоку и не спорит с текстом — справа по центру, на узком — в правом верхнем углу.
    const scale = Math.min((viewW * 0.3) / 2.8, (viewH * 0.55) / 1.7);
    const x = viewW / 2 - (2.8 * scale) / 2 - viewW * 0.05;
    const y = aspect >= 1.15 ? 0 : viewH / 2 - (1.7 * scale) / 2 - viewH * 0.06;
    return { x, y, distance, scale };
  }
  if (aspect >= 1.15) {
    // Знак шириной ~2.8 единицы: не крупнее трети ширины и 45% высоты.
    const scale = Math.min(viewW / 3 / 2.8, (viewH * 0.45) / 1.4, 1.5);
    return { x: viewW * 0.22, y: viewH * 0.13, distance, scale };
  }
  const scale = Math.min((viewW * 0.6) / 2.8, (viewH * 0.24) / 1.4, 1.2);
  return { x: 0, y: viewH * 0.3, distance, scale };
}

/**
 * Высоты столбиков 3D-графика «было → сейчас → цель». Шкала начинается не с нуля,
 * а с половины меньшего значения: иначе 40 и 30 минут выглядят почти одинаково,
 * а смысл графика как раз в разнице. Самый высокий столбик — ровно `height`.
 */
export function kpiBarHeights(values: number[], height = 2): number[] {
  if (!values.length) return [];
  const max = Math.max(...values);
  const floor = Math.min(...values) * 0.5;
  const span = max - floor;
  if (!(span > 0)) return values.map(() => height);
  return values.map((v) => Math.max(0.05, ((v - floor) / span) * height));
}
