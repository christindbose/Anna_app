from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="ANNA_", env_file=REPO_ROOT / ".env", extra="ignore")

    # LLM
    llm_provider: str = "openai"  # openai (any OpenAI-compatible server, e.g. vLLM) | mock
    llm_base_url: str = "http://127.0.0.1:8001/v1"
    llm_api_key: str = "none"
    llm_model: str = "google/medgemma-1.5-4b-it"
    llm_max_tokens: int = 400
    llm_temperature: float = 0.6

    # TTS (Kokoro server; empty disables server-side voices and the UI falls back to browser speech)
    tts_base_url: str = "http://127.0.0.1:8002"

    # App
    learner_name: str = "Anna"
    app_password: str = ""  # empty disables auth
    db_path: Path = REPO_ROOT / "data" / "anna.db"
    cases_dir: Path = REPO_ROOT / "cases"
    cors_origins: list[str] = ["http://localhost:3000", "http://127.0.0.1:3000"]


settings = Settings()
