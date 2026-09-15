#!/usr/bin/env python3
"""Enrich arXiv listing records with abstracts from official RSS feeds."""

from __future__ import annotations

import argparse
import html
import json
import logging
import os
import re
import time
import xml.etree.ElementTree as ET
from collections.abc import Callable, Iterable, Sequence
from pathlib import Path
from typing import Any
from urllib.parse import quote

import requests


LOGGER = logging.getLogger("arxiv_enrich")
DEFAULT_USER_AGENT = (
    "daily-arXiv-ai-enhanced/1.0 (mailto:huangpipip@outlook.com)"
)
ARXIV_NAMESPACE = "http://arxiv.org/schemas/atom"
ABSTRACT_PREFIX = re.compile(r"^.*?Abstract:\s*", re.DOTALL)


class MetadataFetchError(RuntimeError):
    """Raised when complete RSS metadata cannot be retrieved."""


def load_candidates(path: Path) -> list[dict[str, Any]]:
    """Load candidate papers, deduplicating IDs while preserving their order."""
    candidates: dict[str, dict[str, Any]] = {}

    with path.open(encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            try:
                item = json.loads(line)
            except json.JSONDecodeError as error:
                raise ValueError(f"Invalid JSON on line {line_number} of {path}") from error

            paper_id = str(item.get("id", "")).strip()
            if not paper_id:
                raise ValueError(f"Missing paper ID on line {line_number} of {path}")

            if paper_id not in candidates:
                candidates[paper_id] = item
                candidates[paper_id]["id"] = paper_id
                candidates[paper_id]["categories"] = list(item.get("categories") or [])
                continue

            existing = candidates[paper_id]["categories"]
            for category in item.get("categories") or []:
                if category not in existing:
                    existing.append(category)

    return list(candidates.values())


def parse_rss(content: bytes) -> dict[str, dict[str, Any]]:
    """Parse metadata needed by this project from an arXiv RSS document."""
    try:
        root = ET.fromstring(content)
    except ET.ParseError as error:
        raise MetadataFetchError("arXiv returned invalid RSS XML") from error

    papers: dict[str, dict[str, Any]] = {}
    for item in root.findall("./channel/item"):
        link = (item.findtext("link") or "").strip()
        paper_id = link.rstrip("/").rsplit("/", 1)[-1]
        paper_id = re.sub(r"v\d+$", "", paper_id)
        if not paper_id:
            continue

        description = html.unescape(item.findtext("description") or "").strip()
        summary = ABSTRACT_PREFIX.sub("", description, count=1).strip()
        categories = [
            element.text.strip()
            for element in item.findall("category")
            if element.text and element.text.strip()
        ]
        creator = item.findtext("{http://purl.org/dc/elements/1.1/}creator") or ""

        papers[paper_id] = {
            "title": (item.findtext("title") or "").strip(),
            "authors": [name.strip() for name in creator.split(",") if name.strip()],
            "categories": categories,
            "summary": summary,
            "announce_type": item.findtext(f"{{{ARXIV_NAMESPACE}}}announce_type"),
        }

    if not papers:
        raise MetadataFetchError("arXiv RSS feed contained no papers")
    return papers


class RssClient:
    """Single-connection RSS client that enforces arXiv's request interval."""

    def __init__(
        self,
        *,
        request_delay: float,
        timeout: float,
        max_retries: int,
        backoff_seconds: float,
        user_agent: str,
        session: requests.Session | None = None,
        sleep: Callable[[float], None] = time.sleep,
        monotonic: Callable[[], float] = time.monotonic,
    ):
        self.request_delay = request_delay
        self.timeout = timeout
        self.max_retries = max_retries
        self.backoff_seconds = backoff_seconds
        self.session = session or requests.Session()
        self.session.headers.update({"User-Agent": user_agent})
        self.sleep = sleep
        self.monotonic = monotonic
        self.last_request_at: float | None = None

    def _wait_for_rate_limit(self) -> None:
        if self.last_request_at is None:
            return
        remaining = self.request_delay - (self.monotonic() - self.last_request_at)
        if remaining > 0:
            self.sleep(remaining)

    def fetch_category(self, category: str) -> dict[str, dict[str, Any]]:
        url = f"https://rss.arxiv.org/rss/{quote(category, safe='.-')}"
        for attempt in range(self.max_retries + 1):
            try:
                self._wait_for_rate_limit()
                response = self.session.get(url, timeout=self.timeout)
                self.last_request_at = self.monotonic()
                response.raise_for_status()
                return parse_rss(response.content)
            except (requests.RequestException, MetadataFetchError) as error:
                if attempt >= self.max_retries:
                    raise MetadataFetchError(
                        f"Failed to fetch RSS category {category} after {attempt + 1} attempts"
                    ) from error

                delay = self.backoff_seconds * (2**attempt)
                LOGGER.warning(
                    "RSS request for %s failed (%s). Retrying in %.0f seconds (%d/%d).",
                    category,
                    error,
                    delay,
                    attempt + 1,
                    self.max_retries,
                )
                self.sleep(delay)

        raise AssertionError("unreachable")


def enrich_candidates(
    candidates: Sequence[dict[str, Any]], client: RssClient
) -> list[dict[str, Any]]:
    """Fetch each source RSS feed once and require every candidate to be present."""
    categories = list(
        dict.fromkeys(
            item.get("source_category")
            for item in candidates
            if item.get("source_category")
        )
    )
    if candidates and not categories:
        raise MetadataFetchError("Candidate records do not contain source_category")

    metadata: dict[str, dict[str, Any]] = {}
    for index, category in enumerate(categories, start=1):
        LOGGER.info("Fetching RSS category %d/%d: %s", index, len(categories), category)
        metadata.update(client.fetch_category(category))

    missing = [item["id"] for item in candidates if item["id"] not in metadata]
    if missing:
        raise MetadataFetchError(
            f"RSS feeds omitted {len(missing)} candidate paper(s): {', '.join(missing[:10])}"
        )

    records = []
    for item in candidates:
        rss = metadata[item["id"]]
        records.append(
            {
                "id": item["id"],
                "pdf": f"https://arxiv.org/pdf/{item['id']}",
                "abs": f"https://arxiv.org/abs/{item['id']}",
                "authors": item.get("authors") or rss["authors"],
                "title": item.get("title") or rss["title"],
                "categories": rss["categories"] or item.get("categories") or [],
                "comment": item.get("comment"),
                "summary": rss["summary"],
            }
        )
    return records


def write_jsonl_atomic(records: Iterable[dict[str, Any]], output_path: Path) -> None:
    """Write JSONL without leaving a partial final file on failure."""
    temporary_path = output_path.with_suffix(f"{output_path.suffix}.tmp")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with temporary_path.open("w", encoding="utf-8") as handle:
            for record in records:
                handle.write(json.dumps(record, ensure_ascii=False) + "\n")
        temporary_path.replace(output_path)
    finally:
        temporary_path.unlink(missing_ok=True)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path, help="Raw JSONL from Scrapy")
    parser.add_argument("--output", required=True, type=Path, help="Enriched JSONL path")
    parser.add_argument(
        "--request-delay",
        type=float,
        default=float(os.environ.get("ARXIV_RSS_DELAY_SECONDS", "5")),
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=float(os.environ.get("ARXIV_RSS_TIMEOUT_SECONDS", "30")),
    )
    parser.add_argument(
        "--max-retries",
        type=int,
        default=int(os.environ.get("ARXIV_RSS_MAX_RETRIES", "4")),
    )
    parser.add_argument(
        "--backoff-seconds",
        type=float,
        default=float(os.environ.get("ARXIV_RSS_BACKOFF_SECONDS", "15")),
    )
    parser.add_argument(
        "--user-agent",
        default=os.environ.get("ARXIV_USER_AGENT", DEFAULT_USER_AGENT),
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

    candidates = load_candidates(args.input)
    LOGGER.info("Loaded %d unique paper IDs", len(candidates))
    client = RssClient(
        request_delay=max(3.0, args.request_delay),
        timeout=args.timeout,
        max_retries=args.max_retries,
        backoff_seconds=args.backoff_seconds,
        user_agent=args.user_agent,
    )
    records = enrich_candidates(candidates, client)
    write_jsonl_atomic(records, args.output)
    LOGGER.info("Wrote %d complete records to %s", len(records), args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
