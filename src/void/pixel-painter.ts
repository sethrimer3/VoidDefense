/** Hard-edged world-pixel primitives. Canvas smoothing does not disable path or
 * fractional-rectangle antialiasing, so rasterize those explicitly on the cell grid. */
type Point = { x: number; y: number };

export function pixelPainter(context: CanvasRenderingContext2D): CanvasRenderingContext2D {
  let paths: Point[][] = [];
  let current: Point[] = [];
  const transformed = (x: number, y: number): Point => {
    const t = context.getTransform();
    return { x: t.a * x + t.c * y + t.e, y: t.b * x + t.d * y + t.f };
  };
  const move = (x: number, y: number): void => {
    current = [transformed(x, y)];
    paths.push(current);
  };
  const line = (x: number, y: number): void => {
    if (!current.length) move(x, y);
    else current.push(transformed(x, y));
  };
  const identity = (paint: () => void): void => {
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    paint();
    context.restore();
  };
  const polygon = (points: Point[]): void => {
    if (points.length < 3) return;
    const minY = Math.max(0, Math.floor(Math.min(...points.map(p => p.y))));
    const maxY = Math.min(context.canvas.height - 1, Math.ceil(Math.max(...points.map(p => p.y))));
    for (let y = minY; y <= maxY; y++) {
      const hits: number[] = [];
      for (let i = 0; i < points.length; i++) {
        const a = points[i], b = points[(i + 1) % points.length];
        if ((a.y <= y + 0.5 && b.y > y + 0.5) || (b.y <= y + 0.5 && a.y > y + 0.5)) {
          hits.push(a.x + (y + 0.5 - a.y) * (b.x - a.x) / (b.y - a.y));
        }
      }
      hits.sort((a, b) => a - b);
      for (let i = 0; i + 1 < hits.length; i += 2) {
        const x = Math.max(0, Math.ceil(hits[i] - 0.5));
        const end = Math.min(context.canvas.width, Math.ceil(hits[i + 1] - 0.5));
        if (end > x) context.fillRect(x, y, end - x, 1);
      }
    }
  };
  const stroke = (lines = paths): void => identity(() => {
    context.fillStyle = context.strokeStyle;
    const width = Math.max(1, Math.round(context.lineWidth));
    const covered = new Set<number>();
    const dash = context.getLineDash().map(n => Math.max(1, Math.round(n)));
    let dashIndex = 0, dashLeft = dash[0] ?? Infinity;
    for (const points of lines) for (let i = 1; i < points.length; i++) {
      let x = Math.round(points[i - 1].x), y = Math.round(points[i - 1].y);
      const tx = Math.round(points[i].x), ty = Math.round(points[i].y);
      const dx = Math.abs(tx - x), dy = -Math.abs(ty - y);
      const sx = x < tx ? 1 : -1, sy = y < ty ? 1 : -1;
      let error = dx + dy;
      for (;;) {
        if (dashIndex % 2 === 0) {
          for (let yy = y - Math.floor(width / 2); yy < y - Math.floor(width / 2) + width; yy++) {
            for (let xx = x - Math.floor(width / 2); xx < x - Math.floor(width / 2) + width; xx++) {
              if (xx < 0 || yy < 0 || xx >= context.canvas.width || yy >= context.canvas.height) continue;
              const key = yy * context.canvas.width + xx;
              if (!covered.has(key)) { context.fillRect(xx, yy, 1, 1); covered.add(key); }
            }
          }
        }
        if (--dashLeft <= 0) { dashIndex = (dashIndex + 1) % dash.length; dashLeft = dash[dashIndex]; }
        if (x === tx && y === ty) break;
        const twice = 2 * error;
        if (twice >= dy) { error += dy; x += sx; }
        if (twice <= dx) { error += dx; y += sy; }
      }
    }
  });
  const ellipse = (x: number, y: number, rx: number, ry: number, rotation: number,
    start: number, end: number, anticlockwise = false): void => {
    let span = end - start;
    if (!anticlockwise && span < 0) span = span % (Math.PI * 2) + Math.PI * 2;
    if (anticlockwise && span > 0) span = span % (Math.PI * 2) - Math.PI * 2;
    span = Math.max(-Math.PI * 2, Math.min(Math.PI * 2, span));
    const steps = Math.max(4, Math.ceil(Math.abs(span) * Math.max(rx, ry) * 2));
    const matrix = context.getTransform();
    for (let i = 0; i <= steps; i++) {
      const angle = start + span * i / steps;
      const px = x + Math.cos(angle) * rx * Math.cos(rotation) - Math.sin(angle) * ry * Math.sin(rotation);
      const py = y + Math.cos(angle) * rx * Math.sin(rotation) + Math.sin(angle) * ry * Math.cos(rotation);
      const point = { x: matrix.a * px + matrix.c * py + matrix.e,
        y: matrix.b * px + matrix.d * py + matrix.f };
      if (!current.length) { current = []; paths.push(current); }
      current.push(point);
    }
  };
  const rectangle = (x: number, y: number, w: number, h: number): Point[] => {
    x = Math.floor(x); y = Math.floor(y);
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    return [transformed(x, y), transformed(x + w, y), transformed(x + w, y + h), transformed(x, y + h)];
  };
  const methods: Record<string, (...args: any[]) => void> = {
    beginPath: () => { paths = []; current = []; },
    moveTo: move, lineTo: line,
    arc: (x, y, r, start, end, ccw) => ellipse(x, y, r, r, 0, start, end, ccw),
    ellipse,
    fill: () => identity(() => { for (const points of paths) polygon(points); }),
    stroke,
    fillRect: (x, y, w, h) => {
      const t = context.getTransform();
      // Sprites, beams and debris overwhelmingly use the unrotated world grid.
      // Keep that common path as one native integer fill instead of a polygon.
      if (t.a === 1 && t.b === 0 && t.c === 0 && t.d === 1 && t.e === 0 && t.f === 0) {
        context.fillRect(Math.floor(x), Math.floor(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
      } else {
        const points = rectangle(x, y, w, h);
        identity(() => polygon(points));
      }
    },
    strokeRect: (x, y, w, h) => { const points = rectangle(x, y, w, h); stroke([[...points, points[0]]]); },
  };
  return new Proxy(context, {
    get(target, key) {
      if (typeof key === 'string' && methods[key]) return methods[key];
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
    set(target, key, value) { return Reflect.set(target, key, value, target); },
  });
}
