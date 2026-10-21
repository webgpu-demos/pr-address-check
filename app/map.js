// Map: TIGERweb boundaries (the same polygons the checks use), the result point, candidates and batch results.

const STATUS_STYLE = {
  'Compliant': { color: [29, 95, 191, 1], outline: [255, 255, 255, 1], label: 'Compliant' },
  'Compliant with warnings': { color: [255, 255, 255, 1], outline: [29, 95, 191, 1], label: 'With warnings' },
  'Not compliant': { color: [20, 20, 20, 1], outline: [255, 255, 255, 1], label: 'Not compliant' },
  'Needs review': { color: [180, 54, 29, 1], outline: [255, 255, 255, 1], label: 'Needs review' },
};

export async function createMap(mapEl, { hasEsriKey, onPick, onBatchSelect }) {
  const [Map, Basemap, OpenStreetMapLayer, GraphicsLayer, FeatureLayer, Graphic, Polygon, Point] = await $arcgis.import([
    '@arcgis/core/Map.js', '@arcgis/core/Basemap.js', '@arcgis/core/layers/OpenStreetMapLayer.js',
    '@arcgis/core/layers/GraphicsLayer.js', '@arcgis/core/layers/FeatureLayer.js', '@arcgis/core/Graphic.js',
    '@arcgis/core/geometry/Polygon.js', '@arcgis/core/geometry/Point.js',
  ]);

  const osm = (gray) => new Basemap({
    baseLayers: [new OpenStreetMapLayer(gray ? { effect: 'grayscale(100%) brightness(1.04) contrast(0.92)' } : {})],
    title: gray ? 'Light' : 'OpenStreetMap',
  });
  const basemapFor = (id) => {
    if (id === 'imagery' && hasEsriKey) return 'arcgis/imagery';
    if (id === 'light' && hasEsriKey) return 'arcgis/light-gray';
    if (id === 'osm') return osm(false);
    return osm(true);
  };

  const map = new Map({ basemap: basemapFor('light') });
  mapEl.map = map;
  mapEl.constraints = { minZoom: 7 };
  await mapEl.viewOnReady();

  const layers = { municipio: null, barrio: null, zcta: null, batch: null };
  const result = new GraphicsLayer({ title: 'Result', listMode: 'hide' });
  map.add(result);

  function polygonLayer(key, features, opts) {
    const graphics = features.map((f, i) => new Graphic({
      geometry: new Polygon({ rings: f.rings, spatialReference: { wkid: 4326 } }),
      attributes: { oid: i + 1, name: f.attributes.BASENAME ?? f.attributes.ZCTA5 ?? '', geoid: f.attributes.GEOID ?? '' },
    }));
    const layer = new FeatureLayer({
      title: opts.title,
      source: graphics,
      objectIdField: 'oid',
      fields: [{ name: 'oid', type: 'oid' }, { name: 'name', type: 'string' }, { name: 'geoid', type: 'string' }],
      geometryType: 'polygon',
      spatialReference: { wkid: 4326 },
      renderer: { type: 'simple', symbol: { type: 'simple-fill', color: [0, 0, 0, 0], outline: opts.outline } },
      labelingInfo: [{
        labelExpressionInfo: { expression: '$feature.name' },
        symbol: { type: 'text', color: opts.labelColor, haloColor: [255, 255, 255, 0.9], haloSize: 1.2,
          font: { family: 'Noto Sans', size: opts.labelSize, weight: opts.labelWeight ?? 'normal' } },
        minScale: opts.labelMinScale,
      }],
      minScale: opts.minScale ?? 0,
      visible: opts.visible ?? true,
      popupEnabled: false,
    });
    map.add(layer, opts.index ?? 0);
    layers[key] = layer;
    return layer;
  }

  function addBoundaries(gis) {
    const f = (k) => gis.features(k);
    if (f('zcta')?.length && !layers.zcta) {
      polygonLayer('zcta', f('zcta'), { title: 'ZIP areas (ZCTA)', outline: { color: [29, 95, 191, 0.55], width: 0.8, style: 'dash' },
        labelColor: [29, 95, 191, 1], labelSize: 9, labelMinScale: 120000, visible: false, index: 0 });
    }
    if (f('barrio')?.length && !layers.barrio) {
      polygonLayer('barrio', f('barrio'), { title: 'Barrios', outline: { color: [128, 125, 119, 0.7], width: 0.5 },
        labelColor: [110, 107, 101, 1], labelSize: 9, labelMinScale: 90000, minScale: 700000, index: 1 });
    }
    if (f('municipio')?.length && !layers.municipio) {
      polygonLayer('municipio', f('municipio'), { title: 'Municipios', outline: { color: [20, 20, 20, 0.85], width: 1.1 },
        labelColor: [20, 20, 20, 1], labelSize: 10.5, labelWeight: 'bold', labelMinScale: 1200000, index: 2 });
    }
  }

  const ringsPolygon = (rings) => new Polygon({ rings, spatialReference: { wkid: 4326 } });

  function showResult(r) {
    result.removeAll();
    if (!r) return;
    const shapes = r.place?.shapes ?? {};
    if (shapes.municipio) {
      result.add(new Graphic({ geometry: ringsPolygon(shapes.municipio), symbol: { type: 'simple-fill', color: [0, 0, 0, 0], outline: { color: [20, 20, 20, 1], width: 2.2 } } }));
    }
    if (shapes.barrio) {
      result.add(new Graphic({ geometry: ringsPolygon(shapes.barrio), symbol: { type: 'simple-fill', color: [29, 95, 191, 0.08], outline: { color: [29, 95, 191, 0.9], width: 1.4 } } }));
    }
    for (const c of r.candidates ?? []) {
      if (r.best && c.lon === r.best.lon && c.lat === r.best.lat) continue;
      result.add(new Graphic({
        geometry: new Point({ longitude: c.lon, latitude: c.lat }),
        symbol: { type: 'simple-marker', style: 'circle', size: 7, color: [255, 255, 255, 0.9], outline: { color: [128, 125, 119, 1], width: 1 } },
        attributes: { kind: 'candidate' },
      }));
    }
    if (r.rival) {
      result.add(new Graphic({
        geometry: new Point({ longitude: r.rival.lon, latitude: r.rival.lat }),
        symbol: { type: 'simple-marker', style: 'circle', size: 13, color: [0, 0, 0, 0], outline: { color: [180, 54, 29, 1], width: 2 } },
      }));
    }
    if (r.best) {
      const pt = new Point({ longitude: r.best.lon, latitude: r.best.lat });
      result.add(new Graphic({ geometry: pt, symbol: { type: 'simple-marker', style: 'circle', size: 22, color: [29, 95, 191, 0.14], outline: { color: [29, 95, 191, 0], width: 0 } } }));
      result.add(new Graphic({ geometry: pt, symbol: { type: 'simple-marker', style: 'circle', size: 11, color: [29, 95, 191, 1], outline: { color: [255, 255, 255, 1], width: 2 } } }));
      const zoom = { rooftop: 17, interpolated: 16, street: 15, area: 13 }[r.best.precision] ?? 14;
      mapEl.goTo({ target: pt, zoom }, { duration: 600 }).catch(() => {});
    } else if (shapes.municipio) {
      mapEl.goTo(ringsPolygon(shapes.municipio)).catch(() => {});
    }
  }

  function zoomToCandidate(c) {
    mapEl.goTo({ target: new Point({ longitude: c.lon, latitude: c.lat }), zoom: 17 }, { duration: 400 }).catch(() => {});
  }

  function showBatch(rows) {
    if (layers.batch) { map.remove(layers.batch); layers.batch = null; }
    const pts = rows.map((row, i) => ({ row, i })).filter(({ row }) => row.result?.best && row.result.location !== 'outside');
    if (!pts.length) return;
    const graphics = pts.map(({ row, i }) => new Graphic({
      geometry: new Point({ longitude: row.result.best.lon, latitude: row.result.best.lat }),
      attributes: { oid: i + 1, idx: i, status: row.result.compliance, mode: row.result.mode },
    }));
    const uniqueValueInfos = Object.entries(STATUS_STYLE).map(([value, s]) => ({
      value, label: s.label, symbol: { type: 'simple-marker', size: 8, color: s.color, outline: { color: s.outline, width: 1.2 } },
    }));
    const layer = new FeatureLayer({
      title: 'Batch results', source: graphics, objectIdField: 'oid', geometryType: 'point', spatialReference: { wkid: 4326 },
      fields: [{ name: 'oid', type: 'oid' }, { name: 'idx', type: 'integer' }, { name: 'status', type: 'string' }, { name: 'mode', type: 'string' }],
      renderer: { type: 'unique-value', field: 'status', uniqueValueInfos, defaultSymbol: { type: 'simple-marker', size: 7, color: [128, 125, 119, 1], outline: { color: [255, 255, 255, 1], width: 1 } } },
      featureReduction: {
        type: 'cluster', clusterRadius: '44px', clusterMinSize: '18px', clusterMaxSize: '40px',
        symbol: { type: 'simple-marker', color: [20, 20, 20, 0.85], outline: { color: [255, 255, 255, 1], width: 1.5 } },
        labelingInfo: [{ deconflictionStrategy: 'none', labelPlacement: 'center-center',
          labelExpressionInfo: { expression: "Text($feature.cluster_count, '#,###')" },
          symbol: { type: 'text', color: 'white', font: { family: 'Noto Sans', size: 9, weight: 'bold' } } }],
      },
      popupEnabled: false,
    });
    map.add(layer);
    layers.batch = layer;
    layer.when(() => layer.queryExtent().then((r) => r.extent && mapEl.goTo(r.extent.expand(1.3)).catch(() => {}))).catch(() => {});
  }

  let picking = false;
  mapEl.addEventListener('arcgisViewClick', async (e) => {
    const pt = e.detail.mapPoint;
    if (picking) {
      picking = false;
      onPick?.({ lon: pt.longitude, lat: pt.latitude });
      return;
    }
    if (layers.batch?.visible) {
      const hit = await mapEl.hitTest(e.detail, { include: [layers.batch] });
      const g = hit.results.find((h) => h.graphic?.attributes?.idx !== undefined)?.graphic;
      if (g && !g.isAggregate) onBatchSelect?.(g.attributes.idx);
      else if (g?.isAggregate) mapEl.goTo({ target: g.geometry, zoom: mapEl.zoom + 2 }).catch(() => {});
    }
  });

  return {
    addBoundaries,
    showResult,
    showBatch,
    zoomToCandidate,
    setLayerVisible: (k, v) => { if (layers[k]) layers[k].visible = v; },
    setBasemap: (id) => { map.basemap = basemapFor(id); },
    startPick: () => { picking = true; },
    cancelPick: () => { picking = false; },
  };
}
