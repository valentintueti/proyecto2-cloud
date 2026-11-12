import base64
import json
import os
from decimal import Decimal
from common.http import ConflictError

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

from .tenant import tenant_pk

_resource = None
RESERVED_KEYS = frozenset({"PK", "SK", "tenantId"})


def _dynamodb():
    global _resource
    if _resource is None:
        _resource = boto3.resource("dynamodb")
    return _resource


def get_table(table_name: str | None = None):
    name = table_name or os.environ.get("TABLE_NAME")
    if not name:
        raise RuntimeError("Falta la variable de entorno TABLE_NAME")
    return _dynamodb().Table(name)


def to_dynamo(value):
    """DynamoDB no acepta float: los convierte a Decimal (también dentro de dicts y listas)."""
    if isinstance(value, float):
        return Decimal(str(value))
    if isinstance(value, dict):
        return {k: to_dynamo(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [to_dynamo(v) for v in value]
    return value


def _is_conditional_failure(exc: ClientError) -> bool:
    return exc.response["Error"]["Code"] == "ConditionalCheckFailedException"


class TenantTable:
    """Una tabla vista desde un solo tenant. No hay forma de leer otra partición."""

    def __init__(self, tenant_id: str, table_name: str | None = None):
        self.tenant_id = tenant_id
        self.pk = tenant_pk(tenant_id)  # valida el tenant
        self.table = get_table(table_name)

    def _key(self, sk: str) -> dict:
        return {"PK": self.pk, "SK": sk}

    def put(self, sk: str, item: dict, *, if_not_exists: bool = False) -> dict:
        record = {**to_dynamo(item), **self._key(sk), "tenantId": self.tenant_id}
        kwargs = {"ConditionExpression": "attribute_not_exists(PK)"} if if_not_exists else {}
        try:
            self.table.put_item(Item=record, **kwargs)
        except ClientError as exc:
            if _is_conditional_failure(exc):
                raise ConflictError("Ya existe")
            raise
        return record

    def get(self, sk: str) -> dict | None:
        return self.table.get_item(Key=self._key(sk)).get("Item")

    def query(self, sk_prefix: str = "", *, limit: int | None = None, cursor: str | None = None):
        """Devuelve (items, next_cursor). next_cursor es None en la última página."""
        condition = Key("PK").eq(self.pk)
        if sk_prefix:
            condition &= Key("SK").begins_with(sk_prefix)
        kwargs = {"KeyConditionExpression": condition}
        if limit:
            kwargs["Limit"] = limit
        if cursor:
            kwargs["ExclusiveStartKey"] = self._decode_cursor(cursor)
        resp = self.table.query(**kwargs)
        last_key = resp.get("LastEvaluatedKey")
        return resp.get("Items", []), self._encode_cursor(last_key) if last_key else None

    def update(self, sk: str, changes: dict) -> dict | None:
        """Actualiza campos. Devuelve el ítem nuevo, o None si no existe."""
        if not changes:
            raise ValueError("No hay campos para actualizar")
        if RESERVED_KEYS & changes.keys():
            raise ValueError(f"No se pueden modificar {sorted(RESERVED_KEYS)}")
        fields = list(changes.items())
        try:
            resp = self.table.update_item(
                Key=self._key(sk),
                UpdateExpression="SET " + ", ".join(f"#f{i} = :v{i}" for i in range(len(fields))),
                ExpressionAttributeNames={f"#f{i}": k for i, (k, _) in enumerate(fields)},
                ExpressionAttributeValues={f":v{i}": to_dynamo(v) for i, (_, v) in enumerate(fields)},
                ConditionExpression="attribute_exists(PK)",
                ReturnValues="ALL_NEW",
            )
        except ClientError as exc:
            if _is_conditional_failure(exc):
                return None
            raise
        return resp["Attributes"]

    def delete(self, sk: str) -> None:
        self.table.delete_item(Key=self._key(sk))

    @staticmethod
    def _encode_cursor(last_key: dict) -> str:
        return base64.urlsafe_b64encode(json.dumps(last_key).encode()).decode()

    def _decode_cursor(self, cursor: str) -> dict:
        try:
            key = json.loads(base64.urlsafe_b64decode(cursor.encode()))
        except ValueError as exc:
            raise ValueError("Cursor de paginación inválido") from exc
        # Evita que un tenant use un cursor para saltar a la partición de otro.
        if not isinstance(key, dict) or key.get("PK") != self.pk:
            raise ValueError("Cursor de paginación inválido")
        return key