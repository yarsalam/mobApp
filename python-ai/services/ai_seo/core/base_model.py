import logging
import os

import joblib

logger = logging.getLogger(__name__)


class PersistentModelMixin:
    def __init__(self, model_path: str):
        self.model_path = model_path
        self.model = None
        self._load()

    def _load(self) -> bool:
        if os.path.exists(self.model_path):
            try:
                self.model = joblib.load(self.model_path)
                logger.info("Loaded model from %s", self.model_path)
                return True
            except Exception as exc:
                logger.warning("Could not load model from %s: %s", self.model_path, exc)
        return False

    def save(self) -> None:
        os.makedirs(os.path.dirname(self.model_path), exist_ok=True)
        tmp = self.model_path + ".tmp"
        joblib.dump(self.model, tmp)
        os.replace(tmp, self.model_path)
        logger.info("Model saved to %s", self.model_path)
