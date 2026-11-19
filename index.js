// -----------------------------------------------------------------------------
// Entry point: SDK wiring only. Every handler is registered BEFORE connect(),
// and delegates to the App (src/app.js). Zapier is called only by the two
// scene actions and the "Send a test event" button; an event received from
// Zapier (Gladys Plus webhook) only fires the scene trigger.
//
// Environment variables provided by the Gladys supervisor, read by the SDK:
// GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN, GLADYS_INTEGRATION_SELECTOR.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { App } from './src/app.js';
import { ACTIONS, SCENE_ACTIONS, WEBHOOKS } from './src/constants.js';
import { createFileStore } from './src/store.js';

const gladys = new GladysIntegration();
const app = new App({ gladys, logger, store: createFileStore() });

gladys.onSceneAction(SCENE_ACTIONS.SEND, (fields) => app.sceneSend(fields, false));
gladys.onSceneAction(SCENE_ACTIONS.SEND_JSON, (fields) => app.sceneSend(fields, true));
gladys.onAction(ACTIONS.TEST, (fields) => app.sendTest(fields));
gladys.onWebhook(WEBHOOKS.INBOUND, (request) => app.handleInbound(request));
gladys.onWebhookUpdated(async (info) => app.applyWebhooks(info));
gladys.onConfigUpdated(async (config) => app.configUpdated(config));

// A disconnection stops nothing: no scene action can arrive meanwhile, and a
// send in flight finishes and is counted.
gladys.on('connected', () => {
  app.connected().catch((err) => logger.error('Start failed', err?.message ?? err));
});
gladys.handleShutdown(() => app.stop());

logger.info('Starting the Zapier integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err?.message ?? err);
  process.exit(1);
});
