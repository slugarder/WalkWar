# WalkWar Railway 배포 기록

현재 통합 게임 서버는 다음 Railway 서비스에 배포되어 있습니다.

- HTTPS 주소: `https://walkwar-production.up.railway.app`
- Project: `f4f93309-04e6-4473-a374-de8fcca3d066`
- Environment: `7656d5b9-7147-413f-b07e-516c69e8bd92`
- Service: `5a42a44e-3efc-4ff3-89fd-f13c5fcd6cb5`
- Volume: `da719e0a-778a-4de7-9bd1-74217c2ea6a0`, mount `/data`, 5GB, Ready
- Deployment: `8857ace8-f0cd-4c6f-acdc-93cdb69361f9` — SUCCESS

## 0.3.6 인구·행정 체급별 체력 배포

2026-09-20, 같은 Project·Environment·Service와 `/data` 볼륨에 배포했습니다. 위 배포 ID의 SUCCESS 및 `/health`의 `population-202608-tier10-v1`을 확인했습니다. 광역 16곳의 체력이 승인된 계산표와 모두 일치합니다. 자세한 산식은 [인구 체력 적용 안내](POPULATION-HP.ko.md)에 있습니다.

기존 720 HP 공략은 절대 피해량과 기여·점령·보상 기록을 보존해 새 체력으로 전환합니다. 전환 전 상태는 SQLite `migration_backup`의 `population-hp-v1`에 한 번 보관합니다. 기존 테스트 계정의 걸음 20, 기여 20, 포인트 0, 이전 점령 기록 및 피해 51이 보존됐고, 해당 지역은 31,725 / 31,776 HP로 전환됐습니다. 배포 전후 사이 다른 사용자가 완료한 새 점령 기록도 유지됐습니다.

서버 38개·모바일 47개 테스트, 타입 검사·빌드, 실제 전국 경계의 GPS 지역 선택 통합 검증을 통과했습니다. 일반 APK 0.3.6을 에뮬레이터에 업데이트 설치하고 Railway의 세종 최대 체력 181,987,224 표시를 확인했습니다.

## 0.3.4 걸음 반영 수정 배포

2026-09-20, 기존 Project·Environment·Service에 서버를 재배포했습니다. 배포 ID `9c393f59-d077-4a33-927e-64e4c734d74b`의 SUCCESS와 `/health` 정상 응답을 확인했습니다. 기존 `/data` 볼륨과 게임 기록을 유지하며 DB 교체나 마이그레이션은 없습니다. 재배포 후 기존 테스트 플레이어 `player-47725f66-a9fd-4da3-92c4-0f219594d667`의 `totalSteps=20`, `selfContribution=20`, `regionId=mois:1111051500`, `points=0`을 읽기 전용으로 확인했습니다.

GPS가 빈번하게 갱신되는 동안 Android 걸음 센서가 여러 걸음을 묶어 보내면, 직전 GPS 요청과의 짧은 간격만으로 걸음 수를 판정해 버리던 문제를 수정했습니다. 유효한 지역 내 측정이 이어지는 시간 동안 초당 4걸음까지 허용량을 쌓고 최대 120걸음으로 제한합니다. 실제 센서 증가분이 있을 때만 사용하며, 위치 불확실·지역 이탈·센서 재시작·30초 초과 공백 등에서는 기준을 갱신합니다.

서버 테스트 30개와 실제 전국 경계 데이터를 사용하는 GPS 지역 선택 통합 테스트가 통과했습니다. 이 결과는 실제 휴대폰의 걸음 센서 동작을 검증한 결과는 아닙니다.

## 런타임 설정

서비스 변수는 다음과 같습니다.

```text
HOST=0.0.0.0
PORT=3040
RAID_DB_PATH=/data/walkwar.sqlite
REGION_DATA_DIR=/app/server/data
```

Docker 이미지에 포함된 정적 행정구역 데이터는 `/app/server/data`에 있고, 게임 기록 SQLite는 Railway volume의 `/data/walkwar.sqlite`에 있습니다. 같은 서버가 정적 데이터를 읽고 볼륨 DB에 기록하지만, 정적 데이터와 영속 기록은 서로 다른 경로로 분리됩니다. Cloud 게임 기록은 로컬 `server/data/walkwar.sqlite`와 독립적으로 시작하며 로컬 DB는 보존합니다.

0.3.1/code 4 클라이언트는 `https://walkwar-production.up.railway.app`만 사용하며 서버 주소 입력, 기존 저장 주소, legacy/local 설정과 `EXPO_PUBLIC_GAME_SERVER_URL`을 사용하지 않습니다. 클라이언트 테스트 5개와 전체 타입 검사, release APK 빌드가 통과했습니다. 에뮬레이터에서 기존 앱 위에 업데이트한 뒤 이름이 유지되고 서버 설정 없이 가상 모드로 접속되는 것을 확인했습니다. Railway HTTP 로그에서도 기존 player-88346840-5742-4853-9a49-d085901c55f8의 state/input 요청에 200 응답이 확인되었습니다.

## 재시작 persistence 확인

Deployment `60b04230-9098-46c7-99e4-d40a5271dac3` 재시작 후 `player-47725f66-a9fd-4da3-92c4-0f219594d667`의 `steps=20`, `region=mois:1111051500`, `wallet=0`이 보존되는 것을 확인했습니다. 이는 `/data` volume에 둔 Cloud SQLite 기록이 재시작 뒤 유지된 결과입니다.

## 재배포 준비와 주의

새 staging은 다음 스크립트로 준비합니다.

```powershell
.\scripts\Prepare-Railway.ps1
```

스크립트는 기본적으로 `.deployment\railway-<timestamp>` 아래에 새 디렉터리를 만들고, 이미 존재하는 대상은 덮어쓰지 않습니다. 재배포 CLI를 사용할 때는 새 프로젝트를 만들지 말고 위의 Project, Environment, Service ID를 명시해 기존 서비스에 지정합니다. `/data` volume 연결을 유지해야 게임 기록이 유지됩니다.

온라인 release APK 번들에 Railway HTTPS URL이 포함된 것을 확인했고, 에뮬레이터에 설치한 뒤 저장 서버 주소를 `https://walkwar-production.up.railway.app`으로 변경해 전국 지도 접속을 확인했습니다. 서버 재시작 persistence와 APK 연결 확인은 위 기록의 범위입니다.

Railway HTTP 로그에서도 에뮬레이터 player `player-88346840-5742-4853-9a49-d085901c55f8`의 state/input 요청이 200으로 응답하는 것을 확인했습니다. `Prepare-Railway.ps1`은 새 staging을 16개 파일로 준비하는 데 성공했습니다.
