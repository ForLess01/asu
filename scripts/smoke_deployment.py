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
        with urllib.request.urlopen(base + path, timeout=30) as response:
            if response.status != 200:
                raise ValueError('Unexpected HTTP status')
            return response.read()
    html = get('/')
    if b'<html' not in html.lower():
        raise SystemExit('Application HTML unavailable')
    release = json.loads(get('/version.json'))
    model = get('/models/current/model.json')
    if hashlib.sha256(model).hexdigest() != release['model_sha256']:
        raise SystemExit('Published release/model mismatch')
    print(json.dumps({'status': 'passed', 'url': base, 'release': release}, ensure_ascii=False))


if __name__ == '__main__':
    main()
