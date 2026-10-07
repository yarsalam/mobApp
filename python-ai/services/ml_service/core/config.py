from pydantic_settings import BaseSettings
from pydantic import Field
from typing import Dict


class MLSettings(BaseSettings):
    MAX_CANDIDATES: int = 300
    DEFAULT_LIMIT: int = 50
    MAX_LIMIT: int = 100
    EMBEDDING_TTL_DAYS: int = 7
    STREAM_MAXLEN: int = 100_000

    RECOMMENDATION_WEIGHTS: Dict[str, float] = Field(
        default_factory=lambda: {"embedding": 0.65, "revenue": 0.25, "engagement": 0.10}
    )

    POPULAR_USERS_KEY: str = "cache:popular_users"
    FALLBACK_CITIES_KEY: str = "cache:city_popular:{city}"

    class Config:
        env_prefix = "ML_"
        extra = "ignore"


settings = MLSettings()
