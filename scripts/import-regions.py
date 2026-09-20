#!/usr/bin/env python3
"""Rebuild WalkWar's dated Korean administrative map from pinned public sources.

Requires Python 3.10+ and shapely 2.x. No key/account needed.
  python scripts/import-regions.py
  python scripts/import-regions.py --validate-only
  python scripts/import-regions.py --cache-dir /path/to/download-cache
"""
from __future__ import annotations
import argparse
import hashlib
import io
import json
import tempfile
import urllib.request
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

from shapely.geometry import Point, mapping, shape
from shapely.ops import unary_union

DATE = "2026-07-01"
RETRIEVED = "2026-09-20"
BOUNDARY_COMMIT = "7360288277dfd12d74e54b959c59bdd66f852e3a"
GEO_URL = (
    "https://raw.githubusercontent.com/vuski/admdongkor/"
    + BOUNDARY_COMMIT
    + "/ver20260701/HangJeongDong_ver20260701.geojson"
)
MOIS_URL = "https://www.mois.go.kr/cmm/fms/FileDown.do?atchFileId=FILE_00146280tlU2Y2B&fileSn=0"
MOIS_NOTICE = "https://www.mois.go.kr/frt/bbs/type001/commonSelectBoardArticle.do?bbsId=BBSMSTR_000000000052&nttId=127039"
NEWER_NOTICE = "https://www.mois.go.kr/frt/bbs/type001/commonSelectBoardArticle.do?bbsId=BBSMSTR_000000000052&nttId=127979"
FILES = {
    "source.geojson": (GEO_URL, "c01ef44a0eb00978662ba7a6240ccb1da287fb52abd85104a1758969d391132f"),
    "jscode20260701.zip": (MOIS_URL, "0b9f143fb6e43657ff72c863ac1412cc4be43e79dce323aac602fb7754663898"),
}
MISSING_BOUNDARY_CODES = {"5178034000", "5178035000", "5178036000", "5178037000", "5182034000"}
SOURCE = "행정안전부 행정기관코드 2026-07-01 · SGIS/vuski(admdongkor) 경계"
ATTRIBUTION = (
    "본 데이터는 통계청 통계지리정보서비스(SGIS, https://sgis.kostat.go.kr)에서 "
    "공공누리 제1유형으로 개방한 행정동 경계를 가공한 것이며"
    "(가공: vuski/admdongkor, https://github.com/vuski/admdongkor), "
    "CC BY 4.0으로 배포됩니다. WalkWar는 MOIS 코드와 결합하고 상위 경계를 병합·단순화했습니다."
)
ADMINISTRATIVE_CHANGES = [
    "2026-07-01 전라남도와 광주광역시가 전남광주통합특별시(MOIS 시도코드 12)로 통합되어, 이 공식 스냅샷은 세종을 포함한 16개 시도입니다.",
    "세종특별자치시는 시도 3600000000 및 공식 코드 분류 3611000000으로 광역·중간 지도 단계 모두에 표시됩니다. 3611000000은 별도 자치시가 아닙니다.",
]
LIMITATIONS = [
    "행정구역·경계 기준일은 2026-07-01이며 현재 시점의 최신 행정구역이라고 주장하지 않습니다.",
    "2026-07-20 신설된 세종특별자치시 집현동은 이 스냅샷에 반영되지 않았습니다.",
    "강원특별자치도 철원군 근동면·원동면·원남면·임남면, 고성군 수동면은 공식 코드만 제공되며 경계와 중심점이 없습니다.",
    "SGIS 원자료를 민간 프로젝트가 보정한 경계입니다. 지적·법률상 경계가 아니며 실제 경계와 차이가 있을 수 있습니다.",
    "시군구 기본 지도는 수원시 장안구처럼 최하위 시군구를 표시합니다. 일반구가 있는 상위 13개 시는 검색·계층 선택용으로 포함되며 mapSelectable:false로 기본 지도에서 중복 표시하지 않습니다.",
    "시도·시군구 경계는 수록된 읍면동의 합집합으로 만든 지도 표시용 도형입니다. GPS 판정은 읍면동 경계와 parentId 계층을 사용합니다.",
]
# Approximate degrees: display-only parent geometry. Leaf geometry is not simplified.
SIMPLIFICATION = {"sido": 0.0002, "sigungu": 0.00005, "emd": 0.0}

