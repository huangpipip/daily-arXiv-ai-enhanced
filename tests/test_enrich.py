import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock

import requests

from daily_arxiv.daily_arxiv.enrich import (
    MetadataFetchError,
    RssClient,
    enrich_candidates,
    load_candidates,
    parse_rss,
    write_jsonl_atomic,
)


RSS = b"""<?xml version="1.0"?>
<rss xmlns:arxiv="http://arxiv.org/schemas/atom"
     xmlns:dc="http://purl.org/dc/elements/1.1/" version="2.0">
  <channel>
    <item>
      <title>Paper One</title>
      <link>https://arxiv.org/abs/1234.00001</link>
      <description>arXiv:1234.00001v1 Announce Type: new
Abstract: First &amp; complete abstract.</description>
      <category>cs.AI</category><category>cs.LG</category>
      <arxiv:announce_type>new</arxiv:announce_type>
      <dc:creator>Ada Author, Bob Writer</dc:creator>
    </item>
  </channel>
</rss>"""


class FakeRssClient:
    def __init__(self, feeds):
        self.feeds = feeds
        self.calls = []

    def fetch_category(self, category):
        self.calls.append(category)
        return self.feeds[category]


class EnrichTests(unittest.TestCase):
    def test_load_candidates_deduplicates_and_merges_categories(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "raw.jsonl"
            path.write_text(
                "\n".join(
                    [
                        json.dumps({"id": "1234.00001", "categories": ["cs.AI"]}),
                        json.dumps({"id": "1234.00001", "categories": ["cs.LG"]}),
                        json.dumps({"id": "1234.00002", "categories": []}),
                    ]
                ),
                encoding="utf-8",
            )

            candidates = load_candidates(path)

        self.assertEqual([item["id"] for item in candidates], ["1234.00001", "1234.00002"])
        self.assertEqual(candidates[0]["categories"], ["cs.AI", "cs.LG"])

    def test_parse_rss_extracts_complete_metadata(self):
        papers = parse_rss(RSS)

        self.assertEqual(papers["1234.00001"]["title"], "Paper One")
        self.assertEqual(papers["1234.00001"]["authors"], ["Ada Author", "Bob Writer"])
        self.assertEqual(papers["1234.00001"]["categories"], ["cs.AI", "cs.LG"])
        self.assertEqual(papers["1234.00001"]["summary"], "First & complete abstract.")

    def test_enrich_fetches_each_category_once_and_preserves_listing_authors(self):
        rss_paper = parse_rss(RSS)["1234.00001"]
        candidates = [
            {
                "id": "1234.00001",
                "source_category": "cs.AI",
                "authors": ["Ada Lovelace"],
                "title": "Paper One",
                "categories": ["cs.AI"],
                "comment": "10 pages",
            }
        ]
        client = FakeRssClient({"cs.AI": {"1234.00001": rss_paper}})

        records = enrich_candidates(candidates, client)

        self.assertEqual(client.calls, ["cs.AI"])
        self.assertEqual(records[0]["authors"], ["Ada Lovelace"])
        self.assertEqual(records[0]["summary"], "First & complete abstract.")
        self.assertEqual(records[0]["comment"], "10 pages")

    def test_missing_rss_result_fails_instead_of_returning_partial_data(self):
        candidates = [{"id": "1234.00002", "source_category": "cs.AI"}]

        with self.assertRaises(MetadataFetchError):
            enrich_candidates(candidates, FakeRssClient({"cs.AI": {}}))

    def test_rss_client_retries_with_exponential_backoff(self):
        failed = requests.Response()
        failed.status_code = 429
        failed.url = "https://rss.arxiv.org/rss/cs.AI"
        success = requests.Response()
        success.status_code = 200
        success._content = RSS
        session = Mock()
        session.headers = {}
        session.get.side_effect = [failed, failed, success]
        delays = []
        clock = iter([0, 5, 5, 15, 15])
        client = RssClient(
            request_delay=3,
            timeout=30,
            max_retries=2,
            backoff_seconds=5,
            user_agent="test-agent",
            session=session,
            sleep=delays.append,
            monotonic=lambda: next(clock),
        )

        papers = client.fetch_category("cs.AI")

        self.assertIn("1234.00001", papers)
        self.assertEqual(delays, [5, 10])
        self.assertEqual(session.headers["User-Agent"], "test-agent")

    def test_atomic_jsonl_write(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "papers.jsonl"
            write_jsonl_atomic([{"id": "1234.00001", "title": "test"}], output)

            self.assertEqual(
                json.loads(output.read_text(encoding="utf-8")),
                {"id": "1234.00001", "title": "test"},
            )
            self.assertFalse(output.with_suffix(".jsonl.tmp").exists())


if __name__ == "__main__":
    unittest.main()
