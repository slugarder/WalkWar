# WalkWar 통합 데모 빠른 시작

## 온라인 서버 우선

온라인 게임 서버는 `https://walkwar-production.up.railway.app`으로 고정됩니다. 온라인 APK에서는 서버 주소를 입력하지 않고 GPS 또는 가상 모드만 선택합니다. 기존 저장 서버 주소, legacy/local 설정과 빌드 환경변수는 사용하지 않고 자동으로 무시합니다. 서버가 응답하지 않으면 먼저 온라인 주소와 `/health` 상태를 확인하세요. 로컬 서버 절차는 백엔드 개발 또는 기존 로컬 APK가 필요할 때만 선택적으로 사용합니다.

온라인 설치 파일은 `artifacts/WalkWar-online.apk`입니다.

## 1. 로컬 개발용 서버 시작 (온라인 APK는 건너뜀)

온라인 APK 사용자는 이 절을 건너뛰고 Android 연결 절로 이동합니다. 이 절은 백엔드 개발 또는 기존 로컬 APK 점검용이며, 현재 온라인 APK의 연결 주소를 바꾸지 않습니다. 로컬 서버를 사용할 때만 PowerShell에서 통합 루트로 이동한 뒤 실행합니다.

```powershell
.\scripts\Start-Game.ps1
```

또는 명령 프롬프트에서 다음을 실행합니다.

```cmd
scripts\Start-Game.cmd
```

스크립트는 먼저 `http://127.0.0.1:3040/health`를 확인합니다. 서버가 없으면 설치된 Node 24(`C:\Program Files\nodejs\node.exe`)를 사용해 `server/node_modules`가 없을 때만 `npm ci`를 실행하고, `server/dist`가 없을 때만 빌드한 다음 서버를 숨은 창으로 실행합니다. 로그는 `logs/`에 저장되고 PID는 `logs/walkwar-server.pid`에 기록됩니다. 앱에 입력하는 서버 URL은 반드시 전체 URL인 `http://127.0.0.1:3040` 형식이어야 합니다. 서버가 다른 앱에 선점되지 않았는지 `/health` 응답의 WalkWar `dataInfo`와 포트 3040을 확인합니다.

## 2. Android 연결

USB 디버깅이 켜진 Android 기기 하나를 연결하고 다음을 실행합니다.

```powershell
.\scripts\Connect-Android.ps1
```

여러 기기가 연결된 경우에는 임의로 고르지 않으므로 serial을 지정합니다.

```powershell
.\scripts\Connect-Android.ps1 -Serial <device-id>
```

스크립트는 `artifacts/WalkWar-online.apk`를 설치하고 `com.walkwar.integrated/.MainActivity`를 실행합니다. applicationId는 `com.walkwar.integrated`입니다. 기존 로컬 APK를 점검할 때만 design APK를 별도로 준비합니다. `adb.exe`는 `LOCALAPPDATA\Android\Sdk\platform-tools`에서 찾습니다. 명령 프롬프트에서는 `scripts\Connect-Android.cmd`를 사용할 수 있습니다.

로컬 서버를 사용할 때만 다음처럼 `-LocalServer`를 지정하면 `adb reverse tcp:3040 tcp:3040`을 설정합니다. 온라인 모드에서는 reverse를 설정하지 않습니다.

```powershell
.\scripts\Connect-Android.ps1 -Serial <device-id> -LocalServer
```

로컬 서버를 연결할 때 에뮬레이터는 `http://10.0.2.2:3040`, USB 실기기는 `http://127.0.0.1:3040`을 사용합니다. 온라인 APK는 Railway HTTPS 주소를 사용하므로 로컬 reverse가 필요하지 않습니다. 에뮬레이터의 가짜 GPS 걷기를 실제 검증 결과처럼 간주하지 않습니다. 물리 기기에서 걷는 GPS는 아직 테스트하지 않았으므로 빌드 성공만으로 실물 GPS를 주장하지 않습니다.

## 3. 게임 흐름

GPS 모드에서는 지도 왼쪽 아래 **내 위치에서 공략**을 누르면 현재 좌표에 속한 시·도 / 시·군·구 / 읍·면·동을 자동으로 찾습니다. 목록에서 지역을 고르고 설명을 확인한 뒤 **공략 시작**을 누릅니다. 시작 시 위치를 다시 측정하므로 오래된 지도 표시만으로 공략을 시작하지 않습니다. 아래 국기 선택 방법도 계속 사용할 수 있습니다.