def rid(code: str) -> str:
    return "mois:" + code

def read_source(cache: Path, name: str) -> bytes:
    url, expected = FILES[name]
    path = cache / name
    if not path.exists():
        cache.mkdir(parents=True, exist_ok=True)
        request = urllib.request.Request(url, headers={"User-Agent": "WalkWar-region-import/1.0"})
        with urllib.request.urlopen(request, timeout=120) as response:
            content = response.read()
        if hashlib.sha256(content).hexdigest() != expected:
            raise ValueError(f"Source checksum changed: {name}; review the new source before updating this importer")
        path.write_bytes(content)
    content = path.read_bytes()
    if hashlib.sha256(content).hexdigest() != expected:
        raise ValueError(f"Cached source checksum mismatch: {path}")
    return content

def official_rows(content: bytes) -> list[dict]:
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        member = next(n for n in archive.namelist() if n.endswith("KIKcd_H.20260701"))
        raw = archive.read(member)
    # MOIS is a CP949 fixed-byte-width file, not a whitespace-delimited table.
    spans = [(0, 10), (11, 41), (42, 72), (73, 103), (104, 112), (113, 121)]
    fields = ["code", "sido", "sigungu", "emd", "created", "deleted"]
    rows = []
    for line in raw.splitlines()[1:]:
        row = dict(zip(fields, [line[a:b].decode("cp949").strip() for a, b in spans]))
        if row["code"] and not row["deleted"]:
            assert len(row["code"]) == 10 and row["code"].isdigit(), row
            rows.append(row)
    return rows

def json_write(path: Path, data, pretty: bool = False):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2 if pretty else None,
                   separators=None if pretty else (",", ":"), allow_nan=False) + "\n",
        encoding="utf-8"
    )

