def test_client_config_route(api_client, seed_policy, enroll_env, monkeypatch):
    monkeypatch.setattr("app.shared.config.settings.ENROLL_BOOTSTRAP_TOKEN", "bootstrap-secret")
    monkeypatch.setattr("app.shared.config.settings.CLIENT_STATS_INTERVAL_SEC", 10.0)
    monkeypatch.setattr("app.shared.config.settings.CLIENT_INSTALL_POLICY_CA_DEFAULT", True)
    monkeypatch.setattr("app.shared.config.settings.CLIENT_SERVICE_NAME", "My TrustEdge")

    response = api_client.get("/v1/client-config")
    assert response.status_code == 200
    body = response.json()
    assert body["enroll_bootstrap_token"] == "bootstrap-secret"
    assert body["enroll_path"] == "/v1/enroll"
    assert body["usage_path"] == "/v1/usage"
    assert body["policy_ca_path"] == "/policy/block-page-ca"
    assert body["stats_interval_sec"] == 10.0
    assert body["install_policy_ca_default"] is True
    assert body["service_name"] == "My TrustEdge"
    assert "teen" in body["policy_profile_slugs"]
