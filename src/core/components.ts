export type Component = {
  id: number;
  count: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

/** Eight-connected regions; bounds are exclusive at the right and bottom. */
export function connectedComponents(
  mask: Uint8Array,
  width: number,
  height: number,
) {
  const labels = new Int32Array(mask.length);
  const queue = new Int32Array(mask.length);
  const components: Component[] = [];
  let id = 0;
  for (let seed = 0; seed < mask.length; seed++) {
    if (!mask[seed] || labels[seed]) continue;
    id++;
    let head = 0;
    let tail = 1;
    queue[0] = seed;
    labels[seed] = id;
    const component = { id, count: 0, x0: width, y0: height, x1: 0, y1: 0 };
    while (head < tail) {
      const index = queue[head++]!;
      const x = index % width;
      const y = Math.floor(index / width);
      component.count++;
      component.x0 = Math.min(component.x0, x);
      component.y0 = Math.min(component.y0, y);
      component.x1 = Math.max(component.x1, x + 1);
      component.y1 = Math.max(component.y1, y + 1);
      for (
        let ny = Math.max(0, y - 1);
        ny <= Math.min(height - 1, y + 1);
        ny++
      ) {
        for (
          let nx = Math.max(0, x - 1);
          nx <= Math.min(width - 1, x + 1);
          nx++
        ) {
          const next = ny * width + nx;
          if (mask[next] && !labels[next]) {
            labels[next] = id;
            queue[tail++] = next;
          }
        }
      }
    }
    components.push(component);
  }
  return { components, labels };
}
