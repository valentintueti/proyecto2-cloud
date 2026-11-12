import os
import re

import boto3
from botocore.config import Config

from common.tenant import TenantError, is_valid_tenant_id

_s3 = None
_UNSAFE_CHARS = re.compile(r"[^A-Za-z0-9._-]")


def _client():
    global _s3
    if _s3 is None:
        _s3 = boto3.client("s3", config=Config(signature_version="s3v4"))
    return _s3


def _bucket(bucket=None):
    name = bucket or os.environ.get("BUCKET_NAME")
    if not name:
        raise RuntimeError("BUCKET_NAME no está definido")
    return name


def tenant_prefix(tenant_id):
    if not is_valid_tenant_id(tenant_id):
        raise TenantError(f"tenantId inválido: {tenant_id!r}")
    return f"tenants/{tenant_id}/"


def tenant_key(tenant_id, *parts):
    """tenant_key("acme", "cvs", "c1.pdf") -> "tenants/acme/cvs/c1.pdf"."""
    clean = []
    for part in parts:
        part = str(part)
        if not part or part in (".", "..") or "/" in part or "\\" in part:
            raise ValueError(f"Segmento de ruta inválido: {part!r}")
        clean.append(part)
    if not clean:
        raise ValueError("Se necesita al menos un segmento de ruta")
    return tenant_prefix(tenant_id) + "/".join(clean)


def safe_filename(name, max_length=100):
    """Limpia un nombre de archivo enviado por el usuario."""
    base = str(name or "").replace("\\", "/").rsplit("/", 1)[-1]
    base = _UNSAFE_CHARS.sub("_", base).lstrip(".")
    return base[:max_length] or "file"


def assert_tenant_key(tenant_id, key):
    if not str(key).startswith(tenant_prefix(tenant_id)):
        raise TenantError("La key no pertenece al tenant")
    return key


def presigned_upload(tenant_id, key, content_type, expires_in=300, bucket=None):
    assert_tenant_key(tenant_id, key)
    return _client().generate_presigned_url(
        "put_object",
        Params={"Bucket": _bucket(bucket), "Key": key, "ContentType": content_type},
        ExpiresIn=expires_in,
    )


def presigned_download(tenant_id, key, expires_in=300, bucket=None):
    assert_tenant_key(tenant_id, key)
    return _client().generate_presigned_url(
        "get_object",
        Params={"Bucket": _bucket(bucket), "Key": key},
        ExpiresIn=expires_in,
    )


def put_bytes(tenant_id, key, body, content_type="application/octet-stream", bucket=None):
    assert_tenant_key(tenant_id, key)
    _client().put_object(Bucket=_bucket(bucket), Key=key, Body=body, ContentType=content_type)
    return key


def get_bytes(tenant_id, key, bucket=None):
    assert_tenant_key(tenant_id, key)
    return _client().get_object(Bucket=_bucket(bucket), Key=key)["Body"].read()