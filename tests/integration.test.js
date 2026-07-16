const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../api/index');

const buildManifest = app.locals.buildIntegrationManifest;
const validateInput = app.locals.validateIntegrationInput;

test('integration manifest creates a portable versioned ServerKey connection URI', () => {
  const manifest = buildManifest({
    baseUrl: 'https://server.example/',
    productToken: 'TKN_ABCDEFGHIJKL',
    productName: 'VIP Client',
    projectId: 'client.vip-1',
    appVersion: '1.2.3'
  });
  const uri = new URL(manifest.connection_uri);
  assert.equal(uri.protocol, 'serverkey:');
  assert.equal(uri.host, 'connect');
  assert.equal(uri.searchParams.get('base_url'), 'https://server.example');
  assert.equal(uri.searchParams.get('product_token'), 'TKN_ABCDEFGHIJKL');
  assert.equal(uri.searchParams.get('project_id'), 'client.vip-1');
  assert.equal(uri.searchParams.get('protocol'), '1');
  assert.equal(manifest.project.app_version, '1.2.3');
  assert.equal(Object.hasOwn(manifest, 'admin_password'), false);
});

test('integration input rejects unsafe project IDs and malformed versions', () => {
  assert.equal(validateInput('TKN_ABCDEFGHIJKL', 'client.vip-1', '1.2.3'), '');
  assert.match(validateInput('TKN_ABCDEFGHIJKL', '../bad project', '1.2.3'), /project_id/);
  assert.match(validateInput('TKN_ABCDEFGHIJKL', 'valid-project', 'latest'), /app_version/);
});
