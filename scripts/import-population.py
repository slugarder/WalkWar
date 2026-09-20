"""Build the frozen 2026-08 population HP rules from the official MoIS CSV.

Usage: python scripts/import-population.py path/to/mois-population-202608.csv
Run deliberately for a reviewed rules update, never as part of GPS/map requests.
"""
import csv
import hashlib
import json
import re
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
source = Path(sys.argv[1])
catalog = json.loads((root / 'server/data/regions.json').read_text(encoding='utf-8'))
regions = catalog['regions']
by_id = {r['id']: r for r in regions}
with source.open(encoding='cp949', newline='') as f:
    reader = csv.DictReader(f)
    key = '2026년08월_총인구수'
    assert key in reader.fieldnames, 'Expected August 2026 official population CSV'
    population = {}
    for row in reader:
        code = re.search(r'\((\d{10})\)\s*$', row['행정구역']).group(1)
        assert code not in population, f'Duplicate population code: {code}'
        population[code] = int(row[key].replace(',', ''))

rows = []
for r in regions:
    p = population[r['code']]
    assert p >= 0
    parent = by_id.get(r['parentId'], {})
    if r['level'] == 'sido':
        tier = 'metro'
    elif r['code'] == '3611000000':
        tier = 'alias'
    elif r['level'] == 'emd' or parent.get('level') == 'sigungu' or r['code'] in ('5011000000', '5013000000'):
        tier = 'lower'
    else:
        tier = 'basic'
    eligible = tier != 'alias' and r.get('boundaryAvailable', True) and p > 0
    rows.append(dict(code=r['code'], population=p, tier=tier, eligible=eligible, maxHp=None))

def assign(tier, formula):
    for r in rows:
        if r['tier'] == tier and r['eligible']:
            r['maxHp'] = formula(r['population'])
    return max(r['maxHp'] for r in rows if r['tier'] == tier and r['eligible'])

lower_max = assign('lower', lambda p: max(1000, 3 * p))
basic_base = max(10000, lower_max * 10)
basic_max = assign('basic', lambda p: basic_base + 3 * p)
metro_base = max(100000, basic_max * 10)
assign('metro', lambda p: metro_base + 3 * p)
assert (lower_max, basic_base, basic_max, metro_base) == (1452447, 14524470, 18081501, 180815010)
assert len(rows) == 3848 and sum(r['eligible'] for r in rows) == 3842
result = dict(metadata=dict(rulesVersion='population-202608-tier10-v1', populationMonth='2026-08',
    lowerMaxHp=lower_max, basicBaseHp=basic_base, basicMaxHp=basic_max, metroBaseHp=metro_base,
    populationMultiplier=3, tierGap=10, floors=dict(lower=1000, basic=10000, metro=100000),
    source='https://jumin.mois.go.kr/statMonth.do', sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),
    scope='전체읍면동현황, 등록구분 전체, 외국인 제외', catalogDate=catalog['metadata']['date']),
    regions=rows, aliases={'3611000000': '3600000000'})
(root / 'server/data/population-balance.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(f'Created population-balance.json: {len(rows)} rows, {sum(r["eligible"] for r in rows)} targets')
