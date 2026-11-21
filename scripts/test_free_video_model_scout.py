import unittest
from free_video_model_scout import metadata_candidates, report


class ScoutTest(unittest.TestCase):
    def test_cannot_infer_free_api_allowance_from_open_weights(self):
        rows=metadata_candidates([
            {'id':'Wan-AI/Wan2.1-T2V-1.3B-Diffusers',
             'pipeline_tag':'text-to-video','tags':['license:apache-2.0'],
             'lastModified':'2026-11-21T00:00:00Z'},
        ])
        self.assertEqual(len(rows),1)
        item=rows[0]
        self.assertEqual(item['licenseReview'],'candidate')
        self.assertIsNone(item['monthlyFreeApiCredits'])
        self.assertFalse(item['executionReady'])
        self.assertFalse(item['freeHostedInferenceVerified'])
        self.assertEqual(item['source'],'https://huggingface.co/Wan-AI/Wan2.1-T2V-1.3B-Diffusers')

    def test_unknown_license_is_never_auto_connected(self):
        rows=metadata_candidates([{'id':'org/example-video',
                                  'pipeline_tag':'text-to-video','tags':[]}])
        self.assertEqual(rows[0]['licenseReview'],'manual-review')
        self.assertFalse(rows[0]['executionReady'])

    def test_invalid_metadata_fails_closed(self):
        with self.assertRaises(ValueError):
            metadata_candidates({'models':[]})

    def test_non_video_is_excluded(self):
        self.assertEqual([],metadata_candidates([
            {'id':'org/text-only','pipeline_tag':'text-generation','tags':[]}
        ]))

    def test_report_is_read_only(self):
        result=report([], '2026-11-21T00:00:00Z')
        self.assertTrue(result['readOnly'])
        self.assertEqual(result['models'],[])


if __name__ == '__main__':
    unittest.main()
