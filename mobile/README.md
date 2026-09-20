# WalkWar 앱 — UI 기반

iOS와 Android를 함께 지원하는 React Native / Expo SDK 57 프로젝트입니다.
기존 `walkwar-mobile` 웹 목업과 별도의 프로젝트입니다.

## 이번 구현 범위

- 지도를 중심에 두고 상단 정보와 하단 메뉴를 작게 띄우는 화면
- 지원되는 iOS의 네이티브 Liquid Glass와 Android / 이전 iOS의 블러·반투명 대체 표현
- 컴팩트 / 기본 / 크게 세 가지 UI 크기 및 로컬 저장
- 글자·아이콘·패널 여백을 함께 조정하며, 큰 글씨에서는 랭킹을 버튼으로 축약
- OS 글자 배율 유지, 48 이상 터치 영역, iOS 투명도 줄이기 반영
- 배경 대비 높이기 옵션과 접근성 레이블·라디오 선택 상태
- 웹에서 WASD·방향키 이동(화면에는 조작 안내를 표시하지 않음), 레이드·보상·수집·가상 구매

지도는 OpenFreeMap/OpenStreetMap의 부산 실제 데이터입니다. 통합 앱은 전국 지도와 Railway 게임 서버, 전경 GPS·기기 걸음 센서를 연결합니다. 실물 기기 보행 GPS와 걸음 센서는 아직 검증하지 않았습니다.
통합 앱의 서버 주소는 Railway로 고정되며 서버 주소 입력, legacy/local 설정과 기존 저장 주소는 사용하지 않습니다. 이 디렉터리의 웹 UI 목업 실행은 별도 로컬 개발 흐름입니다.

## 실행

Node.js 22.13 이상(권장 24 LTS)과 npm이 필요합니다.

```sh
npm ci
npm start
```

휴대폰에서 검증하려면 같은 네트워크에서 Expo가 안내하는 QR과 호환되는 Expo Go 또는 개발 빌드를 사용합니다.
기기와 앱의 빌드 환경이 Liquid Glass를 지원하지 않으면 대체 패널이 표시됩니다.
iOS 네이티브 빌드는 macOS/Xcode 또는 EAS의 iOS 빌드 환경이 필요합니다.
개발자 계정 연결, 서명, 스토어 배포는 아직 수행하지 않았습니다.

PC에서 UI 동작 확인:

```sh
npm run web -- --localhost --port 5195
```

## 검사

```sh
npm run typecheck
npm test
npm run export:native
```

`export:native`는 iOS / Android JavaScript·Hermes 번들과 리소스를 검사합니다.
설치 가능한 IPA / APK를 만들거나 실제 네이티브 화면을 검증하는 명령은 아닙니다.

## 디자인 원칙

자세한 기준은 `DESIGN.md`에 기록했습니다. 미래 변경에서도 기준을 유지하기 위해 `AGENTS.md`에도 반영했습니다.
앱 화면은 `App.tsx`, 크기 값은 `src/theme.ts`, 글라스 처리는 `src/components/GlassPanel.tsx`, 설정 저장은 `src/state/preferences.tsx`에서 관리합니다.

## 부산 전체 지도와 유리 표현

- 부산 전체 보기와 16개 구·군 선택, 드래그·핀치·휠 확대/축소, 현재 가상 위치로 복귀를 제공합니다. 지도를 둘러봐도 캐릭터 위치나 레이드 기여는 바뀌지 않습니다.
- MapLibre GL JS 5.24.0과 OpenFreeMap을 사용합니다. 웹은 iframe, iOS/Android는 WebView에 같은 지도 문서를 표시합니다. 지도 스크립트·폰트·타일은 인터넷 연결이 필요하며 실패 시 재시도 화면이 표시됩니다. 출처 표시는 지도에 유지합니다.
- 웹의 상단/하단/지도 조작 패널은 SVG 변위 필터로 가장자리 굴절을 근사하고 반사 하이라이트를 더합니다. Apple 네이티브 Liquid Glass와 동일한 렌더러는 아닙니다. SVG 배경 필터 지원은 브라우저마다 다릅니다.
- 지원되는 iOS는 네이티브 clear GlassView를 사용하고, Android/구형 iOS는 블러와 반사 테두리를 사용합니다. 대비 설정에서는 유리 효과를 끕니다.

## 검증 상태

- TypeScript 검사와 모델·지도 로직 테스트
- iOS / Android 코드·이미지 번들 생성 통과
- 브라우저에서 393 x 852, 320 x 700 및 기본 데스크톱 창 확인
- 세 가지 크기 선택, 재로딩 후 유지, 대비 전환 확인
- 실기기의 Liquid Glass, Android 블러 성능, VoiceOver/TalkBack, OS 대형 글자·투명도 줄이기는 추가 검증 필요

## 공식 참고

- https://docs.expo.dev/versions/v57.0.0/sdk/glass-effect/
- https://docs.expo.dev/versions/v57.0.0/sdk/blur-view/
- https://reactnative.dev/docs/accessibilityinfo
- https://openfreemap.org/quick_start/
- https://openfreemap.org/
- https://maplibre.org/maplibre-gl-js/docs/
