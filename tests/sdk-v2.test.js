const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const sdkRoot = path.join(__dirname, '..', 'client-sdk', 'android');

function sha256(relativePath) {
  return crypto.createHash('sha256')
    .update(fs.readFileSync(path.join(sdkRoot, relativePath)))
    .digest('hex');
}

test('SDK V2 keeps one Android implementation file and no legacy host sources', () => {
  const javaRoot = path.join(sdkRoot, 'java', 'com', 'serverkey', 'sdk');
  assert.deepEqual(fs.readdirSync(javaRoot).filter(name => name.endsWith('.java')).sort(), [
    'ServerKeyPlatform.java'
  ]);
  for (const legacyPath of [
    'jni/ServerKey/NativeBridge.cpp',
    'jni/ServerKey/RemotePolicy.cpp',
    'jni/ServerKey/RemotePolicy.h'
  ]) {
    assert.equal(fs.existsSync(path.join(sdkRoot, legacyPath)), false);
  }
});

test('SDK V2 release archives match their locked checksums', () => {
  assert.equal(
    sha256('jni/ServerKey/lib/arm64-v8a/libserverkey_core.a'),
    '0a8e0196ba2eb7bacab71d2e76cbab1a2e27c053ecac751324ed0a2197ae7545'
  );
  assert.equal(
    sha256('jni/ServerKey/lib/armeabi-v7a/libserverkey_core.a'),
    '4ed89cca05f4e65491cbda79a2e6bfe1aaa9922a2f8499fccaf21e57775ca68c'
  );
});

test('SDK V2 ships both native build-system adapters', () => {
  const ndkBuild = fs.readFileSync(
    path.join(sdkRoot, 'jni/ServerKey/serverkey-prebuilt.mk'), 'utf8');
  const cmake = fs.readFileSync(
    path.join(sdkRoot, 'jni/ServerKey/serverkey.cmake'), 'utf8');
  assert.match(ndkBuild, /PREBUILT_STATIC_LIBRARY/);
  assert.match(ndkBuild, /libserverkey_core\.a/);
  assert.match(cmake, /--whole-archive/);
  assert.match(cmake, /function\(serverkey_link target_name\)/);
});
