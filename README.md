# 여행 계획표

아이폰 중심으로 쓰는 가벼운 여행 계획 웹앱입니다. 서버나 DB 없이 JSON과 브라우저 저장만 사용하고, GitHub Pages로 배포합니다.

주소 예: `https://ddanggoos.github.io/tripPlanner/`

## 할 수 있는 일

- 여행 프로젝트 만들기
- 날짜 저장
- 항공권 / 호텔 저장
- 일자별 장소 추가, 순서 변경
- 날짜를 고르면 지도에 번호 마커와 루트가 이어짐
- 구글 지도에서 장소 검색·지도 탭에서 핀 찍기 (API 연결 시)
- 먹거리 빙고 5x5

## 데이터

- 기본값: [`data/trips.json`](data/trips.json)
- 화면에서 고친 내용은 이 브라우저의 localStorage에 저장됩니다.
- 다른 기기와 맞추려면 화면의 **내보내기**로 `trips.json`을 받은 뒤 `data/trips.json`에 넣고 커밋하거나, **가져오기**로 다시 읽으면 됩니다.

## 여자친구와 실시간 공유

둘 다 같은 링크를 열면 일정·빙고가 바로 맞춰집니다. Firebase Realtime Database(무료 스파크 플랜)를 씁니다.

1. [Firebase 콘솔](https://console.firebase.google.com)에서 프로젝트 만들기
2. **Build → Realtime Database** 만들기. 지역은 `asia-northeast3`(서울) 권장
3. 규칙에 [`database.rules.json`](database.rules.json) 내용을 붙여 넣기
4. 프로젝트 설정 → 웹 앱 추가 후 나온 `apiKey`, `databaseURL` 등을 [`js/firebase-config.js`](js/firebase-config.js)에 넣기
5. Authentication → Settings → Authorized domains에 `ddanggoos.github.io` 추가
6. 커밋하면 Pages에 배포됨
7. 여행 상세에서 **링크 보내기** → 아이폰 공유 시트로 카톡/메시지 전송

링크를 아는 사람은 그 여행을 읽고 고칠 수 있으니, 공개 게시하지 마세요.

## 구글 지도로 장소 찾기

Maps API 키는 **깃허브에 넣지 않습니다.** Firebase Realtime Database의 `appConfig/googleMapsApiKey`에서만 읽습니다.

브라우저에서 지도를 그리는 키는 네트워크 탭에 보일 수 있습니다. 그래서 탈취돼도 우리 사이트에서만 쓰이게 구글 콘솔에서 잠급니다.

1. [Google Cloud 사용자 인증 정보](https://console.cloud.google.com/apis/credentials)에서 **Maps 전용 키를 새로 만들기** (저장소에 있는 Firebase 웹 키와 분리)
2. 이 키에만 **Maps JavaScript API**, **Places API**, **Geocoding API**, **Directions API** 허용. Firebase 웹 키에서는 Maps를 끄기
3. 애플리케이션 제한: HTTP 리퍼러
   - `https://ddanggoos.github.io/*`
   - `http://localhost:*`
   - `http://127.0.0.1:*`
4. [할당량·예산 알림](https://console.cloud.google.com/billing)을 걸어 이상 청구를 막기
5. Realtime Database 규칙을 저장소의 [`database.rules.json`](database.rules.json)으로 다시 붙여 넣기 (`appConfig`는 읽기만, 쓰기는 콘솔만)
6. Realtime Database → Data에서 `appConfig` 추가 후 `googleMapsApiKey`에 Maps 전용 키 붙여 넣기

키가 없거나 막혀 있으면 예전처럼 OpenStreetMap으로 검색·지도가 동작합니다.

## 로컬에서 보기

모듈 스크립트라 파일을 더블클릭하면 막힐 수 있습니다. 저장소 폴더에서:

```bash
python3 -m http.server 4173
```

그다음 휴대폰과 같은 네트워크면 `http://<컴퓨터IP>:4173` 으로 아이폰 사파리에서 확인하면 됩니다.

## 앱 버전

화면에 보이는 버전과 Pages 배포 시 CSS/JS 캐시 쿼리(`?v=`)는 [`js/version.js`](js/version.js)의 `APP_VERSION` 하나입니다.
브라우저의 `import "./map.js"`는 함수로 주소를 만들 수 없어서, `main` 배포 워크플로가 그 값을 파일에 붙여 줍니다.
버전을 올릴 때는 **이 파일만** 고치면 됩니다. 로컬 `python3 -m http.server`에서는 쿼리 없이 그대로 동작합니다.

런타임으로 불러오는 주소(시드 JSON 등)는 `withVersion()`을 쓰면 같은 버전이 붙습니다.

## GitHub Pages

배포 주소: https://ddanggoos.github.io/tripPlanner/

`main`에 푸시되면 [Deploy GitHub Pages](.github/workflows/pages.yml)가 자동으로 올립니다.
저장소 **Settings → Pages → Source: GitHub Actions** 가 켜져 있어야 합니다.

아이폰 사파리에서 공유 → 홈 화면에 추가 하면 앱처럼 열립니다.
