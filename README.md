# 여행 계획표

아이폰 중심으로 쓰는 가벼운 여행 계획 웹앱입니다. 서버나 DB 없이 JSON과 브라우저 저장만 사용하고, GitHub Pages로 배포합니다.

주소 예: `https://ddanggoos.github.io/tripPlanner/`

## 할 수 있는 일

- 여행 프로젝트 만들기
- 날짜 저장
- 항공권 / 호텔 저장
- 일자별 장소 추가, 순서 변경
- 날짜를 고르면 지도에 번호 마커와 루트가 이어짐
- 먹거리 빙고 5x5

## 데이터

- 기본값: [`data/trips.json`](data/trips.json)
- 화면에서 고친 내용은 이 브라우저의 localStorage에 저장됩니다.
- 다른 기기와 맞추려면 화면의 **내보내기**로 `trips.json`을 받은 뒤 `data/trips.json`에 넣고 커밋하거나, **가져오기**로 다시 읽으면 됩니다.

## 로컬에서 보기

모듈 스크립트라 파일을 더블클릭하면 막힐 수 있습니다. 저장소 폴더에서:

```bash
python3 -m http.server 4173
```

그다음 휴대폰과 같은 네트워크면 `http://<컴퓨터IP>:4173` 으로 아이폰 사파리에서 확인하면 됩니다.

## GitHub Pages

배포 주소: https://ddanggoos.github.io/tripPlanner/

`main`에 푸시되면 [Deploy GitHub Pages](.github/workflows/pages.yml)가 자동으로 올립니다.
저장소 **Settings → Pages → Source: GitHub Actions** 가 켜져 있어야 합니다.

아이폰 사파리에서 공유 → 홈 화면에 추가 하면 앱처럼 열립니다.
