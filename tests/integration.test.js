const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../api/index');

const buildManifest = app.locals.buildIntegrationManifest;
const validateInput = app.locals.validateIntegrationInput;
const buildSdkPackage = app.locals.buildSdkPackage;

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
  assert.equal(manifest.android.sdk_package_endpoint, '/api/admin/sdk-package');
  assert.equal(manifest.android.sdk_version, '2.0.0');
  assert.equal(manifest.android.java_entrypoint, 'com.serverkey.sdk.ServerKeyPlatform');
  assert.deepEqual(manifest.android.supported_abis, ['arm64-v8a', 'armeabi-v7a']);
  assert.equal(JSON.stringify(manifest).includes('github.com'), false);
});

test('integration input rejects unsafe project IDs and malformed versions', () => {
  assert.equal(validateInput('TKN_ABCDEFGHIJKL', 'client.vip-1', '1.2.3'), '');
  assert.match(validateInput('TKN_ABCDEFGHIJKL', '../bad project', '1.2.3'), /project_id/);
  assert.match(validateInput('TKN_ABCDEFGHIJKL', 'valid-project', 'latest'), /app_version/);
});

test('private SDK package contains complete sources and generated project configuration', () => {
  const manifest = buildManifest({
    baseUrl: 'https://server.example',
    productToken: 'TKN_ABCDEFGHIJKL',
    productName: 'VIP Client',
    projectId: 'client.vip-1',
    appVersion: '1.2.3'
  });
  const sdkPackage = buildSdkPackage(manifest);
  assert.equal(sdkPackage.filename, 'serverkey-client.vip-1-1.2.3.zip');
  assert.equal(sdkPackage.buffer.readUInt32LE(0), 0x04034b50);
  assert.ok(sdkPackage.fileCount >= 15);
  assert.ok(sdkPackage.buffer.includes(Buffer.from('GeneratedConnection.java')));
  assert.ok(sdkPackage.buffer.includes(Buffer.from('ServerKeyPlatform.java')));
  assert.ok(sdkPackage.buffer.includes(Buffer.from('lib/arm64-v8a/libserverkey_core.a')));
  assert.ok(sdkPackage.buffer.includes(Buffer.from('lib/armeabi-v7a/libserverkey_core.a')));
  assert.ok(sdkPackage.buffer.includes(Buffer.from('serverkey-prebuilt.mk')));
  assert.ok(sdkPackage.buffer.includes(Buffer.from('serverkey.cmake')));
  assert.equal(sdkPackage.buffer.includes(Buffer.from('ServerKeyRuntime.java')), false);
  assert.equal(sdkPackage.buffer.includes(Buffer.from('NativeBridge.cpp')), false);
  assert.ok(sdkPackage.buffer.includes(Buffer.from(manifest.connection_uri)));
  assert.equal(sdkPackage.buffer.includes(Buffer.from('ADMIN_PASSWORD')), false);
});
