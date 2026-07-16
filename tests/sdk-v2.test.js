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

test('SDK V2.1.1 release archives match the exported checksum manifest', () => {
  const checksumLines = fs.readFileSync(path.join(sdkRoot, 'SHA256SUMS'), 'utf8')
    .trim().split(/\r?\n/);
  assert.equal(checksumLines.length, 2);
  const checksums = Object.fromEntries(checksumLines.map(line => {
    const match = line.match(/^([a-f0-9]{64})  (jni\/ServerKey\/lib\/(?:arm64-v8a|armeabi-v7a)\/libserverkey_core\.a)$/);
    assert.ok(match, `Invalid SDK checksum line: ${line}`);
    return [match[2], match[1]];
  }));
  for (const relativePath of Object.keys(checksums)) {
    assert.equal(sha256(relativePath), checksums[relativePath]);
  }
});

test('SDK V2 ships both native build-system adapters', () => {
  const ndkBuild = fs.readFileSync(
    path.join(sdkRoot, 'jni/ServerKey/serverkey-prebuilt.mk'), 'utf8');
  const cmake = fs.readFileSync(
    path.join(sdkRoot, 'jni/ServerKey/serverkey.cmake'), 'utf8');
  assert.match(ndkBuild, /PREBUILT_STATIC_LIBRARY/);
  assert.match(ndkBuild, /libserverkey_core\.a/);
  assert.doesNotMatch(cmake, /--whole-archive/);
  assert.match(cmake, /NativeBridge_nativeInitialize/);
  assert.match(cmake, /function\(serverkey_link target_name\)/);
});

test('SDK V2.1.1 keeps lock and notification UI behind one stable API', () => {
  const uiHeader = fs.readFileSync(
    path.join(sdkRoot, 'jni/ServerKey/include/serverkey_ui.h'), 'utf8');
  const cppHeader = fs.readFileSync(
    path.join(sdkRoot, 'jni/ServerKey/include/serverkey_imgui.hpp'), 'utf8');
  assert.match(uiHeader, /ServerKeyUi_Draw/);
  assert.match(uiHeader, /SERVERKEY_UI_SURFACE_LOCK_PANEL/);
  assert.match(uiHeader, /SERVERKEY_UI_SURFACE_NOTIFICATION_OVERLAY/);
  assert.match(cppHeader, /UiResult DrawUi/);
  assert.match(cppHeader, /HasUnreadNotification/);
  for (const abi of ['arm64-v8a', 'armeabi-v7a']) {
    const archive = fs.readFileSync(path.join(
      sdkRoot, `jni/ServerKey/lib/${abi}/libserverkey_core.a`));
    assert.ok(archive.includes(Buffer.from('serverkey_ui.o')));
    assert.ok(archive.includes(Buffer.from('ServerKeyUi_Draw')));
    assert.equal(archive.includes(Buffer.from('/mnt/sdcard/')), false);
    assert.equal(archive.includes(Buffer.from('ImGuiTemPlate')), false);
  }
});
