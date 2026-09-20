# WalkWar 행정구역 데이터

## 기준일과 범위

**행정기관 코드와 행정동 경계 기준일: 2026-07-01.** 수집·확인일: 2026-09-20.
실시간 최신 데이터가 아니며 게임 화면에 이 기준일을 표시해야 합니다.

이 날짜의 행정안전부 공식 자료는 **16개 시도**입니다. 2026-07-01 전라남도와
광주광역시가 **전남광주통합특별시(시도코드 12)**로 통합되었기 때문입니다.
세종특별자치시도 포함되어 있습니다. 17개라는 과거 개수에 맞추려고 지역을 추가하지 않습니다.

| 항목 | 목록 | 경계 도형 | 기본 지도에서 표시 |
| --- | ---: | ---: | ---: |
| 시도 | 16 | 16 | 16 |
| 시군구 | 269 | 269 | 256 |
| 행정 읍면동 | 3,563 | 3,558 | 3,558 |
| 합계 | 3,848 | 3,843 | 3,830 |

공식 활성 코드 3,923행에서 읍면동 출장소 64개와 그 밖의 출장소 11개를 제외했습니다.
독립된 시도·시군구·읍면동이 아닌 출장소를 별도 게임 영토로 만들지 않습니다.
제외 코드와 이름은 region-sources.json에 모두 기록했습니다.

경계가 없는 공식 읍면동 다섯 곳은 목록에 남겨 두며 center:null, bbox:null,
boundaryAvailable:false로 표시합니다. 철원군 근동면·원동면·원남면·임남면과
고성군 수동면입니다. 이들 위치를 임의 좌표나 사각형으로 대체하지 않았습니다.

**확인된 후속 변경:** MOIS 2026-07-20 공지는 세종특별자치시 집현동 신설을 포함합니다.
선택한 2026-07-01 경계와 일관성을 유지하기 위해 이번 스냅샷에는 반영하지 않았습니다.
집현동을 지원하려면 대응하는 실제 경계와 반곡동 변경 경계를 함께 갱신해야 합니다.

## 실제 사용한 출처

