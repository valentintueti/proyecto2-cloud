import base64
import hashlib
import hmac
import os

ALGORITHM = "pbkdf2_sha256"
DEFAULT_ITERATIONS = 100_000
MIN_LENGTH = 8


def _iterations() -> int:
    return int(os.environ.get("PASSWORD_ITERATIONS", DEFAULT_ITERATIONS))


def hash_password(password: str) -> str:
    if not isinstance(password, str) or len(password) < MIN_LENGTH:
        raise ValueError(f"La contraseña debe tener al menos {MIN_LENGTH} caracteres")
    iterations = _iterations()
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, iterations)
    return "$".join([
        ALGORITHM,
        str(iterations),
        base64.b64encode(salt).decode(),
        base64.b64encode(digest).decode(),
    ])


def verify_password(password, stored) -> bool:
    try:
        algorithm, iterations, salt, expected = str(stored).split("$")
        if algorithm != ALGORITHM:
            return False
        iterations = int(iterations)
        salt = base64.b64decode(salt)
        expected = base64.b64decode(expected)
    except ValueError:  # incluye binascii.Error
        return False
    actual = hashlib.pbkdf2_hmac("sha256", str(password).encode(), salt, iterations)
    return hmac.compare_digest(actual, expected)