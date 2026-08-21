/** 화면 뱃지와 배포 캐시 쿼리의 단일 출처. 버전을 올릴 때는 이 값만 고치면 됩니다. */
export const APP_VERSION = "0.6.1";

export function withVersion(url) {
  const parsed = new URL(url, "https://local.invalid/");
  parsed.searchParams.set("v", APP_VERSION);
  return parsed;
}
