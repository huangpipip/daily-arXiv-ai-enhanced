import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import requests

from daily_arxiv.daily_arxiv.enrich import (
    MetadataFetchError,
    RssClient,
    fetch_papers,
    main,
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
    def test_parse_rss_extracts_complete_metadata(self):
        papers = parse_rss(RSS)

        self.assertEqual(papers["1234.00001"]["title"], "Paper One")
        self.assertEqual(papers["1234.00001"]["authors"], ["Ada Author", "Bob Writer"])
        self.assertEqual(papers["1234.00001"]["categories"], ["cs.AI", "cs.LG"])
        self.assertEqual(papers["1234.00001"]["summary"], "First & complete abstract.")

    def test_fetches_configured_categories_once_and_deduplicates_papers(self):
        rss_paper = parse_rss(RSS)["1234.00001"]
        client = FakeRssClient({
            "cs.AI": {"1234.00001": rss_paper},
            "cs.LG": {"1234.00001": {**rss_paper, "announce_type": "cross"}},
        })

        records = fetch_papers(["cs.AI", " cs.LG ", "cs.AI", ""], client)

        self.assertEqual(client.calls, ["cs.AI", "cs.LG"])
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["authors"], ["Ada Author", "Bob Writer"])
        self.assertEqual(records[0]["summary"], "First & complete abstract.")
        self.assertEqual(records[0]["abs"], "https://arxiv.org/abs/1234.00001")
        self.assertEqual(records[0]["pdf"], "https://arxiv.org/pdf/1234.00001")
        self.assertIsNone(records[0]["comment"])

    def test_filters_replacements_and_non_target_primary_categories(self):
        paper = parse_rss(RSS)["1234.00001"]
        client = FakeRssClient({"cs.AI": {
            "new": paper,
            "cross": {**paper, "announce_type": "cross"},
            "replace": {**paper, "announce_type": "replace"},
            "replace-cross": {**paper, "announce_type": "replace-cross"},
            "other-primary": {**paper, "categories": ["cs.LG", "cs.AI"]},
        }})

        records = fetch_papers(["cs.AI"], client)

        self.assertEqual([record["id"] for record in records], ["new", "cross"])

    def test_empty_feed_is_valid_and_other_categories_are_still_fetched(self):
        self.assertEqual(parse_rss(b'<rss version="2.0"><channel/></rss>'), {})
        paper = parse_rss(RSS)["1234.00001"]
        client = FakeRssClient({"cs.LG": {}, "cs.AI": {"1234.00001": paper}})
        self.assertEqual(len(fetch_papers(["cs.LG", "cs.AI"], client)), 1)
        self.assertEqual(fetch_papers(["cs.LG"], client), [])

    def test_invalid_document_and_incomplete_metadata_fail(self):
        for document in (
            b"not XML", b"<html/>", b"<rss/>",
            RSS.replace(b"First &amp; complete abstract.", b""),
            RSS.replace(b"<category>cs.AI</category><category>cs.LG</category>", b""),
        ):
            with self.subTest(document=document), self.assertRaises(MetadataFetchError):
                parse_rss(document)

    def test_version_suffix_is_removed(self):
        papers = parse_rss(RSS.replace(b"/abs/1234.00001", b"/abs/1234.00001v2"))
        self.assertEqual(list(papers), ["1234.00001"])

    def test_failed_category_does_not_return_partial_data(self):
        client = Mock()
        client.fetch_category.side_effect = [parse_rss(RSS), MetadataFetchError("unavailable")]
        with self.assertRaises(MetadataFetchError):
            fetch_papers(["cs.AI", "cs.LG"], client)

    def test_empty_configuration_is_rejected(self):
        with self.assertRaises(ValueError):
            fetch_papers(["", " "], FakeRssClient({}))

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

    def test_main_uses_categories_environment_and_writes_empty_output(self):
        client = FakeRssClient({"cs.AI": {}})
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "papers.jsonl"
            with (
                patch.dict("os.environ", {"CATEGORIES": "cs.AI"}),
                patch("sys.argv", ["enrich.py", "--output", str(output)]),
                patch("daily_arxiv.daily_arxiv.enrich.RssClient", return_value=client),
            ):
                self.assertEqual(main(), 0)
            self.assertTrue(output.exists())
            self.assertEqual(output.read_text(), "")
        self.assertEqual(client.calls, ["cs.AI"])

    def test_fetch_failure_preserves_existing_output(self):
        client = Mock()
        client.fetch_category.side_effect = MetadataFetchError("unavailable")
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "papers.jsonl"
            output.write_text("existing data\n")
            with (
                patch("sys.argv", ["enrich.py", "--categories", "cs.AI", "--output", str(output)]),
                patch("daily_arxiv.daily_arxiv.enrich.RssClient", return_value=client),
                self.assertRaises(MetadataFetchError),
            ):
                main()
            self.assertEqual(output.read_text(), "existing data\n")


if __name__ == "__main__":
    unittest.main()
