import json

import pytest
from conftest import api_event

from common.tenant import (
    TenantError,
    get_tenant,
    is_valid_tenant_id,
    require_role,
    schema_name,
    tenant_pk,
)


@pytest.mark.parametrize("tenant", ["acme", "globex", "initech_2"])
def test_tenant_validos(tenant):
    assert is_valid_tenant_id(tenant)


@pytest.mark.parametrize(
    "tenant", ["ACME", "1acme", "a", "acme;", "acme; DROP", "acme\n", "acme-x", "", None, 123]
)
def test_tenant_invalidos(tenant):
    assert not is_valid_tenant_id(tenant)


def test_get_tenant_desde_authorizer():
    assert get_tenant(api_event("globex")) == "globex"


def test_ignora_tenant_del_body():
    event = api_event("acme", body=json.dumps({"tenantId": "globex"}))
    assert get_tenant(event) == "acme"


def test_sin_authorizer_falla():
    with pytest.raises(TenantError):
        get_tenant({"requestContext": {}})


def test_require_role_permite_y_bloquea():
    assert require_role(api_event(role="ADMIN_RRHH"), "ADMIN_RRHH")["tenantId"] == "acme"
    with pytest.raises(PermissionError):
        require_role(api_event(role="EMPLOYEE"), "ADMIN_RRHH", "MANAGER")


def test_schema_y_pk():
    assert schema_name("acme") == "tenant_acme"
    assert tenant_pk("acme") == "TENANT#acme"
    with pytest.raises(TenantError):
        schema_name("acme; DROP SCHEMA public")