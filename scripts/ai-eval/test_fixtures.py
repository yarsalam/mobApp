#!/usr/bin/env python3
import json
import tempfile
import unittest
from pathlib import Path

from generate_fixtures import build_dataset, write_dataset


class SyntheticFixtureTests(unittest.TestCase):
    def test_expected_dataset_sizes(self):
        data = build_dataset(20261110)
        self.assertEqual(len(data["profiles"]), 300)
        self.assertEqual(len(data["matching_pairs"]), 1500)
        self.assertEqual(len(data["moderation_cases"]), 700)
        self.assertEqual(len(data["assistant_cases"]), 100)
        self.assertEqual(len(data["support_cases"]), 100)

    def test_moderation_corpus_has_at_least_100_unique_texts(self):
        data = build_dataset(20261110)
        unique_texts = {case["text"] for case in data["moderation_cases"]}
        self.assertGreaterEqual(len(unique_texts), 100)
        labels = {case["expected_policy"] for case in data["moderation_cases"]}
        self.assertEqual(labels, {"allow", "block", "review"})

    def test_matching_pairs_reference_known_profiles(self):
        data = build_dataset(20261110)
        profile_ids = {p["synthetic_id"] for p in data["profiles"]}
        for pair in data["matching_pairs"]:
            self.assertIn(pair["seeker_id"], profile_ids)
            self.assertIn(pair["candidate_id"], profile_ids)
            self.assertNotEqual(pair["seeker_id"], pair["candidate_id"])
            self.assertIsInstance(pair["expected_hard_eligible"], bool)

    def test_all_rows_are_explicitly_synthetic(self):
        data = build_dataset(20261110)
        for name, rows in data.items():
            for row in rows:
                self.assertTrue(row["synthetic_only"], name)

    def test_no_common_real_account_identifiers(self):
        data = build_dataset(20261110)
        for rows in data.values():
            for row in rows:
                encoded = json.dumps(row, ensure_ascii=False)
                self.assertNotIn("@gmail.com", encoded)
                self.assertNotIn("@yahoo.com", encoded)
                self.assertNotIn("+989", encoded)

    def test_seed_is_reproducible(self):
        self.assertEqual(build_dataset(12345), build_dataset(12345))

    def test_jsonl_output_and_manifest(self):
        data = build_dataset(20261110)
        with tempfile.TemporaryDirectory() as temp:
            out = Path(temp) / "fixtures"
            write_dataset(data, out, 20261110)
            manifest = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
            self.assertTrue(manifest["synthetic_only"])
            for name, rows in data.items():
                parsed = [
                    json.loads(line)
                    for line in (out / f"{name}.jsonl").read_text(encoding="utf-8").splitlines()
                ]
                self.assertEqual(len(parsed), len(rows))


if __name__ == "__main__":
    unittest.main()
