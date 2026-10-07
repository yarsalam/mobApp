import logging
from typing import Dict, List, Optional

import networkx as nx

logger = logging.getLogger(__name__)


class TrustFlowCalculator:
    def compute_trust_flow(
        self, edges: List[List[str]], trusted_seeds: Optional[List[str]] = None
    ) -> Dict[str, float]:
        """
        edges: لیستی از (source_domain, target_domain)
        trusted_seeds: دامنه‌های معتبر (مثلاً .gov, .edu) برای بایاس PageRank.
                       اگر خالی/None باشد، PageRank بدون بایاس (استاندارد) محاسبه می‌شود.
        """
        if not edges:
            return {}

        G = nx.DiGraph()
        G.add_edges_from(edges)

        personalization = None
        if trusted_seeds:
            # فقط seedهایی که واقعاً در گراف حضور دارند را در نظر بگیر
            valid_seeds = [s for s in trusted_seeds if s in G.nodes()]
            if valid_seeds:
                personalization = {
                    node: 1.0 if node in valid_seeds else 0.0 for node in G.nodes()
                }
            else:
                logger.warning(
                    "هیچ‌کدام از trusted_seeds در گراف بک‌لینک یافت نشد؛ "
                    "PageRank بدون بایاس اجرا می‌شود."
                )

        try:
            pr = nx.pagerank(G, personalization=personalization, alpha=0.85)
        except nx.PowerIterationFailedConvergence as exc:
            logger.error("PageRank did not converge: %s", exc)
            # fallback: توزیع یکنواخت به‌جای کرش کامل سرویس
            n = len(G.nodes())
            return {node: 1.0 / n for node in G.nodes()} if n else {}

        return pr