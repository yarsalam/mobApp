import logging
from datetime import datetime
from typing import Dict, List, Optional

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

logger = logging.getLogger(__name__)


class CompetitorIntelligence:
    def __init__(self):
        self.vectorizer = TfidfVectorizer(max_features=1000, stop_words="english")
        self.known_competitors: List[str] = []

    def analyze_content_gap(
        self, our_content: str, competitor_content: List[str]
    ) -> List[Dict]:
        if not our_content or not competitor_content:
            return []

        all_content = [our_content] + competitor_content
        vectors = self.vectorizer.fit_transform(all_content)
        similarities = cosine_similarity(vectors[0:1], vectors[1:])[0]
        our_keywords = set(self.vectorizer.get_feature_names_out())

        gaps = []
        for i, sim in enumerate(similarities):
            if sim < 0.4:
                comp_text = competitor_content[i]
                comp_vectors = self.vectorizer.transform([comp_text])
                comp_keywords_idx = comp_vectors.toarray()[0].argsort()[-10:][::-1]
                comp_keywords = [
                    self.vectorizer.get_feature_names_out()[idx]
                    for idx in comp_keywords_idx
                ]
                missing_keywords = [k for k in comp_keywords if k not in our_keywords]
                gaps.append(
                    {
                        "competitor_index": i,
                        "similarity": float(sim),
                        "missing_keywords": missing_keywords[:10],
                        "opportunity_score": float(1 - sim),
                    }
                )

        return sorted(gaps, key=lambda x: x["opportunity_score"], reverse=True)

    def detect_new_competitors(self, search_results: List[Dict]) -> List[Dict]:
        potential_competitors = []

        for result in search_results:
            url = result.get("url", "")
            title = result.get("title", "")
            snippet = result.get("snippet", "")

            if not any(comp in url for comp in self.known_competitors):
                relevance = self._calculate_relevance(title + " " + snippet)
                if relevance > 0.5:
                    potential_competitors.append(
                        {
                            "url": url,
                            "title": title,
                            "relevance_score": relevance,
                            "detected_at": datetime.now().isoformat(),
                            "estimated_traffic": self._estimate_traffic(url),
                        }
                    )

        return potential_competitors

    def _calculate_relevance(self, text: str) -> float:
        keywords = [
            "همسریابی",
            "ازدواج",
            "دوستیابی",
            "همدم",
            "همسان",
            "dating",
            "match",
            "marriage",
            "relationship",
        ]
        text_lower = text.lower()
        matches = sum(1 for k in keywords if k.lower() in text_lower)
        return min(1.0, matches / len(keywords) * 2)

    def _estimate_traffic(self, url: str) -> Optional[int]:
        # TODO: از SimilarWeb یا APIهای مشابه
        # فعلاً None برگردان — random بازگشت دادن گمراه‌کننده است
        return None

    def analyze_serp_features(self, keyword: str) -> Dict:
        # TODO: از Google Search API
        return {
            "keyword": keyword,
            "featured_snippet": False,
            "people_also_ask": [],
            "related_searches": [],
            "top_10_domains": [],
            "avg_content_length": 1500,
        }

    def track_competitor_mentions(self, competitor_name: str, days: int = 7) -> Dict:
        # TODO: از Google Alerts یا Mention API
        return {
            "competitor": competitor_name,
            "mentions": None,  # placeholder — عدد تصادفی نمی‌دهیم
            "sentiment": None,
            "top_sources": [],
        }
