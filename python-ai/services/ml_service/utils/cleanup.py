import logging
import os
import shutil

logger = logging.getLogger(__name__)


def cleanup_old_models(model_dir: str, keep_last: int = 3) -> None:
    os.makedirs(model_dir, exist_ok=True)
    entries = sorted(os.listdir(model_dir))
    for old in entries[:-keep_last]:
        path = os.path.join(model_dir, old)
        try:
            if os.path.isdir(path):
                shutil.rmtree(path)
            else:
                os.remove(path)
            logger.info("Removed old model: %s", path)
        except Exception as exc:
            logger.warning("Failed to remove %s: %s", path, exc)
