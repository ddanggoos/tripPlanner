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

export function flyToPlace(place) {
  if (!map || !Number.isFinite(place.lat) || !Number.isFinite(place.lng)) return;
  map.flyTo([place.lat, place.lng], 16, { duration: 0.8, easeLinearity: 0.25 });
  window.setTimeout(() => {
    markersLayer?.eachLayer((layer) => {
      const latlng = layer.getLatLng?.();
      if (!latlng) return;
      if (Math.abs(latlng.lat - place.lat) < 1e-6 && Math.abs(latlng.lng - place.lng) < 1e-6) {
        layer.openPopup();
      }
    });
  }, 450);
}

export function parseGoogleMapsInput(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const looksLikeUrl = /google\.[^/]*\/maps|maps\.app\.goo\.gl|maps\.google\./i.test(raw);
  if (!looksLikeUrl && !raw.startsWith("http")) return null;

  const at = raw.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (at) {
    const placePart = raw.match(/\/place\/([^/@]+)/);
    const title = placePart ? decodeURIComponent(placePart[1].replace(/\+/g, " ")) : "";
    return { title, lat: Number(at[1]), lng: Number(at[2]) };
  }

  try {
    const url = new URL(raw);
    const q = url.searchParams.get("q") || url.searchParams.get("query") || url.searchParams.get("destination");
    if (q) {
      const coord = q.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
      if (coord) return { title: "", lat: Number(coord[1]), lng: Number(coord[2]) };
      return { title: q, lat: null, lng: null, query: q };
    }
    const ll = url.searchParams.get("ll");
    if (ll) {
      const [lat, lng] = ll.split(",").map(Number);
      if (Number.isFinite(lat) && Number.isFinite(lng)) return { title: "", lat, lng };
    }
  } catch {
    return null;
  }
  return looksLikeUrl ? { title: "", lat: null, lng: null, shortLink: true } : null;
}

export function googleMapsUrl(place) {
  if (Number.isFinite(place.lat) && Number.isFinite(place.lng)) {
    return `https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lng}`;
  }
  const q = encodeURIComponent(place.title || place.query || "");
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
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
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#007aff";
    L.polyline(points, {
      color: accent,
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
  const fromGoogle = parseGoogleMapsInput(query);
  if (fromGoogle) {
    if (Number.isFinite(fromGoogle.lat) && Number.isFinite(fromGoogle.lng)) {
      return [{
        title: fromGoogle.title || "구글 지도 장소",
        label: `${fromGoogle.lat.toFixed(5)}, ${fromGoogle.lng.toFixed(5)}`,
        lat: fromGoogle.lat,
        lng: fromGoogle.lng,
      }];
    }
    if (fromGoogle.shortLink) {
      throw new Error("짧은 링크는 좌표를 못 읽습니다. 구글 지도에서 공유 → 링크 복사를 전체 주소로 해 주세요.");
    }
    if (fromGoogle.query) return searchPlaces(fromGoogle.query);
  }
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
