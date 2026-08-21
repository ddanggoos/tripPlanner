import { firebaseConfig } from "./firebase-config.js";

// 비워 두면 Firebase 웹 API 키를 그대로 씁니다.
// 같은 GCP 프로젝트에서 Maps JavaScript API, Places API, Geocoding API 를 켜세요.
export const GOOGLE_MAPS_API_KEY = "";

export const googleMapsApiKey = GOOGLE_MAPS_API_KEY || firebaseConfig.apiKey || "";

export function isGoogleMapsConfigured() {
  return Boolean(googleMapsApiKey);
}
