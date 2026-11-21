#!/usr/bin/env python3
"""Daily no-secret public video checkpoint scout.

Writes JSON leads to stdout. GitHub workflow may create *review-only* issues.
Model discovery != free-tier allowance, inference readiness or licensing.
"""
import json
import os
import re
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode
from urllib.request import Request, urlopen

HF_API = 'https://huggingface.co/api/models'
SEARCH = ('Wan2', 'LTX-Video', 'CogVideoX', 'HunyuanVideo', 'SkyReels', 'Mochi')
ALLOWED = re.compile(r'^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$')


def recent(value, cutoff):
    if not value or not isinstance(value, str):
        return False
    try:
        return datetime.fromisoformat(value.replace('Z', '+00:00')) >= cutoff
    except ValueError:
        return False


def leads_for(records, cutoff):
    output = []
    for entry in records:
        if not isinstance(entry, dict):
            continue
        ident = entry.get('id') or entry.get('modelId')
        if not isinstance(ident, str) or not ALLOWED.fullmatch(ident):
            continue
        if entry.get('private') or entry.get('gated'):
            continue
        if not recent(entry.get('createdAt'), cutoff):
            continue
        # Do not claim these can make video without reading the model card.
        output.append({
            'id': ident,
            'url': 'https://huggingface.co/' + ident,
            'createdAt': entry['createdAt'],
            'status': 'unverified-model-candidate',
            'freeMonthlyCloudCredits': None,
            'requiresLicenseAndAPIReview': True,
        })
    return output


def discover():
    cutoff = datetime.now(timezone.utc) - timedelta(days=7)
    found = {}
    for term in SEARCH:
        query = urlencode({'search': term, 'sort':'createdAt', 'direction':'-1', 'limit':30})
        try:
            request = Request(HF_API + '?' + query,
                              headers={'Accept':'application/json','User-Agent':'MabrigFreeVideoScout/1.0'})
            with urlopen(request, timeout=18) as response:
                body = response.read(512 * 1024 + 1)
            if len(body) > 512 * 1024:
                raise ValueError('HF response oversized')
            entries = json.loads(body)
            if not isinstance(entries, list):
                raise ValueError('HF response not a list')
            for lead in leads_for(entries, cutoff):
                found[lead['id']] = lead
        except Exception as error:
            print(f'Source unavailable for {term}: {type(error).__name__}', file=__import__('sys').stderr)
    return sorted(found.values(),key=lambda v:v['createdAt'],reverse=True)


if __name__ == '__main__':
    print(json.dumps({
        'scannedAt':datetime.now(timezone.utc).isoformat(),
        'provider':'Hugging Face official public model API',
        'automaticConnection':False,
        'automaticBilling':False,
        'creditsMeasured':False,
        'models':discover(),
    }, indent=2))
