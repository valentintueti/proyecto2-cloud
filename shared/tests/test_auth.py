import pytest

from common.auth import AuthError, create_token, extract_bearer, parse_duration, verify_token


def test_token_roundtrip_conserva_tenant_y_rol():
    claims = verify_token(create_token("u-1", "acme", "ADMIN_RRHH"))
    assert claims["sub"] == "u-1"
    assert claims["tenantId"] == "acme"
    assert claims["role"] == "ADMIN_RRHH"
    assert claims["exp"] - claims["iat"] == 3600


def test_token_firmado_con_otro_secreto_se_rechaza(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "otro-secreto-distinto-con-mas-de-32-caracteres")
    forged = create_token("u-1", "globex", "ADMIN_RRHH")
    monkeypatch.setenv("JWT_SECRET", "secreto-de-pruebas-con-mas-de-32-caracteres")
    with pytest.raises(AuthError, match="inválido"):
        verify_token(forged)


def test_token_expirado_se_rechaza():
    with pytest.raises(AuthError, match="expirado"):
        verify_token(create_token("u-1", "acme", "EMPLOYEE", expires_in=-10))


def test_basura_se_rechaza():
    with pytest.raises(AuthError):
        verify_token("no.es.un.jwt")


@pytest.mark.parametrize("tenant", ["ACME", "acme; DROP SCHEMA x", "", "a"])
def test_no_emite_token_con_tenant_invalido(tenant):
    with pytest.raises(ValueError):
        create_token("u-1", tenant, "EMPLOYEE")


def test_no_emite_token_con_rol_invalido():
    with pytest.raises(ValueError):
        create_token("u-1", "acme", "SUPERADMIN")


def test_falta_jwt_secret(monkeypatch):
    monkeypatch.delenv("JWT_SECRET")
    with pytest.raises(RuntimeError):
        create_token("u-1", "acme", "EMPLOYEE")


@pytest.mark.parametrize("header, expected", [("Bearer abc", "abc"), ("bearer  abc ", "abc")])
def test_extract_bearer_valido(header, expected):
    assert extract_bearer(header) == expected


@pytest.mark.parametrize("header", [None, "", "abc", "Basic abc", "Bearer "])
def test_extract_bearer_invalido(header):
    with pytest.raises(AuthError):
        extract_bearer(header)


@pytest.mark.parametrize("value, seconds", [("3600", 3600), ("30m", 1800), ("8h", 28800), ("1d", 86400)])
def test_parse_duration(value, seconds):
    assert parse_duration(value) == seconds


@pytest.mark.parametrize("value", ["", "h", "8x", "-5m"])
def test_parse_duration_invalido(value):
    with pytest.raises(ValueError):
        parse_duration(value)