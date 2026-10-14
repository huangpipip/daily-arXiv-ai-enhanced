#!/usr/bin/env python3
"""Remove papers already published today or in the previous seven UTC days."""
import argparse
import json
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path


def load_papers_data(file_path):
    path = Path(file_path)
    if not path.exists():
        return [], set()
    papers = []
    ids = set()
    with path.open(encoding="utf-8") as handle:
        for number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            try:
                paper = json.loads(line)
                paper_id = paper["id"]
                if not isinstance(paper_id, str) or not paper_id.strip():
                    raise ValueError("missing paper ID")
            except (ValueError, KeyError, TypeError) as error:
                raise ValueError(f"Invalid paper on line {number} of {path}: {error}") from error
            papers.append(paper)
            ids.add(paper_id)
    return papers, ids


def save_papers_data(papers, file_path):
    path = Path(file_path)
    temporary = path.with_suffix(path.suffix + ".tmp")
    try:
        with temporary.open("w", encoding="utf-8") as handle:
            for paper in papers:
                handle.write(json.dumps(paper, ensure_ascii=False) + "\n")
        temporary.replace(path)
        return True
    finally:
        temporary.unlink(missing_ok=True)


def perform_deduplication(input_path=None, history_dir=None, crawl_date=None):
    day = date.fromisoformat(crawl_date) if crawl_date else datetime.now(timezone.utc).date()
    input_path = Path(input_path or f"../data/{day}.jsonl")
    history_dir = Path(history_dir) if history_dir is not None else input_path.parent
    if not input_path.exists():
        print("今日数据文件不存在 / Today's data file does not exist", file=sys.stderr)
        return "no_data"
    try:
        if not history_dir.is_dir():
            raise ValueError(f"History directory does not exist: {history_dir}")
        papers, _ = load_papers_data(input_path)
        print(f"今日论文总数: {len(papers)}", file=sys.stderr)
        if not papers:
            return "no_data"
        history_ids = set()
        for offset in range(8):
            history_path = history_dir / f"{day - timedelta(days=offset)}.jsonl"
            # Without a separate snapshot, today's input is not published history.
            if history_path.resolve() == input_path.resolve():
                continue
            _, ids = load_papers_data(history_path)
            history_ids.update(ids)
        print(f"当天及此前7日去重库大小: {len(history_ids)}", file=sys.stderr)
        seen_ids = set(history_ids)
        new_papers = []
        for paper in papers:
            if paper["id"] not in seen_ids:
                seen_ids.add(paper["id"])
                new_papers.append(paper)
        print(f"过滤重复条目: {len(papers) - len(new_papers)}; 去重后剩余论文数: {len(new_papers)}", file=sys.stderr)
        if not new_papers:
            input_path.unlink()
            return "no_new_content"
        save_papers_data(new_papers, input_path)
        return "has_new_content"
    except (OSError, ValueError, TypeError) as error:
        print(f"去重处理失败: {error}", file=sys.stderr)
        return "error"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path)
    parser.add_argument("--history-dir", type=Path)
    parser.add_argument("--date", dest="crawl_date", type=date.fromisoformat)
    args = parser.parse_args()
    status = perform_deduplication(args.input, args.history_dir,
                                  args.crawl_date.isoformat() if args.crawl_date else None)
    print(f"去重结果: {status}", file=sys.stderr)
    return {"has_new_content": 0, "no_new_content": 1, "no_data": 1, "error": 2}[status]


if __name__ == "__main__":
    raise SystemExit(main())
