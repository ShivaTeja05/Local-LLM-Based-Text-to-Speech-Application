"""CPU thread sharing between the LLM and Piper."""

import os

from app.config import Settings, cpu_threads
from app.llm.ollama_adapter import OllamaAdapter


def test_cpu_threads_uses_a_share_of_the_cores(monkeypatch):
    monkeypatch.setattr(os, "cpu_count", lambda: 12)
    assert cpu_threads(0, 0.5) == 6
    assert cpu_threads(0, 1 / 3) == 4


def test_cpu_threads_never_below_one(monkeypatch):
    monkeypatch.setattr(os, "cpu_count", lambda: 1)
    assert cpu_threads(0, 1 / 3) == 1


def test_configured_thread_count_wins():
    assert cpu_threads(3, 0.5) == 3


def test_ollama_gets_an_explicit_thread_count():
    adapter = OllamaAdapter(Settings(_env_file=None, llm_num_thread=5))
    assert adapter._payload([])["options"]["num_thread"] == 5
