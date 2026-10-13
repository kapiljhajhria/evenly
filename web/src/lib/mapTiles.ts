import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

/**
 * Raster tiles, chosen at build time. The default is OpenStreetMap's own
 * server, which allows light use with attribution and no key — fine for a
 * group app, but not a promise of capacity. For a keyed provider (MapTiler,
 * Stadia, Thunderforest) set both variables; see DEPLOY.md. Attribution is a
 * licence condition, never optional. (CARTO's basemaps, once keyless, now
 * watermark every tile without one.)
 *
 * Imports Leaflet: only import this from modules that are loaded on demand.
 */
const TILES = import.meta.env.VITE_MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION =
  import.meta.env.VITE_MAP_TILE_ATTRIBUTION ||
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

export function addTiles(map: L.Map): L.TileLayer {
  return L.tileLayer(TILES, { attribution: ATTRIBUTION, maxZoom: 19 }).addTo(map);
}
