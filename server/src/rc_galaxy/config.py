import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[3] / ".env")  # repo root

RC_TOKEN = os.environ["RC_TOKEN"]
