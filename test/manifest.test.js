// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here. When the Gladys
// core is cloned next to this repository (~/code/Gladys), its own manifest
// validator is run too.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ACTIONS,
  BOUNDS,
  CONFIG,
  DEFAULTS,
  EVENT_NAME,
  SCENE_ACTIONS,
  SCENE_BUDGET,
  SCENE_TRIGGERS,
  USER_AGENT,
  VERSION,
  WEBHOOKS,
  ZAPS,
} from '../src/constants.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const index = read('index.js');
const field = (key) => manifest.config_schema.find((f) => f.key === key);

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, item] of node.entries()) yield* texts(item, `${path}[${i}]`);
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) yield* texts(value, `${path}.${key}`);
  }
}

function* objects(node) {
  if (Array.isArray(node)) {
    for (const item of node) yield* objects(item);
  } else if (node && typeof node === 'object') {
    yield node;
    for (const value of Object.values(node)) yield* objects(value);
  }
}

test('the store basics: a provider, worldwide, Gladys 5.1', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'provider', 'scene actions, a trigger, a button: no device');
  assert.equal(manifest.gladys_version, '>=5.1.0');
  assert.deepEqual(manifest.categories, ['services', 'notifications']);
  assert.deepEqual(manifest.transports, ['cloud']);
  assert.equal(manifest.countries, undefined, 'worldwide');
  assert.equal(manifest.name, 'Zapier');
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    assert.ok(read(`docs/${lang}.md`).length >= 300, `docs/${lang}.md is too short for the store`);
  }
  assert.match(manifest.description.en, /^Unofficial/);
  assert.match(manifest.description.fr, /^Non officiel/);
  assert.match(read('docs/en.md'), /never\s+been\s+tested\s+with\s+a\s+real\s+Zapier\s+account/i);
  assert.match(read('docs/fr.md'), /jamais\s+été\s+testée\s+avec\s+un\s+vrai\s+compte\s+Zapier/i);
  assert.equal(manifest.keywords, undefined);
  assert.equal(manifest.widgets, undefined);
  assert.equal(manifest.location, undefined);
});

test('one version everywhere, semver, never pinned', () => {
  const semver = /^\d+\.\d+\.\d+$/;
  assert.match(pkg.version, semver);
  assert.equal(manifest.version, pkg.version);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.equal(VERSION, pkg.version, 'the User-Agent version');
  assert.ok(USER_AGENT.startsWith(`gladys-zapier/${pkg.version} `));
  assert.equal(manifest.docker_image, `ghcr.io/lm1lc3n7/gladys-zapier:${pkg.version}`);
  assert.match(manifest.gladys_version, /^>=\d+\.\d+\.\d+$/, 'a range, never one version');
  assert.equal(pkg.scripts.test, 'node --test --test-timeout=60000');
  assert.equal(pkg.dependencies['@gladysassistant/integration-sdk'], '^0.16.0');
  assert.deepEqual(Object.keys(pkg.dependencies), ['@gladysassistant/integration-sdk']);
});

test('every text is bilingual, and the words the rules forbid are absent', () => {
  for (const [path, text] of texts(manifest)) {
    assert.ok(text.en?.trim() && text.fr?.trim(), `${path} needs en and fr`);
  }
  const all = [
    'gladys-assistant-integration.json',
    'README.md',
    'docs/en.md',
    'docs/fr.md',
    'src/i18n.js',
    'CHANGELOG.md',
    'TODO.md',
  ]
    .map(read)
    .join('\n');
  assert.doesNotMatch(all, /chiffr(?:é|em|er|ag|an)|encrypt/i);
  assert.match('Stockée chiffrée', /chiffr(?:é|em|er|ag|an)/i);
  assert.doesNotMatch('lettres, chiffres', /chiffr(?:é|em|er|ag|an)/i);
});