- [행정안전부 2026-07-01 행정기관 변경내역](https://www.mois.go.kr/frt/bbs/type001/commonSelectBoardArticle.do?bbsId=BBSMSTR_000000000052&nttId=127039)의 jscode20260701.zip → KIKcd_H.20260701.
  명칭과 10자리 코드의 기준입니다. CP949 고정 바이트 폭 자료를 해석했으며 법정동 자료와 혼용하지 않았습니다.
- [vuski/admdongkor](https://github.com/vuski/admdongkor)의 ver20260701/HangJeongDong_ver20260701.geojson.
  통계청 SGIS 행정동 경계를 토대로 변경 이력과 경계 위치를 보정한 공개 가공물입니다.
  다운로드를 커밋 7360288277dfd12d74e54b959c59bdd66f852e3a로 고정했습니다.
  경계 3,558개 전부의 adm_cd2를 MOIS 활성 코드와 정확히 일치시켰습니다.
- [MOIS 2026-07-20 후속 공지](https://www.mois.go.kr/frt/bbs/type001/commonSelectBoardArticle.do?bbsId=BBSMSTR_000000000052&nttId=127979)는 최신 여부의 제한사항을 확인하는 데 사용했습니다.

원본 다운로드 주소, SHA-256, 자료 인코딩, 제외 코드, 별도 시 목록,
원자료와 가공자의 출처는 server/data/region-sources.json에 있습니다.
경계는 공식 기관이 직접 발행한 최신 지적도라고 표현하면 안 됩니다.

## 파일과 인터페이스

- server/data/regions.json: {metadata,regions}. metadata.date 및 boundaryDate는
  "2026-07-01", source는 사람이 읽을 수 있는 출처 문자열입니다.
  counts, boundaryCounts, baseMapCounts, knownLimitations, administrativeChanges,
  attribution도 제공합니다.
- server/data/boundaries.geojson: 세 단계가 함께 있는 FeatureCollection.
  properties.regionId, properties.id 및 Feature.id는 regions.json의 id와 같습니다.
  properties에 code, level, name, fullName, parentId, center, mapSelectable,
  isAggregateCity가 들어 있습니다.
- scripts/import-regions.py: 공개 원본 다운로드, 체크섬 확인, 생성 및 핵심 검증.
- 모든 좌표는 EPSG:4326 WGS84입니다. GeoJSON 좌표는 [경도,위도],
  bbox는 [서쪽경도,남쪽위도,동쪽경도,북쪽위도], center는 {lat,lon}입니다.
- code는 앞자리와 자릿수를 보존하는 10자리 문자열, codeSystem은 MOIS_ADM_10,
  id는 mois:<10자리코드>입니다. 원본 통계청 8자리 코드는 statisticsCode에 별도로 보존합니다.
- fullName/name은 MOIS 공식 표기를 사용합니다. 경계 원본의 공백·제1동/1동 등
  다른 표기는 aliases에 보존하여 검색에 활용할 수 있습니다.
- center는 폴리곤 안에 있는 대표 지점입니다. 청사 위치나 이용자의 GPS가 아닙니다.
  바다에 떨어질 수 있는 전체 바운딩 박스 중심을 사용하지 않았습니다.

## 계층과 지도 선택

보통 읍면동 → 시군구 → 시도입니다. 일반구가 있는 도시는
읍면동 → 일반구 → 시 → 시도의 네 노드가 됩니다.
시와 일반구의 level은 모두 sigungu이므로 상위 탐색을 세 번으로 고정하지 마세요.

예: 인계동 mois:4111573000 → 수원시 팔달구 mois:4111500000
→ 수원시 mois:4111000000 → 경기도 mois:4100000000.

수원·성남·안양·부천·안산·고양·용인·화성·청주·천안·포항·창원·전주,
이 13개 상위 시의 실제 병합 경계도 포함되어 있습니다.
isAggregateCity:true, mapSelectable:false는 **선택 금지**가 아니라
기본 시군구 지도에 자식 구와 겹쳐 그리지 않는다는 뜻입니다.
검색 결과나 상위 지역 선택으로 시 전체를 선택하고 해당 시 경계를 강조할 수 있습니다.

기본 지도는 level과 mapSelectable!==false를 함께 필터링합니다.
읍면동까지의 GPS 판정은 원본 읍면동 도형에 point-in-polygon을 적용한 뒤
parentId를 끝까지 따라가면 됩니다. 시군구의 기본 탭 대상은 가장 가까운 일반구,
검색으로 선택한 상위 시의 포함 여부는 그 시가 조상인지로 판정합니다.

세종은 공식 코드 3600000000(시도)와 3611000000(하위 코드 분류)을 함께 유지합니다.
3611000000은 별도의 자치시를 뜻하지 않습니다. 두 단계의 이름을 세종특별자치시로
표시하므로 지도 확대 단계마다 선택할 수 있고 주소에 세종을 중복 표기하지 않습니다.

읍면동 좌표는 추가 단순화 없이 보존했습니다. 시도·시군구는 읍면동의 실제 합집합을
Shapely unary_union으로 만들고 topology 보존 단순화를 적용했습니다
(시도 0.0002도, 시군구 0.00005도). 섬, MultiPolygon, 내부 구멍을 유지합니다.
상위 도형은 지도 표시용이며 미세한 경계 차이를 피하려면 GPS 판정에는
읍면동 판정 결과의 parentId 계층을 사용하세요.
상위 도형은 수록된 읍면동의 합집합이므로 경계 없는 다섯 면을 보충하지 않습니다.

## 재생성과 검증

Python 3.10 이상과 Shapely 2.x가 필요합니다. 앱 실행에는 Python이나 다운로드가 필요 없습니다.
원본 캐시는 기본적으로 OS 임시 폴더의 walkwar-regions에 저장합니다.

~~~powershell
python scripts/import-regions.py
python scripts/import-regions.py --validate-only
~~~

다른 캐시를 쓰려면 --cache-dir PATH를 지정합니다.
캐시에 source.geojson와 jscode20260701.zip이 있으면 인터넷 없이 재생성합니다.
체크섬이 다른 원본은 자동 반영하지 않고 종료합니다.

실제 통과한 검증: 3,848개 고유 코드, 모든 부모 참조와 비순환 계층,
3,843개 유효한 폴리곤과 내부 대표점, 다섯 개의 명시된 경계 누락,
서울·부산·서면·대전·대구·수원·제주·광주·울릉의 9개 좌표 판정.
수원 표본은 읍면동 → 구 → 시 → 도 경로를 포함합니다.
경계에 정확히 놓인 점이나 도형 밖 좌표의 런타임 처리는 서버 정책에서 정해야 합니다.

## 출처 표시

경계 가공물은 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/),
SGIS 원자료는 가공자 설명에 따른 공공누리 제1유형 출처표시 조건입니다.
[원본 데이터 이용조건](https://github.com/vuski/admdongkor/blob/master/LICENSE-DATA)에
기재된 가공자와 SGIS 출처를 함께 보존합니다. 앱 데이터 정보 및 재배포 파일에도
metadata.attribution을 표시하세요.

> 본 데이터는 통계청 통계지리정보서비스(SGIS, https://sgis.kostat.go.kr)에서
> 공공누리 제1유형으로 개방한 행정동 경계를 가공한 것이며
> (가공: vuski/admdongkor, https://github.com/vuski/admdongkor),
> CC BY 4.0으로 배포됩니다.
> WalkWar는 MOIS 코드와 결합하고 상위 경계를 병합·단순화했습니다.

코드·명칭 출처: 행정안전부, 2026-07-01 행정기관(행정동) 및 관할구역(법정동) 자료.

