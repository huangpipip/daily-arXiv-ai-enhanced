#!/usr/bin/env python3
"""Merge new daily results with the same day's already published papers."""
import argparse
from pathlib import Path

if __package__:
    from .check_stats import load_papers_data, save_papers_data
else:
    from check_stats import load_papers_data, save_papers_data


def merge_daily(data_dir, history_dir, crawl_date, language):
    for name in (f"{crawl_date}.jsonl", f"{crawl_date}_AI_enhanced_{language}.jsonl"):
        output = Path(data_dir) / name
        if not output.is_file():
            raise ValueError(f"New daily output is missing: {output}")
        published, _ = load_papers_data(Path(history_dir) / name)
        new, _ = load_papers_data(output)
        papers = {paper["id"]: paper for paper in published}
        papers.update({paper["id"]: paper for paper in new})
        save_papers_data(papers.values(), output)
        print(f"Merged {name}: {len(published)} published + {len(new)} new -> {len(papers)} unique")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", required=True, type=Path)
    parser.add_argument("--history-dir", required=True, type=Path)
    parser.add_argument("--date", required=True)
    parser.add_argument("--language", required=True)
    args = parser.parse_args()
    merge_daily(args.data_dir, args.history_dir, args.date, args.language)
