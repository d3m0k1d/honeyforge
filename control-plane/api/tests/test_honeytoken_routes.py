from main import app


def test_honeytoken_routes_are_registered() -> None:
    paths = app.openapi()["paths"]

    assert set(paths["/honeytokens"]) == {"get", "post"}
    assert set(paths["/honeytokens/{honeytoken_id}"]) == {"get", "put", "delete"}


def test_honeytoken_list_does_not_expose_content() -> None:
    schemas = app.openapi()["components"]["schemas"]

    assert "content" not in schemas["HoneytokenRead"]["properties"]
    assert "content" in schemas["HoneytokenDetail"]["properties"]
