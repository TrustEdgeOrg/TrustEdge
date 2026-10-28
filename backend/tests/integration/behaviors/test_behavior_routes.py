def test_observe_and_list_behaviors(api_client, ingest_env):
    observe = api_client.post(
        "/internal/behaviors/observe",
        json={
            "device_id": "dev_api",
            "behavior_kind": "process_chain",
            "behavior_key": "zsh>curl",
            "alert_type": "shell_spawns_downloader",
            "meta": {"parent_comm": "zsh", "child_comm": "curl"},
        },
    )
    assert observe.status_code == 200
    body = observe.json()
    assert body["count"] == 1
    assert body["action"] == "emit"
    assert body["suppress"] is False
    assert body["established"] is False
    assert "profile_warm" in body

    listed = api_client.get("/behaviors", params={"device_id": "dev_api"})
    assert listed.status_code == 200
    payload = listed.json()
    assert payload["total"] == 1
    assert payload["items"][0]["behavior_key"] == "zsh>curl"

    internal = api_client.get("/internal/behaviors", params={"device_id": "dev_api"})
    assert internal.status_code == 200
    assert internal.json()["total"] == 1

    cleared = api_client.delete("/internal/behaviors/dev_api")
    assert cleared.status_code == 200
    assert cleared.json()["cleared"] == 1
    empty = api_client.get("/internal/behaviors", params={"device_id": "dev_api"})
    assert empty.json()["total"] == 0
