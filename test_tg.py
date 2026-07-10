"""
Тесты для прокси-сервера Telegram Bot API (tg.py).

Исходящие HTTP-запросы приложения (к api.telegram.org и к n8n) перехватываются
библиотекой respx, поэтому реальная сеть не используется. Входящие запросы к
приложению выполняются через starlette TestClient (ASGITransport), который respx
не перехватывает.
"""
import httpx
import pytest
import respx
from starlette.testclient import TestClient

import tg


@pytest.fixture
def client():
    with TestClient(tg.app) as c:
        yield c


# ------------------------------------------------------------------
# Health check
# ------------------------------------------------------------------
def test_health_check(client):
    resp = client.get("/")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert data["message"] == "Telegram proxy is running"
    assert data["n8n"] == tg.N8N_TARGET
    # Поле proxy зависит от окружения:
    #   - если прокси не сконфигурирован -> "direct"
    #   - если сконфигурирован -> URL с замаскированным паролем
    if tg.proxy_url is None:
        assert data["proxy"] == "direct"
    else:
        assert data["proxy"] != "direct"
        assert ":****@" in data["proxy"]
        # Пароль замаскирован: пара "user:pass@" не должна присутствовать в ответе
        if tg.PROXY_USER and tg.PROXY_PASS:
            assert f"{tg.PROXY_USER}:{tg.PROXY_PASS}@" not in data["proxy"]


# ------------------------------------------------------------------
# Проксирование в Telegram
# ------------------------------------------------------------------
@respx.mock
def test_proxy_to_telegram_get(client):
    token = "123456:ABC-DEF"
    route = respx.get(
        f"https://api.telegram.org/bot{token}/sendMessage"
    ).mock(
        return_value=httpx.Response(
            200,
            json={"ok": True, "result": {"message_id": 1}},
        )
    )

    resp = client.get(f"/bot{token}/sendMessage?chat_id=42&text=hi")

    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "result": {"message_id": 1}}
    assert route.called
    sent = route.calls.last.request
    # Query-параметры проброшены
    assert sent.url.params.get("chat_id") == "42"
    assert sent.url.params.get("text") == "hi"
    # Host переписан на api.telegram.org
    assert sent.headers["host"] == "api.telegram.org"


@respx.mock
def test_proxy_to_telegram_post_body(client):
    token = "999:XYZ"
    route = respx.post(
        f"https://api.telegram.org/bot{token}/sendMessage"
    ).mock(return_value=httpx.Response(200, json={"ok": True}))

    payload = {"chat_id": 42, "text": "hello"}
    resp = client.post(f"/bot{token}/sendMessage", json=payload)

    assert resp.status_code == 200
    assert resp.json() == {"ok": True}
    assert route.called
    # Тело проброшено без изменений
    import json as _json
    assert _json.loads(route.calls.last.request.content) == payload


@respx.mock
def test_proxy_to_telegram_propagates_error_status(client):
    token = "111:BAD"
    respx.get(
        f"https://api.telegram.org/bot{token}/sendMessage"
    ).mock(
        return_value=httpx.Response(
            401, json={"ok": False, "error_code": 401}
        )
    )

    resp = client.get(f"/bot{token}/sendMessage")
    # Статус Telegram проксируется как есть
    assert resp.status_code == 401
    assert resp.json()["error_code"] == 401


def test_proxy_to_telegram_missing_method_returns_404(client):
    # Нет "/" после токена -> метод не указан
    resp = client.get("/bot123456")
    assert resp.status_code == 404
    assert resp.json() == {"error": "Not found"}


@respx.mock
def test_proxy_to_telegram_upstream_exception_returns_500(client):
    token = "222:ERR"
    respx.get(
        f"https://api.telegram.org/bot{token}/getMe"
    ).mock(side_effect=httpx.ConnectError("boom"))

    resp = client.get(f"/bot{token}/getMe")
    assert resp.status_code == 500
    assert "error" in resp.json()


# ------------------------------------------------------------------
# Проксирование вебхуков в n8n
# ------------------------------------------------------------------
@respx.mock
def test_forward_webhook_to_n8n(client):
    path = "/webhook/uuid-1/webhook"
    route = respx.post(f"{tg.N8N_TARGET}{path}").mock(
        return_value=httpx.Response(200, json={"received": True})
    )

    payload = {"update_id": 1, "message": {"text": "hi"}}
    resp = client.post(path, json=payload)

    assert resp.status_code == 200
    assert resp.json() == {"received": True}
    assert route.called
    sent = route.calls.last.request
    assert sent.headers["host"] == tg.N8N_HOST
    import json as _json
    assert _json.loads(sent.content) == payload


@respx.mock
def test_forward_webhook_test_to_n8n(client):
    path = "/webhook-test/uuid-2/webhook"
    route = respx.post(f"{tg.N8N_TARGET}{path}").mock(
        return_value=httpx.Response(201, json={"ok": True})
    )

    resp = client.post(path, json={"a": 1})
    assert resp.status_code == 201
    assert route.called


@respx.mock
def test_forward_to_n8n_upstream_exception_returns_502(client):
    path = "/webhook/uuid-err/webhook"
    respx.post(f"{tg.N8N_TARGET}{path}").mock(
        side_effect=httpx.ConnectError("down")
    )

    resp = client.post(path, json={"a": 1})
    assert resp.status_code == 502
    body = resp.json()
    assert body["error"] == "Bad gateway to n8n"
    assert "detail" in body


# ------------------------------------------------------------------
# Прочие пути -> 404
# ------------------------------------------------------------------
def test_unknown_path_returns_404(client):
    resp = client.get("/some/random/path")
    assert resp.status_code == 404
    assert resp.json() == {"error": "Not found"}


# ------------------------------------------------------------------
# Хелпер clean_headers
# ------------------------------------------------------------------
def test_clean_headers_removes_hop_by_hop():
    headers = {
        "Host": "example.com",
        "Connection": "keep-alive",
        "Content-Length": "10",
        "X-Custom": "value",
        "Authorization": "Bearer x",
    }
    cleaned = tg.clean_headers(headers)
    assert "Host" not in cleaned
    assert "Connection" not in cleaned
    assert "Content-Length" not in cleaned
    assert cleaned["X-Custom"] == "value"
    assert cleaned["Authorization"] == "Bearer x"
