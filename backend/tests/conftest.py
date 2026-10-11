"""Tests use their own small case library (tests/fixtures) so the live library can change freely."""
from pathlib import Path

import pytest

from app.cases import reload_cases
from app.config import settings

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture(autouse=True, scope="session")
def _fixture_cases():
    original = settings.cases_dir
    settings.cases_dir = FIXTURES
    reload_cases()
    yield
    settings.cases_dir = original
    reload_cases()
