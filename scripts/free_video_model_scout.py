#!/usr/bin/env python3
"""Read-only model discovery for review. No inference, billing or auto-installation."""
import argparse
import datetime as dt
import json
import os
import urllib.parse
import urllib.request
from pathlib import Path

HOST = 'https://huggingface.co'
ALLOWED_LICENSES = {
    'apache-2.0', 'mit', 'bsd-3-clause', 'bsd-2-clause',
    'cc-by-4.0', 'cc0-1.0', 'openrail', 'creativeml-openrail-m',
}
KEYWORDS = ('wan', 'hunyuanvideo', 'ltx', 'mochi', 'cogvideox',
            'skyreels', 'animate', 'video', 'seedance', 'allegro')


def metadata_candidates(payload):
    if not isinstance(payload, list):
        raise ValueError('Unexpected Hugging Face models response')
    results = []
    for item in payload[:100]:
        if not isinstance(item, dict):
            continue
        model_id = item.get('id')
        if not isinstance(model_id, str) or '/' not in model_id or len(model_id) > 180:
            continue
        tags = item.get('tags') if isinstance(item.get('tags'), list) else []
        tags = [tag for tag in tags if isinstance(tag, str)]
        license_tag = next((tag.split('license:',1)[1] for tag in tags
                            if tag.startswith('license:')), None)
        pipeline = item.get('pipeline_tag')
        if pipeline != 'text-to-video' and not any(
                word in model_id.lower() for word in KEYWORDS):
            continue
        results.append({
            'id': model_id,
            'source': HOST + '/' + urllib.parse.quote(model_id, safe='/'),
            'updatedAt': item.get('lastModified') if isinstance(item.get('lastModified'), str) else None,
            'pipeline': pipeline or 'unverified',
            'license': license_tag or 'unverified',
            'licenseReview': 'candidate' if license_tag in ALLOWED_LICENSES else 'manual-review',
            'monthlyFreeApiCredits': None,
            'freeHostedInferenceVerified': False,
            'executionReady': False,
            'computeCost': 'unknown / GPU may be required',
            'modelUseNotes': 'Metadata-only discovery. Verify current model card, provider quota, license and runtime before integration.',
        })
    return results


def retrieve_model_metadata():
    query = urllib.parse.urlencode({
        'pipeline_tag':'text-to-video','sort':'lastModified',
        'direction':'-1','limit':60,'full':'false'
    })
    request = urllib.request.Request(
        HOST + '/api/models?' + query,
        headers={'Accept':'application/json','User-Agent':'mabrig-video-scout/1.0'},
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        raw = response.read(1024*1024+1)
    if len(raw)>1024*1024:
        raise ValueError('Model catalogue exceeds read limit')
    return json.loads(raw)


def report(payload, timestamp):
    return {
        'schema':'mabrig.video-model-scout.v1',
        'checkedAt':timestamp,
        'readOnly':True,
        'provider':'Hugging Face public model metadata',
        'source':HOST+'/models?pipeline_tag=text-to-video',
        'notes':'Open model weights are not a verified free hosted inference API. Never auto-execute, auto-connect or invent monthly credit balances.',
        'models':metadata_candidates(payload),
    }


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--fixture',type=Path,default=None)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    data=json.loads(args.fixture.read_text()) if args.fixture else retrieve_model_metadata()
    result=report(data,dt.datetime.now(dt.timezone.utc).isoformat())
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(result,indent=2,ensure_ascii=False)+'\n')
    print('Saved',len(result['models']),'model metadata candidates to',args.output)


if __name__=='__main__':
    main()
