import { fetchMapsApiKey } from "./sync.js";

const OSM_TILE = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const SEOUL = { lat: 37.5665, lng: 126.978 };

let engine = null;
let leafletMap = null;
let leafletMarkers = null;
let leafletRoute = null;
let leafletClick = null;

let googleMap = null;
let googleMarkers = [];
let googleLine = null;
let googleInfo = null;
let googleClick = null;
let googleReady = false;
let googleFailed = false;
let googleLoad = null;
let autocompleteToken = null;

export function isGoogleMapsReady() {
  return googleReady;
}

function injectGoogleBootstrap(key) {
  if (window.google?.maps?.importLibrary) return;
  window.gm_authFailure = () => {
    googleFailed = true;
    googleReady = false;
  };
  ((g) => {
    var h, a, k, p = "The Google Maps JavaScript API", c = "google", l = "importLibrary", q = "__ib__", m = document, b = window;
    b = b[c] || (b[c] = {});
    var d = b.maps || (b.maps = {}), r = new Set, e = new URLSearchParams, u = () => h || (h = new Promise(async (f, n) => {
      await (a = m.createElement("script"));
      e.set("libraries", [...r] + "");
      for (k in g) e.set(k.replace(/[A-Z]/g, (t) => "_" + t[0].toLowerCase()), g[k]);
      e.set("callback", c + ".maps." + q);
      a.src = `https://maps.${c}apis.com/maps/api/js?` + e;
      d[q] = f;
      a.onerror = () => h = n(Error(p + " could not load."));
      a.nonce = m.querySelector("script[nonce]")?.nonce || "";
      m.head.append(a);
    }));
    d[l] ? console.warn(p + " only loads once. Ignoring:", g) : d[l] = (f, ...n) => r.add(f) && u().then(() => d[l](f, ...n));
  })({
    key,
    v: "weekly",
    language: "ko",
    region: "KR",
  });
}

export async function loadGoogleMaps() {
  if (googleReady) return true;
  if (googleFailed) return false;
  if (googleLoad) return googleLoad;
  googleLoad = (async () => {
    try {
      const key = await fetchMapsApiKey();
      if (!key) {
        googleLoad = null;
        return false;
      }
      injectGoogleBootstrap(key);
      await window.google.maps.importLibrary("maps");
      await window.google.maps.importLibrary("places");
      await new Promise((resolve) => window.setTimeout(resolve, 80));
      googleReady = !googleFailed;
      return googleReady;
    } catch (error) {
      console.warn("Google Maps init failed", error);
      googleFailed = true;
      googleReady = false;
      return false;
    }
  })();
  return googleLoad;
}

export function destroyMap() {
  if (leafletClick && leafletMap) leafletMap.off("click", leafletClick);
  if (leafletMap) {
    leafletMap.remove();
  }
  leafletMap = null;
  leafletMarkers = null;
  leafletRoute = null;
  leafletClick = null;

  googleClick?.remove?.();
  googleMarkers.forEach((marker) => {
    marker.map = null;
    marker.setMap?.(null);
  });
  googleLine?.setMap?.(null);
  googleInfo?.close?.();
  if (googleMap) {
    window.google?.maps?.event?.clearInstanceListeners?.(googleMap);
  }
  googleMap = null;
  googleMarkers = [];
  googleLine = null;
  googleInfo = null;
  googleClick = null;
  engine = null;
}

export async function initMap(container, { onClick } = {}) {
  destroyMap();
  if (!container) return null;
  const ok = await loadGoogleMaps();
  if (!document.body.contains(container)) return null;
  if (ok) return initGoogleMap(container, { onClick });
  return initLeafletMap(container, { onClick });
}

function initLeafletMap(container, { onClick } = {}) {
  engine = "leaflet";
  leafletMap = L.map(container, {
    zoomControl: false,
    attributionControl: true,
  });
  L.tileLayer(OSM_TILE, {
    attribution: OSM_ATTR,
    maxZoom: 19,
  }).addTo(leafletMap);
  L.control.zoom({ position: "bottomright" }).addTo(leafletMap);
  leafletMarkers = L.layerGroup().addTo(leafletMap);
  leafletRoute = L.layerGroup().addTo(leafletMap);
  leafletMap.setView([SEOUL.lat, SEOUL.lng], 12);
  leafletClick = (event) => onClick?.({ lat: event.latlng.lat, lng: event.latlng.lng });
  leafletMap.on("click", leafletClick);
  window.setTimeout(() => leafletMap.invalidateSize(), 80);
  window.setTimeout(() => leafletMap.invalidateSize(), 320);
  return leafletMap;
}

