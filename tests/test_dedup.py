import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from daily_arxiv.daily_arxiv.check_stats import perform_deduplication, main
from daily_arxiv.daily_arxiv.merge_daily import merge_daily


class DedupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.data = self.root / "data"
        self.history = self.root / "history"
        self.data.mkdir()
        self.history.mkdir()
        self.today = self.data / "2026-10-14.jsonl"

    def write(self, path, ids):
        path.write_text("".join(json.dumps({"id": i, "title": i}) + "\n" for i in ids))

    def ids(self, path):
        return [json.loads(line)["id"] for line in path.read_text().splitlines()]

    def dedup(self):
        return perform_deduplication(self.today, self.history, "2026-10-14")

    def test_filters_today_and_previous_seven_days_and_internal_duplicates(self):
        self.write(self.today, ["today", "yesterday", "boundary", "new", "new", "old"])
        self.write(self.history / self.today.name, ["today"])
        self.write(self.history / "2026-10-13.jsonl", ["yesterday"])
        self.write(self.history / "2026-10-07.jsonl", ["boundary"])
        self.write(self.history / "2026-10-06.jsonl", ["old"])
        self.assertEqual(self.dedup(), "has_new_content")
        self.assertEqual(self.ids(self.today), ["new", "old"])

    def test_same_day_rerun_skips_all_published_ids_without_changing_history(self):
        self.write(self.today, ["a", "b"])
        published = self.history / self.today.name
        self.write(published, ["a", "b"])
        before = published.read_bytes()
        self.assertEqual(self.dedup(), "no_new_content")
        self.assertFalse(self.today.exists())
        self.assertEqual(published.read_bytes(), before)

    def test_corrupt_today_is_error_and_preserves_file(self):
        self.today.write_text("{invalid\n")
        self.assertEqual(self.dedup(), "error")
        self.assertEqual(self.today.read_text(), "{invalid\n")

    def test_corrupt_history_is_error_and_preserves_input(self):
        self.write(self.today, ["a"])
        before = self.today.read_bytes()
        (self.history / "2026-10-13.jsonl").write_text("{invalid\n")
        self.assertEqual(self.dedup(), "error")
        self.assertEqual(self.today.read_bytes(), before)

    def test_missing_id_is_error(self):
        self.today.write_text('{}\n')
        self.assertEqual(self.dedup(), "error")

    def test_missing_history_directory_is_error(self):
        self.write(self.today, ["a"])
        self.assertEqual(perform_deduplication(self.today, self.root / "missing", "2026-10-14"), "error")

    def test_first_run_and_empty_feed(self):
        self.write(self.today, ["a"])
        self.assertEqual(self.dedup(), "has_new_content")
        self.write(self.today, [])
        self.assertEqual(self.dedup(), "no_data")

    def test_cli_no_new_content_returns_one(self):
        self.write(self.today, ["a"])
        self.write(self.history / self.today.name, ["a"])
        with patch("sys.argv", ["check_stats.py", "--input", str(self.today),
                                "--history-dir", str(self.history), "--date", "2026-10-14"]):
            self.assertEqual(main(), 1)

    def test_incremental_merge_preserves_published_raw_and_ai_results(self):
        for name in [self.today.name, "2026-10-14_AI_enhanced_Chinese.jsonl"]:
            self.write(self.history / name, ["a", "b"])
            self.write(self.data / name, ["c", "c"])
        merge_daily(self.data, self.history, "2026-10-14", "Chinese")
        for name in [self.today.name, "2026-10-14_AI_enhanced_Chinese.jsonl"]:
            self.assertEqual(self.ids(self.data / name), ["a", "b", "c"])
            self.assertEqual(self.ids(self.history / name), ["a", "b"])


if __name__ == "__main__":
    unittest.main()