1. 먼저 GPS 모드 또는 가상 모드를 선택하고 해당 모드로 시작합니다. GPS 모드에서는 위치 권한과 `TYPE_STEP_COUNTER`를 확인합니다.
2. 핀치 제스처로 지도를 확대합니다. 처음에는 대한민국 전체가 보이고 시·도 국기가 개별로 표시됩니다. 확대하면 시·군·구, 다시 확대하면 읍·면·동의 국기와 경계가 순서대로 나타납니다. 화면을 너무 멀리 축소하면 행정 국기·라벨·경계가 모두 숨겨집니다. 행정구역을 묶어 표시하거나 군집 선택 화면을 제공하지 않습니다.
3. 지도에서 원하는 국기(FLAG)를 탭합니다. 선택한 실제 행정구역의 경계와 설명이 표시되며, 확인 후 `공략 시작`을 눌러야 시작됩니다.
4. 지역 설명과 최신 포획 기록을 확인하고 `공략 시작`을 누릅니다.
5. 점령 이력이 없으면 흰색 국기를 표시합니다. 흰색 국기는 포획되지 않습니다. 마지막으로 완료된 점령의 1위 팀 국기가 표시되며 동률이면 여러 팀 국기를 함께 표시합니다. 완료 기록이 없는 동안의 실시간 순위 변화는 이 국기를 바꾸지 않으며, 최신 완료 기록의 1위가 바뀌면 표시도 갱신됩니다.
6. GPS 모드에서는 확인된 위치가 선택 지역 안에 있을 때만 공격합니다. GPS가 자동으로 다른 지역을 공격하지 않습니다. 가상 모드에서는 선택한 지역에만 가상 이동을 적용합니다.

앱의 행정구역 자료 기준일은 **2026-07-01**이며 최신 실시간 자료가 아닙니다. 이 스냅샷에는 경계가 없는 철원군 근동면·원동면·원남면·임남면과 고성군 수동면 5곳이 목록에는 남아 있지만 임의 경계를 갖지 않습니다.

네트워크가 끊기거나 서버가 응답하지 않으면 화면의 오프라인 오류를 확인하고 서버 상태와 전체 URL 주소를 점검합니다. 가상 모드와 GPS 모드는 진행도, 지갑, 구매 내역, 인벤토리, 칭호, 장비, 레이드, 랭킹을 각각 분리해 저장합니다.

게임 데이터는 `server/data/walkwar.sqlite`에 저장됩니다. 현재 데이터 스냅샷은 7월 1일 기준이며 최신 자료가 아니고, 위의 경계 누락 5곳을 포함합니다. 지도 밖 또는 경계에 없는 위치는 임의 지역으로 보정하지 않습니다.

GPS 모드와 NPC 전투에서는 지역별 NPC가 표시됩니다. NPC와 그 순위에는 `시뮬레이션`이라고 표시됩니다. 현재 사람 팀 표시는 `KR`입니다.

## 4. 0.3.4 GPS·랭킹 동작

GPS 위치가 자주 갱신될 때 `TYPE_STEP_COUNTER`가 늦게 묶어 보낸 걸음을 짧은 요청 간격만으로 과도한 증가로 판정하던 문제를 수정했습니다. 유효한 지역 내 측정이 이어지면 초당 4걸음의 반영 허용량을 쌓고 최대 120걸음으로 제한합니다. 실제 센서 증가분이 있을 때만 반영하며, 위치 불확실·지역 이탈·센서 재시작·30초 초과 공백·일시정지에는 기준을 갱신합니다. 첫 센서값은 기준만 만들고 기여를 자동 부여하지 않습니다.

내 기록은 순위권이 아니거나 지역 밖이어도 항상 표시하며 기여 0도 남깁니다. 랭킹 상세의 GPS `걸음 확인`에서는 현재 추적 중 감지한 걸음과 실제 공략 기여를 따로 봅니다. 추적 걸음 기준은 공략 지역을 선택하거나 앱에 복귀할 때 초기화됩니다. GPS와 가상 모드의 진행도·칭호·구매·랭킹은 계속 분리됩니다.

## 5. 디자인·데이터 경계

통합 앱은 원본 WalkWar의 UI 컴포넌트와 상호작용을 재사용하고, 실제 게임 연결은 통합 서버의 API를 통해 수행합니다. 기존 기록은 최초 이전 범위만 유지하며, 지역명이 불명확한 기록은 임의로 새 행정동에 매핑하지 않습니다. iOS의 지원 런타임에서만 Glass 효과를 사용하고 Android에서는 별도 투명·블러 fallback을 사용합니다.

## 6. 패키지 구성

`artifacts/WalkWar-online.apk`는 고정 Railway 서버에 연결하는 설치용 APK입니다. applicationId는 `com.walkwar.integrated`이며 기본 Activity는 `com.walkwar.integrated/.MainActivity`입니다. 로컬 design APK와 서버 실행 절차는 기존 로컬 개발 호환을 위해 남겨 둡니다. 원본 프로젝트와 원본 데이터베이스는 수정하지 않습니다.

## 7. 앱 다시 빌드하기

`mobile`에서 `npm ci` 후 `mobile/android`에서 아래 명령을 실행합니다. JDK 21과 Android SDK가 필요합니다. 저장된 native Android 소스를 사용하세요. `expo prebuild --clean`은 기존 Kotlin 앱의 닉네임·클라이언트 ID를 이전하는 `WalkWarLegacyPackage` 등록을 지울 수 있습니다.

```powershell
.\gradlew.bat :app:assembleRelease '-PreactNativeArchitectures=arm64-v8a,x86_64'
```

결과는 `mobile/android/app/build/outputs/apk/release/app-release.apk`입니다. 서명 키는 배포 ZIP에 포함하지 않으며 Android의 로컬 기본 디버그 키를 사용합니다. 다른 컴퓨터에서 새 키로 빌드하면 기존 설치본 위에 업데이트할 수 없으므로 기존 기기의 앱을 지우기 전에 데이터를 확인하세요.
