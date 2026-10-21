// Point-in-polygon over Esri JSON rings. Even-odd across all rings handles holes and multipart shapes.

export function ringsBbox(rings) {
  let xmin = Infinity; let ymin = Infinity; let xmax = -Infinity; let ymax = -Infinity;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < xmin) xmin = x; if (x > xmax) xmax = x;
      if (y < ymin) ymin = y; if (y > ymax) ymax = y;
    }
  }
  return [xmin, ymin, xmax, ymax];
}

export function pointInRings(x, y, rings) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** features: [{attributes, geometry:{rings}}] -> index for fast lookups. */
export function buildIndex(features) {
  return features
    .filter((f) => f.geometry?.rings?.length)
    .map((f) => ({ attributes: f.attributes, rings: f.geometry.rings, bbox: ringsBbox(f.geometry.rings) }));
}

export function locateIn(index, x, y) {
  for (const f of index) {
    const [a, b, c, d] = f.bbox;
    if (x < a || x > c || y < b || y > d) continue;
    if (pointInRings(x, y, f.rings)) return f;
  }
  return null;
}