test('the configuration matches the code: keys, defaults, bounds, the secrets', () => {
  for (const f of manifest.config_schema) {
    assert.doesNotMatch(f.key, /^gladys_/i);
    if (f.type === 'section') {
      assert.equal(f.default, undefined);
      for (const text of Object.values(f.description)) assert.ok(text.length <= 1000, f.key);
    }
    for (const link of f.links ?? []) assert.match(link.url, /^https:\/\//);
  }
  const keys = manifest.config_schema.filter((f) => f.type !== 'section').map((f) => f.key);
  assert.deepEqual(
    keys.sort(),
    [...CONFIG.HOOKS, CONFIG.MAX_PER_DAY, CONFIG.MAX_PER_MONTH, CONFIG.INBOUND_SECRET].sort(),
  );
  for (const key of [...CONFIG.HOOKS, CONFIG.INBOUND_SECRET]) {
    const secret = field(key);
    assert.equal(secret.type, 'secret', key);
    assert.equal(secret.default, undefined, 'never a default secret');
    assert.equal(secret.required, false, `${key}: receive only is possible`);
    assert.match(
      secret.description.en,
      /^Kept by Gladys in its database, never shown again, (sent only to hooks\.zapier\.com|never sent)/,
    );
    assert.match(
      secret.description.fr,
      /^Gardée? par Gladys dans sa base, jamais réaffichée?, (envoyée seulement à hooks\.zapier\.com|jamais envoyé)/,
    );
  }
  for (const [key, value] of Object.entries(DEFAULTS)) assert.equal(field(key).default, value, key);
  for (const [key, [min, max]] of Object.entries(BOUNDS)) {
    assert.equal(field(key).type, 'number');
    assert.equal(field(key).min, min, key);
    assert.equal(field(key).max, max, key);
    for (const lang of ['en', 'fr'])
      assert.ok(field(key).description[lang].includes(`${max}`), key);
  }
});

test('the button, the scene actions, the trigger and the webhook match the handlers', () => {
  assert.deepEqual(
    manifest.actions.map((a) => a.key),
    Object.values(ACTIONS),
  );
  assert.ok(index.includes('onAction(ACTIONS.TEST'));
  for (const action of manifest.actions) {
    assert.ok(action.timeout_seconds >= 5 && action.timeout_seconds <= 120);
  }
  assert.deepEqual(
    manifest.scene_actions.map((a) => a.key),
    Object.values(SCENE_ACTIONS),
  );
  assert.ok(index.includes('onSceneAction(SCENE_ACTIONS.SEND,'));
  assert.ok(index.includes('onSceneAction(SCENE_ACTIONS.SEND_JSON,'));
  for (const scene of manifest.scene_actions) {
    assert.ok(
      scene.timeout_seconds * 1000 >= SCENE_BUDGET + 15_000 + 2000,
      'the budget ends before Gladys gives up, its 15 s wait for the connection included',
    );
    const zap = scene.fields.find((f) => f.key === 'zap');
    assert.deepEqual(
      zap.options.map((o) => o.value),
      ZAPS,
    );
    assert.equal(zap.default, '1');
    assert.deepEqual(
      scene.outputs.map((o) => [o.key, o.type]),
      [
        ['request_id', 'string'],
        ['zap_runs', 'number'],
      ],
    );
    for (const f of scene.fields) assert.notEqual(f.type, 'secret');
    for (const f of scene.fields.filter((x) => x.required)) {
      assert.ok(['zap', 'event', 'payload'].includes(f.key), f.key);
    }
  }
  assert.ok(EVENT_NAME.test(manifest.scene_actions[0].fields[1].placeholder.en));
  assert.deepEqual(
    manifest.webhooks.map((w) => [w.key, w.mode]),
    [[WEBHOOKS.INBOUND, 'fire_and_forget']],
  );
  assert.ok(index.includes('onWebhook(WEBHOOKS.INBOUND'));
  assert.ok(index.includes('onWebhookUpdated('));
  const [trigger] = manifest.scene_triggers;
  assert.equal(trigger.key, SCENE_TRIGGERS.RECEIVED);
  const data = ['event', 'value1', 'value2', 'value3', 'payload'];
  assert.deepEqual(
    trigger.variables.map((v) => v.key),
    data,
  );
  for (const f of trigger.fields) assert.ok(data.includes(f.key));
});

test('every select option follows the core rules (label, value, unique)', () => {
  for (const node of objects(manifest)) {
    if (node.type !== 'select' || !Array.isArray(node.options)) continue;
    const values = node.options.map((o) => o.value);
    assert.equal(new Set(values).size, values.length);
    for (const option of node.options) {
      assert.ok(typeof option.value === 'string' || Number.isInteger(option.value));
      for (const lang of ['en', 'fr']) {
        const label = option.label[lang];
        assert.equal(typeof label, 'string');
        assert.ok(label.length > 0 && label === label.trim());
      }
      assert.deepEqual(Object.keys(option).sort(), ['label', 'value']);
    }
  }
  assert.equal(JSON.stringify(manifest).includes('supported_options'), false, 'no device feature');
});

test('the licence and the notices ship in the image; LICENSE names nobody', () => {
  const dockerfile = read('Dockerfile');
  assert.match(dockerfile, /COPY LICENSE THIRD_PARTY_NOTICES\.md/);
  assert.doesNotMatch(read('LICENSE'), /Copyright \d{4} [A-Z]/, 'no personal name');
  for (const file of ['README.md', 'docs/en.md', 'docs/fr.md', 'THIRD_PARTY_NOTICES.md']) {
    assert.match(read(file), /hooks\.zapier\.com/, file);
  }
});

const core = join(homedir(), 'code/Gladys/server/lib/external-integration');
test(
  'the Gladys core validator accepts the manifest',
  { skip: !existsSync(core) && 'Gladys core not cloned' },
  async (t) => {
    // In a child process and a temporary directory: requiring the core opens
    // its database files in the working directory.
    const dir = await mkdtemp(join(tmpdir(), 'zapier-core-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const script = `
      const mod = require(${JSON.stringify(join(core, 'externalIntegration.validateManifest.js'))});
      const validate = mod.validateManifest ?? mod;
      try { validate(${JSON.stringify(manifest)}); process.exit(0); }
      catch (err) { console.log('INVALID', err.message, JSON.stringify(err.properties ?? err.errors ?? '')); process.exit(3); }
    `;
    const result = spawnSync(process.execPath, ['-e', script], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.equal(
      result.status,
      0,
      result.stdout
        .split('\n')
        .filter((l) => /INVALID/.test(l))
        .join('\n'),
    );
  },
);