def build(root: Path, cache: Path):
    source = json.loads(read_source(cache, "source.geojson"))
    rows = official_rows(read_source(cache, "jscode20260701.zip"))
    by_code = {r["code"]: r for r in rows}
    source_features = {f["properties"]["adm_cd2"]: f for f in source["features"]}
    assert len(source_features) == 3558
    assert set(source_features) <= set(by_code), "Boundary codes absent from official active list"
    emd_rows = [r for r in rows if r["emd"] and "출장소" not in r["emd"]]
    missing = {r["code"] for r in emd_rows} - set(source_features)
    assert missing == MISSING_BOUNDARY_CODES, missing

    # The base map uses non-overlapping lowest sigungu units. Enclosing cities
    # also exist in the catalogue/geometry with mapSelectable=False for search
    # and explicit selection; their ward children retain the real parent chain.
    leaf_sigungu_codes = {code[:5] + "00000" for code in source_features | dict.fromkeys(missing)}
    sido_codes = {code[:2] + "00000000" for code in leaf_sigungu_codes}
    excluded_offices = [r for r in rows if any("출장소" in r[k] for k in ["sido", "sigungu", "emd"])]
    aggregate_cities = [r for r in rows if not r["emd"] and r["code"] not in leaf_sigungu_codes | sido_codes and r not in excluded_offices]
    aggregate_codes = {r["code"] for r in aggregate_cities}
    aggregate_by_name = {(r["sido"], r["sigungu"]): r["code"] for r in aggregate_cities}
    sigungu_codes = leaf_sigungu_codes | aggregate_codes
    ward_to_city = {}
    for code in leaf_sigungu_codes:
        row = by_code[code]
        city_code = aggregate_by_name.get((row["sido"], row["sigungu"].split(" ")[0]))
        if city_code:
            ward_to_city[code] = city_code
    selected = [(by_code[c], "sido") for c in sorted(sido_codes)]
    selected += [(by_code[c], "sigungu") for c in sorted(sigungu_codes)]
    selected += [(r, "emd") for r in sorted(emd_rows, key=lambda r: r["code"])]
    regions, geometries, members = [], {}, defaultdict(list)

    for code, feature in source_features.items():
        geom = shape(feature["geometry"])
        assert geom.is_valid and not geom.is_empty and geom.geom_type in ("Polygon", "MultiPolygon"), code
        geometries[code] = geom
        members[code[:5] + "00000"].append(geom)
        members[code[:2] + "00000000"].append(geom)
        city_code = ward_to_city.get(code[:5] + "00000")
        if city_code:
            members[city_code].append(geom)

    for code in sorted(sigungu_codes | sido_codes):
        dissolved = unary_union(members[code])
        assert dissolved.is_valid and not dissolved.is_empty, code
        level = "sido" if code in sido_codes else "sigungu"
        geometries[code] = dissolved.simplify(SIMPLIFICATION[level], preserve_topology=True)

    for row, level in selected:
        code = row["code"]
        parent = None if level == "sido" else rid(
            ward_to_city.get(code, code[:2] + "00000000") if level == "sigungu" else code[:5] + "00000"
        )
        # Sejong has a real MOIS grouping code 3611000000 but no separate
        # lower autonomous city; use its official top-level name once.
        name = row["sido"] if level == "sido" else (row["sigungu"] or row["sido"]) if level == "sigungu" else row["emd"]
        full_name = " ".join(x for x in [row["sido"], row["sigungu"], row["emd"]] if x)
        geom = geometries.get(code)
        center = None
        bbox = None
        if geom is not None:
            point = geom.representative_point()
            center = {"lat": point.y, "lon": point.x}
            bbox = list(geom.bounds)
        entry = {
            "id": rid(code), "code": code, "codeSystem": "MOIS_ADM_10",
            "name": name, "fullName": full_name, "level": level, "parentId": parent,
            "center": center, "bbox": bbox, "boundaryAvailable": geom is not None,
            "mapSelectable": code not in aggregate_codes, "isAggregateCity": code in aggregate_codes
        }
        if level == "emd" and code in source_features:
            props = source_features[code]["properties"]
            entry["statisticsCode"] = str(props["adm_cd"])
            if props["adm_nm"] != full_name:
                entry["aliases"] = [props["adm_nm"], props["adm_nm"].split()[-1]]
        regions.append(entry)

    metadata = {
        "date": DATE, "boundaryDate": DATE, "retrievedAt": RETRIEVED,
        "source": SOURCE, "sourceVersion": "admdongkor/ver20260701",
        "codeSystem": "MOIS_ADM_10", "crs": "EPSG:4326", "coordinateOrder": "longitude,latitude",
        "counts": dict(Counter(r["level"] for r in regions)),
        "boundaryCounts": dict(Counter(r["level"] for r in regions if r["boundaryAvailable"])),
        "totalRegions": len(regions), "totalBoundaries": len(geometries),
        "baseMapCounts": dict(Counter(r["level"] for r in regions if r["boundaryAvailable"] and r["mapSelectable"])),
        "supplementalAggregateCities": len(aggregate_cities),
        "latestOfficialNoticeDateChecked": "2026-07-20",
        "latestOfficialNoticeUrl": NEWER_NOTICE,
        "administrativeChanges": ADMINISTRATIVE_CHANGES,
        "knownLimitations": LIMITATIONS, "attribution": ATTRIBUTION,
        "boundaryLicense": "CC-BY-4.0 (admdongkor modifications); KOGL Type 1 attribution (SGIS upstream)",
        "geometrySimplificationDegrees": SIMPLIFICATION,
        "sourceManifest": "region-sources.json"
    }
    features = []
    for region in regions:
        if not region["boundaryAvailable"]:
            continue
        props = {key: region[key] for key in ["id", "code", "name", "fullName", "level", "parentId", "center", "mapSelectable", "isAggregateCity"]}
        props["regionId"] = region["id"]
        features.append({
            "type": "Feature", "id": region["id"], "bbox": region["bbox"],
            "properties": props, "geometry": mapping(geometries[region["code"]])
        })
    manifest = {
        "snapshotDate": DATE, "retrievedAt": RETRIEVED,
        "catalogue": {
            "provider": "행정안전부", "noticeUrl": MOIS_NOTICE, "downloadUrl": MOIS_URL,
            "file": "jscode20260701.zip", "member": "jscode20260701/KIKcd_H.20260701",
            "sha256": FILES["jscode20260701.zip"][1], "encoding": "CP949",
            "parser": "MOIS fixed byte columns: code[0:10],sido[11:41],sigungu[42:72],emd[73:103],created[104:112],deleted[113:121]",
            "activeOfficialRows": len(rows),
            "termsReference": "https://www.mois.go.kr/frt/sub/a08/copyrightPolicy/screen.do",
            "attribution": "행정안전부, 행정기관(행정동) 및 관할구역(법정동) 변경내역, 2026-07-01"
        },
        "boundaries": {
            "originalProvider": "통계청 통계지리정보서비스 (SGIS)",
            "originalProviderUrl": "https://sgis.kostat.go.kr",
            "processor": "vuski/admdongkor", "repository": "https://github.com/vuski/admdongkor",
            "snapshot": "ver20260701", "commit": BOUNDARY_COMMIT, "downloadUrl": GEO_URL,
            "sha256": FILES["source.geojson"][1], "sourceFeatureCount": len(source_features),
            "crs": "EPSG:4326", "license": "CC-BY-4.0",
            "upstreamLicense": "KOGL Type 1", "licenseStatement": "https://github.com/vuski/admdongkor/blob/master/LICENSE-DATA",
            "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
            "upstreamLicenseUrl": "https://www.kogl.or.kr/info/licenseType1.do",
            "attribution": ATTRIBUTION
        },
        "processing": {
            "nameAuthority": "MOIS, joined to boundary adm_cd2 by exact 10-digit string",
            "ids": "mois:<MOIS 10-digit administrative code>",
            "parents": "emd -> lowest sigungu grouping -> optional enclosing city (also sigungu) -> sido; Sejong grouping 3611000000 retained",
            "emdGeometry": "Original GeoJSON coordinates, unchanged; JSON serialization and properties normalized",
            "parentGeometry": "Shapely unary_union of child EMD polygons, then topology-preserving simplification",
            "simplificationDegrees": SIMPLIFICATION,
            "centers": "Shapely representative_point inside each supplied polygon; not city hall or GPS observations",
            "excludedBranchOffices": [{"code": r["code"], "name": " ".join(r[k] for k in ["sido", "sigungu", "emd"] if r[k])} for r in excluded_offices],
            "supplementalAggregateCities": [{"code": r["code"], "name": " ".join([r["sido"], r["sigungu"]])} for r in aggregate_cities],
            "missingBoundaryRegions": [{"code": r["code"], "name": " ".join([r["sido"],r["sigungu"],r["emd"]])} for r in emd_rows if r["code"] in missing],
            "administrativeChanges": ADMINISTRATIVE_CHANGES,
            "knownLimitations": LIMITATIONS
        }
    }
    data_dir = root / "server" / "data"
    json_write(data_dir / "regions.json", {"metadata": metadata, "regions": regions}, pretty=True)
    json_write(data_dir / "boundaries.geojson", {"type": "FeatureCollection", "metadata": metadata, "features": features})
    json_write(data_dir / "region-sources.json", manifest, pretty=True)
    return validate(root)