async function initGoogleMap(container, { onClick } = {}) {
  const { Map } = await google.maps.importLibrary("maps");
  await google.maps.importLibrary("marker");
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  engine = "google";
  const options = {
    center: SEOUL,
    zoom: 12,
    mapId: "DEMO_MAP_ID",
    disableDefaultUI: true,
    zoomControl: true,
    gestureHandling: "greedy",
    clickableIcons: true,
  };
  if (google.maps.ColorScheme) {
    options.colorScheme = dark ? google.maps.ColorScheme.DARK : google.maps.ColorScheme.LIGHT;
  }
  googleMap = new Map(container, options);
  googleInfo = new google.maps.InfoWindow();
  googleClick = googleMap.addListener("click", async (event) => {
    const lat = event.latLng.lat();
    const lng = event.latLng.lng();
    if (event.placeId) {
      event.stop?.();
      try {
        const resolved = await resolvePlace({ placeId: event.placeId, title: "", lat, lng });
        onClick?.(resolved);
        return;
      } catch (error) {
        console.warn("place details failed", error);
      }
    }
    const title = await reverseGeocode(lat, lng);
    onClick?.({ title, lat, lng });
  });
  window.setTimeout(() => google.maps.event.trigger(googleMap, "resize"), 80);
  window.setTimeout(() => google.maps.event.trigger(googleMap, "resize"), 320);
  return googleMap;
}

function numberedPin(n) {
  const el = document.createElement("div");
  el.className = "num-marker";
  el.innerHTML = `<span>${n}</span>`;
  return el;
}

