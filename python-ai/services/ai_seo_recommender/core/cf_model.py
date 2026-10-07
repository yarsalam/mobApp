import logging
import os
from typing import Dict, List, Tuple

import joblib
import numpy as np
from scipy.sparse import csr_matrix

logger = logging.getLogger(__name__)
MODEL_PATH = os.getenv("CF_MODEL_PATH", "/app/models/cf_model.pkl")


class SEOCollaborativeFilter:
    def __init__(self, factors: int = 50):
        self.factors = factors
        self.model = None
        self._user_index: Dict[str, int] = {}
        self._item_index: Dict[str, int] = {}
        self._user_ids: List[str] = []
        self._item_ids: List[str] = []
        self._user_items = None
        self._popular_items: List[str] = []
        self.trained: bool = False
        self._load()

    def _load(self) -> None:
        if not os.path.exists(MODEL_PATH):
            return
        try:
            data = joblib.load(MODEL_PATH)
            self.model = data["model"]
            self._user_index = data["user_index"]
            self._item_index = data["item_index"]
            self._user_ids = data["user_ids"]
            self._item_ids = data["item_ids"]
            self._user_items = data["user_items"]
            self._popular_items = data.get("popular_items", [])
            self.trained = True
            logger.info("CF model loaded")
        except Exception as exc:
            logger.warning("Could not load CF model: %s", exc)

    def _save(self) -> None:
        os.makedirs(os.path.dirname(MODEL_PATH), exist_ok=True)
        tmp = MODEL_PATH + ".tmp"
        joblib.dump(
            {
                "model": self.model,
                "user_index": self._user_index,
                "item_index": self._item_index,
                "user_ids": self._user_ids,
                "item_ids": self._item_ids,
                "user_items": self._user_items,
                "popular_items": self._popular_items,
            },
            tmp,
        )
        os.replace(tmp, MODEL_PATH)

    def train(self, interactions: List[Tuple[str, str, float]]) -> Dict:
        if not interactions:
            raise ValueError("interactions cannot be empty")

        user_index: Dict[str, int] = {}
        item_index: Dict[str, int] = {}
        rows, cols, data = [], [], []
        item_totals: Dict[str, float] = {}

        for u, i, r in interactions:
            if u not in user_index:
                user_index[u] = len(user_index)
            if i not in item_index:
                item_index[i] = len(item_index)
            rows.append(user_index[u])
            cols.append(item_index[i])
            data.append(float(r))
            item_totals[i] = item_totals.get(i, 0) + float(r)

        # محبوب‌ترین آیتم‌ها برای Cold Start
        self._popular_items = sorted(item_totals, key=item_totals.get, reverse=True)[
            :20
        ]

        # ماتریس user-item (implicit نیاز به item×user دارد)
        user_item_matrix = csr_matrix(
            (data, (rows, cols)),
            shape=(len(user_index), len(item_index)),
            dtype=np.float32,
        )
        # implicit از item-user matrix استفاده می‌کند
        item_user_matrix = user_item_matrix.T.tocsr()

        try:
            import implicit

            model = implicit.als.AlternatingLeastSquares(
                factors=self.factors, iterations=20, regularization=0.1
            )
            model.fit(item_user_matrix)

            self.model = model
            self._user_index = user_index
            self._item_index = item_index
            self._user_ids = list(user_index.keys())
            self._item_ids = list(item_index.keys())
            self._user_items = user_item_matrix
            self.trained = True
            self._save()
            return {
                "status": "trained",
                "users": len(self._user_ids),
                "items": len(self._item_ids),
            }

        except ImportError:
            logger.warning("implicit not available, using popularity fallback")
            self.trained = True
            self._save()
            return {"status": "trained_popularity_fallback"}

    def recommend(self, user_id: str, n: int = 5) -> List[str]:
        if not self.trained:
            raise ValueError("Model not trained yet")

        # Cold Start: کاربر ناشناخته → محبوب‌ترین‌ها
        if user_id not in self._user_index or self.model is None:
            logger.info("Cold start for user %s, returning popular items", user_id)
            return self._popular_items[:n]

        user_idx = self._user_index[user_id]
        try:
            ids, _scores = self.model.recommend(
                user_idx,
                self._user_items[user_idx],
                N=n,
                filter_already_liked_items=True,
            )
            return [self._item_ids[i] for i in ids if i < len(self._item_ids)]
        except Exception as exc:
            logger.warning("ALS recommend failed: %s, falling back to popular", exc)
            return self._popular_items[:n]
