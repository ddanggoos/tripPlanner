const OSM_TILE = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

let map = null;
let markersLayer = null;
let routeLayer = null;
let clickHandler = null;

export function destroyMap() {
  if (map) {
    map.remove();
    map = null;
    markersLayer = null;
    routeLayer = null;
    clickHandler = null;
  }
}

export function initMap(container, { onClick } = {}) {
  if (map && map.getContainer() !== container) destroyMap();
  if (!map) {
    map = L.map(container, {
      zoomControl: false,
      attributionControl: true,
    });
    L.tileLayer(OSM_TILE, {
      attribution: OSM_ATTR,
      maxZoom: 19,
    }).addTo(map);
    L.control.zoom({ position: "bottomright" }).addTo(map);
    markersLayer = L.layerGroup().addTo(map);
    routeLayer = L.layerGroup().addTo(map);
    map.setView([37.5665, 126.978], 12);
  }
  if (clickHandler) map.off("click", clickHandler);
  clickHandler = (event) => onClick?.(event.latlng);
  map.on("click", clickHandler);
  window.setTimeout(() => map.invalidateSize(), 80);
  window.setTimeout(() => map.invalidateSize(), 320);
  return map;
}

export function drawRoute(places) {
  if (!map || !markersLayer || !routeLayer) return;
  markersLayer.clearLayers();
  routeLayer.clearLayers();

  const points = places
    .filter((place) => Number.isFinite(place.lat) && Number.isFinite(place.lng))
    .map((place) => [place.lat, place.lng]);

  places.forEach((place, index) => {
    if (!Number.isFinite(place.lat) || !Number.isFinite(place.lng)) return;
    const marker = L.marker([place.lat, place.lng], {
      icon: numberedIcon(index + 1),
      title: place.title,
    });
    marker.bindPopup(`
      <strong>${escapeHtml(place.title || "장소")}</strong><br>
      ${place.time ? `${escapeHtml(place.time)} · ` : ""}${index + 1}번째
    `);
    markersLayer.addLayer(marker);
  });

  if (points.length >= 2) {
    L.polyline(points, {
      color: "#c45c26",
      weight: 4,
      opacity: 0.9,
      lineJoin: "round",
      lineCap: "round",
    }).addTo(routeLayer);
  }

  if (points.length === 1) {
    map.setView(points[0], 15);
  } else if (points.length > 1) {
    map.fitBounds(points, { padding: [40, 40], maxZoom: 16 });
  }
  window.setTimeout(() => map.invalidateSize(), 60);
}

export async function searchPlaces(query) {
  const q = query.trim();
  if (q.length < 2) return [];
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("q", q);
  url.searchParams.set("limit", "6");
  url.searchParams.set("addressdetails", "0");
  const res = await fetch(url, {
    headers: { Accept: "application/json", "Accept-Language": "ko" },
  });
  if (!res.ok) throw new Error("검색에 실패했습니다.");
  const data = await res.json();
  return data.map((item) => ({
    title: item.display_name.split(",")[0],
    label: item.display_name,
    lat: Number(item.lat),
    lng: Number(item.lon),
  }));
}

function numberedIcon(n) {
  return L.divIcon({
    className: "num-marker",
    html: `<span>${n}</span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -16],
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
