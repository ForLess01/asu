"""Verify a real published URL and its model fingerprint; never fabricate a URL."""

import hashlib
import json
import os
import urllib.parse
import urllib.request


def main():
    base = os.environ.get('ASU_PUBLIC_URL', '').rstrip('/')
    if not base.startswith('https://') or urllib.parse.urlparse(base).hostname is None:
        raise SystemExit('ASU_PUBLIC_URL must be the verified HTTPS Pages URL')
    def get(path):
        # The Pages edge rejects the generic Python-urllib user agent (error 1010).
        request = urllib.request.Request(base + path, headers={'User-Agent': 'Asu-Deployment-Check/1.0'})
        with urllib.request.urlopen(request, timeout=30) as response:
            if response.status != 200:
                raise ValueError('Unexpected HTTP status')
            return response.read()
    html = get('/')
    if b'<html' not in html.lower():
        raise SystemExit('Application HTML unavailable')
    release = json.loads(get('/version.json'))
    expected_commit = os.environ.get('CODE_REVISION')
    if expected_commit and release.get('commit') != expected_commit:
        raise SystemExit('Published release/expected commit mismatch')
    model = get('/models/current/model.json')
    if hashlib.sha256(model).hexdigest() != release['model_sha256']:
        raise SystemExit('Published release/model mismatch')
    print(json.dumps({'status': 'passed', 'url': base, 'release': release}, ensure_ascii=False))


if __name__ == '__main__':
    main()
