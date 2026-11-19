# Third-party notices

This integration is licensed under the Apache License 2.0 (see `LICENSE`). Its code is its own:
no third-party code is copied or ported. Parts of it (the `/data` store, the bounded HTTP request,
the test clocks) come from other integrations of the same author, under the same licence.

## Zapier ("Webhooks by Zapier")

At run time the integration posts JSON to the Catch Hook URLs the user copies from their own Zaps
(`https://hooks.zapier.com/hooks/catch/…/…/`). The URL form, the commas joining several Zaps and
the task counting come from the public Zapier help ("Trigger Zaps from webhooks", read on
2026-11-15); nothing of it is shipped in this repository nor in the Docker image. Using Zapier is
subject to the terms of the user's account. "Zapier" is a name of its owner, used here only to say
which service is called.

## Gladys Plus

Events from Zapier arrive through the webhook relay of Gladys Plus, provided by the Gladys core and
the SDK (`@gladysassistant/integration-sdk`, Apache-2.0).
