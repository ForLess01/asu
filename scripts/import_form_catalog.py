"""Generate a pinned, attributed UI catalog; never train or change scientific artifacts."""
import csv
import hashlib
import io
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
REF = 'a783fa66effb16fa8f3321b49a3d5e71cab15a5c'
BASE = f'https://raw.githubusercontent.com/jmcastagnetto/ubigeo-peru-aumentado/{REF}'


def get(url):
    request = urllib.request.Request(url, headers={'User-Agent': 'Asu-Form-Catalog/1.0'})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read(12_000_000)


def main():
    raw = get(f'{BASE}/ubigeo_distrito.json')
    rows = json.loads(raw)
    districts = {}
    for row in rows:
        department, district, province = row['departamento'].strip(), row['distrito'].strip(), row['provincia'].strip()
        if department and district and province:
            code = row.get('inei') or row.get('reniec') or f'{department}/{province}/{district}'
            districts.setdefault(department, []).append([code, district.title(), province.title()])
    manifest = json.loads((ROOT/'artifacts/current/source-manifest.json').read_text())
    source = get(manifest['source_url'])
    if hashlib.sha256(source).hexdigest() != manifest['source_sha256']:
        raise SystemExit('Historical utility-source fingerprint changed; catalog not written')
    text = source.decode('utf-8-sig')
    utilities = sorted({r['EPS'].strip().upper() for r in csv.DictReader(io.StringIO(text), dialect=csv.Sniffer().sniff(text[:8192], delimiters=',;')) if r['EPS'].strip()})
    result = {'departments': sorted(districts), 'districts': districts, 'utilities': utilities}
    target = ROOT/'apps/web/src/form-catalog.json'
    target.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':'))+'\n', encoding='utf-8')
    (ROOT/'docs/FORM_CATALOG_LICENSE.txt').write_bytes(get(f'{BASE}/LICENSE'))
    receipt = {
        'geography_source': f'{BASE}/ubigeo_distrito.json', 'geography_license': 'MIT',
        'geography_author': 'Jesus M. Castagnetto', 'geography_sha256': hashlib.sha256(raw).hexdigest(),
        'geography_source_period': '2021 snapshot; not a current administrative boundary authority',
        'utilities_source': manifest['source_url'], 'utilities_sha256': manifest['source_sha256'],
        'utilities_attribution': manifest['attribution'], 'utilities_license': manifest['license'],
        'catalog_sha256': hashlib.sha256(target.read_bytes()).hexdigest(),
        'department_count': len(districts), 'district_count': sum(map(len, districts.values())), 'utility_count': len(utilities),
        'limitations': 'Historical reference options only; not service coverage. Explicit not-listed entry preserves newer districts/providers.'
    }
    (ROOT/'docs/form-catalog-source.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps(receipt, ensure_ascii=False))


if __name__ == '__main__':
    main()
