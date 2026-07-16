const test = require('node:test');
const assert = require('node:assert/strict');
const { createStoredZip, crc32 } = require('../api/zip');

test('stored ZIP writer produces valid headers, directory and known CRC-32', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  const archive = createStoredZip([
    { name: 'sdk/readme.txt', data: 'ServerKey' },
    { name: 'sdk/config.json', data: '{"ok":true}' }
  ], new Date('2026-01-02T03:04:06Z'));
  assert.equal(archive.readUInt32LE(0), 0x04034b50);
  assert.equal(archive.readUInt32LE(archive.length - 22), 0x06054b50);
  assert.equal(archive.readUInt16LE(archive.length - 12), 2);
  assert.ok(archive.includes(Buffer.from('sdk/readme.txt')));
  assert.ok(archive.includes(Buffer.from('ServerKey')));
});

test('stored ZIP writer rejects path traversal', () => {
  assert.throws(() => createStoredZip([{ name: '../secret.txt', data: 'no' }]), /Unsafe ZIP entry/);
  assert.throws(() => createStoredZip([{ name: '/root.txt', data: 'no' }]), /Unsafe ZIP entry/);
});