export function flyToPlace(place) {
  if (!Number.isFinite(place.lat) || !Number.isFinite(place.lng)) return;
  if (engine === "google" && googleMap) {
    googleMap.panTo({ lat: place.lat, lng: place.lng });
    if ((googleMap.getZoom() || 12) < 15) googleMap.setZoom(16);
    const marker = googleMarkers.find((item) => {
      const pos = item.position;
      const lat = typeof pos.lat === "function" ? pos.lat() : pos.lat;
      const lng = typeof pos.lng === "function" ? pos.lng() : pos.lng;
      return Math.abs(lat - place.lat) < 1e-6 && Math.abs(lng - place.lng) < 1e-6;
    });
    if (marker && googleInfo) {
      googleInfo.setContent(`<strong>${escapeHtml(place.title || "장소")}</strong>`);
      googleInfo.open({ map: googleMap, anchor: marker });
    }
    return;
  }
  if (!leafletMap) return;
  leafletMap.flyTo([place.lat, place.lng], 16, { duration: 0.8, easeLinearity: 0.25 });
  window.setTimeout(() => {
    leafletMarkers?.eachLayer((layer) => {
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
    const placeId = url.searchParams.get("query_place_id") || url.searchParams.get("place_id");
    if (placeId) return { title: q || "", placeId, lat: null, lng: null };
  } catch {
    return null;
  }
  return looksLikeUrl ? { title: "", lat: null, lng: null, shortLink: true } : null;
}

export function googleMapsUrl(place) {
  if (place.placeId) {
    const q = encodeURIComponent(place.title || "place");
    return `https://www.google.com/maps/search/?api=1&query=${q}&query_place_id=${encodeURIComponent(place.placeId)}`;
  }
  if (Number.isFinite(place.lat) && Number.isFinite(place.lng)) {
    return `https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lng}`;
  }
  const q = encodeURIComponent(place.title || place.query || "");
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

export function drawRoute(places) {
  if (engine === "google") {
    drawGoogleRoute(places);
    return;
  }
  if (!leafletMap || !leafletMarkers || !leafletRoute) return;
  leafletMarkers.clearLayers();
  leafletRoute.clearLayers();

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
    leafletMarkers.addLayer(marker);
  });

  if (points.length >= 2) {
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#007aff";
    L.polyline(points, {
      color: accent,
      weight: 4,
      opacity: 0.9,
      lineJoin: "round",
      lineCap: "round",
    }).addTo(leafletRoute);
  }

  if (points.length === 1) {
    leafletMap.setView(points[0], 15);
  } else if (points.length > 1) {
    leafletMap.fitBounds(points, { padding: [40, 40], maxZoom: 16 });
  }
  window.setTimeout(() => leafletMap.invalidateSize(), 60);
}

async function drawGoogleRoute(places) {
  if (!googleMap) return;
  const { AdvancedMarkerElement } = await google.maps.importLibrary("marker");
  googleMarkers.forEach((marker) => {
    marker.map = null;
  });
  googleMarkers = [];
  googleLine?.setMap(null);
  googleLine = null;

  const points = places
    .filter((place) => Number.isFinite(place.lat) && Number.isFinite(place.lng))
    .map((place) => ({ lat: place.lat, lng: place.lng }));

  places.forEach((place, index) => {
    if (!Number.isFinite(place.lat) || !Number.isFinite(place.lng)) return;
    const marker = new AdvancedMarkerElement({
      map: googleMap,
      position: { lat: place.lat, lng: place.lng },
      title: place.title || "장소",
      content: numberedPin(index + 1),
      gmpClickable: true,
    });
    marker.addListener("click", () => {
      googleInfo?.setContent(`
        <strong>${escapeHtml(place.title || "장소")}</strong><br>
        ${place.time ? `${escapeHtml(place.time)} · ` : ""}${index + 1}번째
      `);
      googleInfo?.open({ map: googleMap, anchor: marker });
    });
    googleMarkers.push(marker);
  });

  if (points.length >= 2) {
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#007aff";
    googleLine = new google.maps.Polyline({
      path: points,
      geodesic: true,
      strokeColor: accent,
      strokeOpacity: 0.9,
      strokeWeight: 4,
      map: googleMap,
    });
  }

  if (points.length === 1) {
    googleMap.setCenter(points[0]);
    googleMap.setZoom(15);
  } else if (points.length > 1) {
    const bounds = new google.maps.LatLngBounds();
    points.forEach((point) => bounds.extend(point));
    googleMap.fitBounds(bounds, { top: 120, right: 40, bottom: 140, left: 40 });
  }
}

function coordsOf(location) {
  if (!location) return { lat: null, lng: null };
  if (typeof location.lat === "function") return { lat: location.lat(), lng: location.lng() };
  return { lat: Number(location.lat), lng: Number(location.lng) };
}

export async function reverseGeocode(lat, lng) {
  if (!googleReady) return "";
  try {
    const { Geocoder } = await google.maps.importLibrary("geocoding");
    const geocoder = new Geocoder();
    const { results } = await geocoder.geocode({ location: { lat, lng }, language: "ko" });
    const poi = results?.find((item) => item.types?.some((type) => ["establishment", "point_of_interest", "premise"].includes(type)));
    const best = poi || results?.[0];
    return best?.address_components?.[0]?.short_name || best?.formatted_address || "";
  } catch (error) {
    console.warn("reverse geocode failed", error);
    return "";
  }
}

export async function resolvePlace(item) {
  if (!item) return item;
  if (Number.isFinite(item.lat) && Number.isFinite(item.lng) && !item.placeId) return item;
  if (item.prediction?.toPlace) {
    const place = item.prediction.toPlace();
    await place.fetchFields({ fields: ["id", "displayName", "formattedAddress", "location"] });
    autocompleteToken = null;
    const coords = coordsOf(place.location);
    return {
      title: place.displayName || item.title,
      label: place.formattedAddress || item.label,
      placeId: place.id || item.placeId,
      lat: coords.lat,
      lng: coords.lng,
    };
  }
  if (item.placeId && googleReady) {
    const { Place } = await google.maps.importLibrary("places");
    const place = new Place({ id: item.placeId });
    await place.fetchFields({ fields: ["id", "displayName", "formattedAddress", "location"] });
    autocompleteToken = null;
    const coords = coordsOf(place.location);
    return {
      title: place.displayName || item.title,
      label: place.formattedAddress || item.label,
      placeId: place.id || item.placeId,
      lat: coords.lat ?? item.lat,
      lng: coords.lng ?? item.lng,
    };
  }
  if (item.query) return (await searchPlaces(item.query))[0] || item;
  return item;
}

async function searchGooglePlaces(query) {
  const { AutocompleteSuggestion, AutocompleteSessionToken } = await google.maps.importLibrary("places");
  if (!autocompleteToken) autocompleteToken = new AutocompleteSessionToken();
  const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
    input: query,
    language: "ko",
    region: "kr",
    sessionToken: autocompleteToken,
  });
  return (suggestions || []).slice(0, 6).map((suggestion) => {
    const prediction = suggestion.placePrediction;
    const main = prediction?.mainText?.toString?.() || prediction?.text?.toString?.() || "";
    const secondary = prediction?.secondaryText?.toString?.() || "";
    return {
      title: main,
      label: secondary || main,
      placeId: prediction?.placeId,
      prediction,
    };
  });
}

async function searchNominatim(query) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("q", query);
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
    if (fromGoogle.placeId) {
      try {
        await loadGoogleMaps();
        const resolved = await resolvePlace(fromGoogle);
        if (resolved) return [resolved];
      } catch {
        /* fall through */
      }
    }
    if (fromGoogle.shortLink) {
      throw new Error("짧은 링크는 좌표를 못 읽습니다. 구글 지도에서 공유 → 링크 복사를 전체 주소로 해 주세요.");
    }
    if (fromGoogle.query) return searchPlaces(fromGoogle.query);
  }
  const q = query.trim();
  if (q.length < 2) return [];
  if (await loadGoogleMaps()) {
    try {
      const results = await searchGooglePlaces(q);
      if (results.length) return results;
    } catch (error) {
      console.warn("Google place search failed", error);
    }
  }
  return searchNominatim(q);
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
