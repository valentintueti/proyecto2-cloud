import json

from src.handlers import notifications


def body(resp):
    return json.loads(resp["body"])


def _mine(api_event, **kwargs):
    return notifications.my_notifications(api_event(**kwargs), None)


def test_my_notifications_mas_recientes_primero_y_paginacion(api_event, notify):
    for hour in ("10", "12", "11"):
        notify(occurred_at=f"2026-11-20T{hour}:00:00+00:00")

    first = _mine(api_event, query={"limit": "2"})
    assert first["statusCode"] == 200
    page1 = body(first)
    assert [i["createdAt"] for i in page1["items"]] == ["2026-11-20T12:00:00Z", "2026-11-20T11:00:00Z"]
    assert "PK" not in page1["items"][0] and "SK" not in page1["items"][0]
    assert page1["nextCursor"]

    page2 = body(_mine(api_event, query={"limit": "2", "cursor": page1["nextCursor"]}))
    assert [i["createdAt"] for i in page2["items"]] == ["2026-11-20T10:00:00Z"]
    assert page2["nextCursor"] is None


def test_cursor_de_otro_usuario_o_tenant_es_invalido(api_event, notify):
    notify(occurred_at="2026-11-20T10:00:00+00:00")
    notify(occurred_at="2026-11-20T11:00:00+00:00")
    cursor = body(_mine(api_event, query={"limit": "1"}))["nextCursor"]

    assert _mine(api_event, user_id="luis@acme.com", query={"cursor": cursor})["statusCode"] == 400
    assert _mine(api_event, tenant_id="globex", query={"cursor": cursor})["statusCode"] == 400
    assert _mine(api_event, query={"cursor": "basura!!"})["statusCode"] == 400


def test_no_leidas_contador_y_mark_read(api_event, notify):
    notify(occurred_at="2026-11-20T10:00:00+00:00")
    notify(occurred_at="2026-11-20T11:00:00+00:00")

    assert body(notifications.unread_count(api_event(), None)) == {"unread": 2}
    newest = body(_mine(api_event))["items"][0]

    resp = notifications.mark_read(api_event(path={"notificationId": newest["notificationId"]}), None)
    assert resp["statusCode"] == 200
    assert body(resp)["read"] is True and body(resp)["readAt"]

    assert body(notifications.unread_count(api_event(), None)) == {"unread": 1}
    unread = body(_mine(api_event, query={"unread": "true"}))["items"]
    assert [i["createdAt"] for i in unread] == ["2026-11-20T10:00:00Z"]

    # Marcar dos veces es idempotente
    again = notifications.mark_read(api_event(path={"notificationId": newest["notificationId"]}), None)
    assert again["statusCode"] == 200


def test_validaciones_de_parametros(api_event):
    assert _mine(api_event, query={"unread": "quizas"})["statusCode"] == 400
    bad_id = notifications.mark_read(api_event(path={"notificationId": "no-es-uuid"}), None)
    assert bad_id["statusCode"] == 400


def test_solo_el_dueno_ve_y_marca_sus_notificaciones(api_event, notify):
    notify("ana@acme.com")
    notify("ana@acme.com", tenant_id="globex")  # mismo email en otro tenant
    ana_id = body(_mine(api_event))["items"][0]["notificationId"]

    # Otro usuario del mismo tenant
    assert body(_mine(api_event, user_id="luis@acme.com"))["items"] == []
    other_user = notifications.mark_read(
        api_event(user_id="luis@acme.com", role="ADMIN_RRHH", path={"notificationId": ana_id}), None,
    )
    assert other_user["statusCode"] == 404

    # Mismo email, otro tenant: su notificación de acme no existe allí
    other_tenant = notifications.mark_read(
        api_event(tenant_id="globex", path={"notificationId": ana_id}), None,
    )
    assert other_tenant["statusCode"] == 404

    assert body(notifications.unread_count(api_event(), None)) == {"unread": 1}
    assert body(notifications.unread_count(api_event(tenant_id="globex"), None)) == {"unread": 1}


def test_mark_all_read_solo_afecta_al_dueno(api_event, notify):
    notify("ana@acme.com", occurred_at="2026-11-20T10:00:00+00:00")
    notify("ana@acme.com", occurred_at="2026-11-20T11:00:00+00:00")
    notify("luis@acme.com")
    notify("ana@acme.com", tenant_id="globex")

    resp = notifications.mark_all_read(api_event(), None)
    assert resp["statusCode"] == 200
    assert body(resp) == {"updated": 2}

    assert body(notifications.unread_count(api_event(), None)) == {"unread": 0}
    assert body(notifications.unread_count(api_event(user_id="luis@acme.com"), None)) == {"unread": 1}
    assert body(notifications.unread_count(api_event(tenant_id="globex"), None)) == {"unread": 1}
    assert body(notifications.mark_all_read(api_event(), None)) == {"updated": 0}
