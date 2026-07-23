import os
from pathlib import Path

from cryptography.fernet import Fernet
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

OAUTH_ENCRYPTION_KEY = os.getenv("OAUTH_ENCRYPTION_KEY")
if not OAUTH_ENCRYPTION_KEY:
    raise RuntimeError(
        "OAUTH_ENCRYPTION_KEY is not set. Add it to your .env file. Generate with: "
        'python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"'
    )

try:
    _fernet = Fernet(OAUTH_ENCRYPTION_KEY.encode())
except (ValueError, TypeError) as exc:
    raise RuntimeError(
        "OAUTH_ENCRYPTION_KEY is not a valid Fernet key. Generate with: "
        'python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"'
    ) from exc


def encrypt_token(plaintext: str) -> str:
    """Encrypt a Google OAuth access/refresh token for storage in google_oauth_tokens."""
    return _fernet.encrypt(plaintext.encode()).decode()


def decrypt_token(ciphertext: str) -> str:
    """Decrypt a stored token. Raises cryptography.fernet.InvalidToken if the
    ciphertext is corrupt or was encrypted with a different OAUTH_ENCRYPTION_KEY -
    callers should treat that as "connection invalid, user must reconnect Google"
    rather than crashing the reminder flow."""
    return _fernet.decrypt(ciphertext.encode()).decode()
