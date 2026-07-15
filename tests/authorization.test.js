const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../api/index');

const authorize = app.locals.getClientAuthorization;

function config(overrides = {}) {
  return {
    menu_enabled: true,
    maintenance_mode: false,
    auto_update_enabled: false,
    minimum_version: '1.0.0',
    announcement: '',
    ...overrides
  };
}

test('auto update is independent from the global client authorization switch', () => {
  const result = authorize(config({ auto_update_enabled: false }), '1.0.0');
  assert.equal(result.authorized, true);
  assert.equal(result.code, 'ok');
});

test('all clients switch and maintenance fail closed with stable codes', () => {
  assert.deepEqual(authorize(config({ menu_enabled: false }), '1.0.0'), {
    authorized: false,
    code: 'all_clients_disabled',
    message: 'Quyền truy cập của toàn bộ client đang bị khóa.'
  });
  assert.equal(authorize(config({ maintenance_mode: true }), '1.0.0').code, 'maintenance');
});

test('minimum version blocks outdated clients and preserves announcement', () => {
  const result = authorize(config({ minimum_version: '1.2.0', announcement: 'Update now.' }), '1.1.9');
  assert.equal(result.authorized, false);
  assert.equal(result.code, 'upgrade_required');
  assert.equal(result.message, 'Update now.');
});

test('missing or malformed client versions fail closed', () => {
  assert.equal(authorize(config(), '').code, 'invalid_version');
  assert.equal(authorize(config(), 'latest').authorized, false);
  assert.equal(authorize(config(), '1.0.0').authorized, true);
});
