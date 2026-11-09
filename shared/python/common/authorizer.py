import logging

from .auth import AuthError, extract_bearer, verify_token

logger = logging.getLogger(__name__)


def _api_wildcard_arn(method_arn: str) -> str:
    api_arn, _, path = method_arn.partition("/")
    stage = path.split("/", 1)[0]
    return f"{api_arn}/{stage}/*"


def handler(event, context):
    try:
        claims = verify_token(extract_bearer(event.get("authorizationToken")))
    except AuthError as exc:
        logger.info("Acceso denegado: %s", exc)
        raise Exception("Unauthorized") from exc

    return {
        "principalId": claims["sub"],
        "policyDocument": {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Action": "execute-api:Invoke",
                    "Effect": "Allow",
                    "Resource": _api_wildcard_arn(event["methodArn"]),
                }
            ],
        },

        "context": {
            "tenantId": claims["tenantId"],
            "userId": claims["sub"],
            "role": claims["role"],
        },
    }