import scrapy
import os
import re


class ArxivSpider(scrapy.Spider):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        categories = os.environ.get("CATEGORIES", "cs.CV")
        categories = categories.split(",")
        # 保存目标分类列表，用于后续验证
        self.target_categories = set(map(str.strip, categories))
        self.seen_ids = set()
        self.start_urls = [
            f"https://arxiv.org/list/{cat}/new" for cat in self.target_categories
        ]  # 起始URL（计算机科学领域的最新论文）

    name = "arxiv"  # 爬虫名称
    allowed_domains = ["arxiv.org"]  # 允许爬取的域名

    def parse(self, response):
        source_category = response.url.split("/list/", 1)[-1].split("/", 1)[0]
        # 提取每篇论文的信息
        anchors = []
        for li in response.css("div[id=dlpage] ul li"):
            href = li.css("a::attr(href)").get()
            if href and "item" in href:
                anchors.append(int(href.split("item")[-1]))

        # 遍历每篇论文的详细信息
        for paper in response.css("dl dt"):
            paper_anchor = paper.css("a[name^='item']::attr(name)").get()
            if not paper_anchor:
                continue
                
            paper_id = int(paper_anchor.split("item")[-1])
            if anchors and paper_id >= anchors[-1]:
                continue

            # 获取论文ID
            abstract_link = paper.css("a[title='Abstract']::attr(href)").get()
            if not abstract_link:
                continue
                
            arxiv_id = abstract_link.split("/")[-1]

            # 同一篇论文可能同时出现在多个分类页面。先在 spider 级别
            # 去重，避免后续重复处理和重复输出。
            if arxiv_id in self.seen_ids:
                continue
            
            # 获取对应的论文描述部分 (dd元素)
            paper_dd = paper.xpath("following-sibling::dd[1]")
            if not paper_dd:
                continue
            
            # 提取论文分类信息 - 在subjects部分
            primary_subject = paper_dd.css(
                ".list-subjects .primary-subject::text"
            ).get()
            if not primary_subject:
                # 如果找不到主分类，尝试其他方式获取分类
                primary_subject = paper_dd.css(".list-subjects::text").get()
            
            if primary_subject:
                # 解析分类信息，通常格式如 "Computer Vision and Pattern Recognition (cs.CV)"
                # 提取括号中的分类代码
                primary_categories = re.findall(r'\(([^)]+)\)', primary_subject)
                all_subjects = " ".join(
                    paper_dd.css(".list-subjects ::text").getall()
                )
                categories_in_paper = re.findall(r'\(([^)]+)\)', all_subjects)
                
                # 保持原行为：只纳入主分类属于目标分类的论文。
                if set(primary_categories).intersection(self.target_categories):
                    self.seen_ids.add(arxiv_id)
                    yield {
                        "id": arxiv_id,
                        "source_category": source_category,
                        "categories": categories_in_paper,
                        "title": " ".join(
                            paper_dd.css(".list-title::text").getall()
                        ).strip(),
                        "authors": paper_dd.css(".list-authors a::text").getall(),
                        "comment": " ".join(
                            paper_dd.css(".list-comments::text").getall()
                        ).strip() or None,
                    }
                    self.logger.debug(
                        "Found paper %s with categories %s",
                        arxiv_id,
                        categories_in_paper,
                    )
                else:
                    self.logger.debug(
                        "Skipped paper %s: primary category is not in %s",
                        arxiv_id,
                        self.target_categories,
                    )
            else:
                # 如果无法获取分类信息，记录警告但仍然返回论文（保持向后兼容）
                self.logger.warning(f"Could not extract categories for paper {arxiv_id}, including anyway")
                self.seen_ids.add(arxiv_id)
                yield {
                    "id": arxiv_id,
                    "source_category": source_category,
                    "categories": [],
                    "title": " ".join(
                        paper_dd.css(".list-title::text").getall()
                    ).strip(),
                    "authors": paper_dd.css(".list-authors a::text").getall(),
                    "comment": " ".join(
                        paper_dd.css(".list-comments::text").getall()
                    ).strip() or None,
                }

    def closed(self, reason):
        self.logger.info(
            "Collected %d unique paper IDs (reason: %s)", len(self.seen_ids), reason
        )
