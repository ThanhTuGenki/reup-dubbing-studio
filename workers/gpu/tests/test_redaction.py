from reup_worker.redaction import redact


def test_redacts_nested_secrets_and_signed_urls() -> None:
    assert redact({"authorization": "Bearer secret", "nested": {"signedUrl": "https://secret", "safe": 2}}) == {
        "authorization": "[REDACTED]",
        "nested": {"signedUrl": "[REDACTED]", "safe": 2},
    }