def validate(root: Path):
    data_dir = root / "server" / "data"
    catalogue = json.loads((data_dir / "regions.json").read_text(encoding="utf-8"))
    boundaries = json.loads((data_dir / "boundaries.geojson").read_text(encoding="utf-8"))
    regions = catalogue["regions"]
    by_id = {r["id"]: r for r in regions}
    assert len(by_id) == len(regions) == 3848
    assert Counter(r["level"] for r in regions) == {"sido": 16, "sigungu": 269, "emd": 3563}
    assert len(boundaries["features"]) == 3843
    geometries = {}
    for feature in boundaries["features"]:
        region_id = feature["properties"]["regionId"]
        assert region_id in by_id and region_id not in geometries
        geom = shape(feature["geometry"])
        assert geom.is_valid and not geom.is_empty
        west, south, east, north = geom.bounds
        assert 123 < west <= east < 133 and 32 < south <= north < 40, region_id
        center = by_id[region_id]["center"]
        assert center is not None and geom.covers(Point(center["lon"], center["lat"])), region_id
        geometries[region_id] = geom
    for r in regions:
        assert r["code"].isdigit() and len(r["code"]) == 10 and r["id"] == rid(r["code"])
        if r["level"] == "sido":
            assert r["parentId"] is None
        else:
            parent = by_id[r["parentId"]]
            if r["level"] == "emd":
                assert parent["level"] == "sigungu"
            else:
                assert parent["level"] == "sido" or parent["isAggregateCity"]
            trail = {r["id"]}
            while parent["parentId"]:
                assert parent["id"] not in trail, "Parent cycle"
                trail.add(parent["id"])
                parent = by_id[parent["parentId"]]
            assert parent["level"] == "sido" and len(trail) <= 3
        assert r["boundaryAvailable"] == (r["id"] in geometries)
    assert {r["code"] for r in regions if not r["boundaryAvailable"]} == MISSING_BOUNDARY_CODES
    # Known geographic coordinates; expected administrative path is checked.
    samples = [
        ("서울시청", 126.9780, 37.5663, "서울특별시", "중구"),
        ("부산시청", 129.0756, 35.1796, "부산광역시", "연제구"),
        ("서면역", 129.0595, 35.1579, "부산광역시", "부산진구"),
        ("대전시청", 127.3845, 36.3504, "대전광역시", "서구"),
        ("동대구역", 128.6285, 35.8797, "대구광역시", "동구"),
        ("수원시청", 127.0286, 37.2636, "경기도", "수원시 팔달구"),
        ("제주공항", 126.4930, 33.5104, "제주특별자치도", "제주시"),
        ("광주광역시청 위치", 126.8514, 35.1600, "전남광주통합특별시", "서구"),
        ("울릉군청", 130.9059, 37.4845, "경상북도", "울릉군"),
    ]
    leaf = [(by_id[i], g) for i,g in geometries.items() if by_id[i]["level"] == "emd"]
    sample_results = []
    for label, lon, lat, sido, sigungu in samples:
        point = Point(lon,lat)
        matches = [r for r,g in leaf if g.covers(point)]
        assert len(matches) == 1, (label, [r["fullName"] for r in matches])
        r = matches[0]; parent = by_id[r["parentId"]]; top = parent
        while top["parentId"]:
            top = by_id[top["parentId"]]
        assert parent["name"] == sigungu and top["name"] == sido, (label,r["fullName"])
        sample_results.append({"location": label, "regionId": r["id"], "fullName": r["fullName"]})
    return {"counts": catalogue["metadata"]["counts"], "boundaries": len(geometries),
            "parentsValid": True, "centersInside": len(geometries), "samples": sample_results}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--cache-dir", type=Path, default=Path(tempfile.gettempdir()) / "walkwar-regions")
    parser.add_argument("--validate-only", action="store_true")
    args = parser.parse_args()
    result = validate(args.root) if args.validate_only else build(args.root, args.cache_dir)
    print(json.dumps(result, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()

