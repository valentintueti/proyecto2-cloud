import boto3
import pytest
from moto import mock_aws

from common import storage
from common.tenant import TenantError

BUCKET = "hcm-test"


@pytest.fixture
def s3(monkeypatch):
    with mock_aws():
        boto3.client("s3", region_name="us-east-1").create_bucket(Bucket=BUCKET)
        monkeypatch.setenv("BUCKET_NAME", BUCKET)
        yield


def test_tenant_key_builds_prefix():
    assert storage.tenant_key("acme", "cvs", "c1.pdf") == "tenants/acme/cvs/c1.pdf"


@pytest.mark.parametrize("bad", ["..", ".", "", "a/b", "a\\b"])
def test_tenant_key_rejects_bad_segments(bad):
    with pytest.raises(ValueError):
        storage.tenant_key("acme", bad)


def test_tenant_key_rejects_bad_tenant():
    with pytest.raises(TenantError):
        storage.tenant_key("../acme", "x.pdf")


def test_safe_filename():
    assert storage.safe_filename("../mi cv (1).pdf") == "mi_cv__1_.pdf"
    assert storage.safe_filename("") == "file"


def test_put_and_get_roundtrip(s3):
    key = storage.tenant_key("acme", "cvs", "a.pdf")
    storage.put_bytes("acme", key, b"hola", "application/pdf")
    assert storage.get_bytes("acme", key) == b"hola"


def test_other_tenant_cannot_read(s3):
    key = storage.tenant_key("acme", "cvs", "a.pdf")
    storage.put_bytes("acme", key, b"hola")
    with pytest.raises(TenantError):
        storage.get_bytes("globex", key)


def test_presigned_urls(s3):
    key = storage.tenant_key("acme", "cvs", "a.pdf")
    assert key in storage.presigned_upload("acme", key, "application/pdf")
    assert key in storage.presigned_download("acme", key)
    with pytest.raises(TenantError):
        storage.presigned_download("globex", key)