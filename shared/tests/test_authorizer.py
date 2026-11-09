import pytest

from common.auth import create_token
from common.authorizer import handler

METHOD_ARN = "arn:aws:execute-api:us-east-1:123456789012:abc123/dev/GET/employees"


def test_token_valido_permite_y_pasa_contexto():
    token = create_token("u-7", "globex", "MANAGER")
    result = handler({"authorizationToken": f"Bearer {token}", "methodArn": METHOD_ARN}, None)

    statement = result["policyDocument"]["Statement"][0]
    assert statement["Effect"] == "Allow"
    assert statement["Resource"] == "arn:aws:execute-api:us-east-1:123456789012:abc123/dev/*"
    assert result["principalId"] == "u-7"
    assert result["context"] == {"tenantId": "globex", "userId": "u-7", "role": "MANAGER"}


@pytest.mark.parametrize("header", [None, "Bearer basura", "sin-bearer"])
def test_token_invalido_responde_unauthorized(header):
    with pytest.raises(Exception, match="^Unauthorized$"):
        handler({"authorizationToken": header, "methodArn": METHOD_ARN}, None)