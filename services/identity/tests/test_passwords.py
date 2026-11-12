import pytest

from src.passwords import hash_password, verify_password


def test_hash_and_verify():
    stored = hash_password("Secreta123")
    assert verify_password("Secreta123", stored)
    assert not verify_password("otra-clave", stored)


def test_same_password_different_hashes():
    assert hash_password("Secreta123") != hash_password("Secreta123")


def test_short_password_rejected():
    with pytest.raises(ValueError):
        hash_password("corta")


@pytest.mark.parametrize("stored", [None, "", "basura", "md5$1$a$b", "pbkdf2_sha256$x$y$z"])
def test_invalid_stored_hash_is_false(stored):
    assert verify_password("Secreta123", stored) is False