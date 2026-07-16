const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const appScript = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');

function jsonResponse(status, data) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return JSON.stringify(data); }
  };
}

function successfulResponses() {
  return {
    '/api/health': jsonResponse(200, {
      status: 'ok', schema_ready: true, database_configured: true, version: '4.5.0',
      message: 'ServerKey control plane is operational.'
    }),
    '/api/admin/get-keys': jsonResponse(200, {
      success: true,
      keys: [{
        id: 1, key_string: 'VIP-LICENSE-1', token_name: 'VIP Business', duration_days: 30,
        expires_at: null, device_count: 1, max_devices: 2, status: 'activated', note: 'Customer A'
      }]
    }),
    '/api/admin/get-fraud': jsonResponse(200, { success: true, logs: [] }),
    '/api/admin/stats': jsonResponse(200, {
      success: true,
      stats: { total: 1, unactivated: 0, activated: 1, expired: 0, banned: 0, fraudAlerts: 0, totalTokens: 1, devices: 1, activeSessions: 1 }
    }),
    '/api/admin/get-tokens': jsonResponse(200, {
      success: true,
      tokens: [{ id: 1, token_name: 'VIP Business', token_string: 'TKN_TEST', max_days: 30, display_text: 'VIP', description: 'Business plan' }]
    }),
    '/api/admin/control-config': jsonResponse(200, {
      success: true,
      config: {
        id: 1, menu_enabled: true, maintenance_mode: false, auto_update_enabled: false,
        minimum_version: '1.0.0', latest_version: '1.1.0', update_url: null,
        heartbeat_interval_seconds: 45, announcement: null, config_revision: 7,
        updated_at: '2026-07-15T10:00:00.000Z'
      },
      features: {
        menu_vip_core: { enabled: true, locked: false, display_name: 'VIP Core', description: '', sort_order: 10 }
      }
    }),
    '/api/admin/devices': jsonResponse(200, {
      success: true,
      devices: [{
        id: 9, hwid: 'HWID_TEST_DEVICE', app_version: '1.0.0', active_sessions: 1,
        status: 'active', last_seen_at: '2026-07-15T10:00:00.000Z', ban_reason: null,
        licenses: [{ key_string: 'VIP-LICENSE-1' }]
      }]
    }),
    '/api/admin/sessions': jsonResponse(200, {
      success: true,
      sessions: [{
        id: 4, status: 'active', last_seen_at: '2026-07-15T10:00:00.000Z',
        expires_at: '2026-07-16T10:00:00.000Z',
        device: { hwid: 'HWID_TEST_DEVICE', app_version: '1.0.0' },
        license: { key_string: 'VIP-LICENSE-1' }
      }]
    })
  };
}

async function bootDashboard(responses, { authenticated = true } = {}) {
  const dom = new JSDOM(html, {
    url: 'https://dashboard.test/',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const { window } = dom;
  if (authenticated) window.localStorage.setItem('admin_token', 'ADM_TEST_SESSION');
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.requestAnimationFrame = callback => window.setTimeout(() => callback(window.performance.now() + 1000), 0);
  window.fetch = async (url) => {
    const pathname = new URL(url, window.location.href).pathname;
    const response = responses[pathname];
    if (!response) throw new Error(`Unexpected request: ${pathname}`);
    return response;
  };
  window.navigator.clipboard = { writeText: async () => {} };
  window.eval(appScript);
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  await new Promise(resolve => window.setTimeout(resolve, 120));
  return dom;
}

test('online dashboard renders real data and switches workspaces', async () => {
  const responses = successfulResponses();
  const dom = await bootDashboard(responses);
  const { document } = dom.window;

  assert.equal(document.querySelector('#dashboard-container').classList.contains('hidden'), false);
  assert.equal(document.querySelector('#api-status-text').textContent, 'Hệ thống online');
  assert.equal(document.querySelector('#system-banner').classList.contains('hidden'), true);
  assert.equal(document.querySelector('#overview-status-title').textContent, 'Hệ thống đang vận hành ổn định');
  assert.equal(document.querySelector('#overview-revision').textContent, 'Config revision 7');
  assert.equal(document.querySelector('#nav-license-count').textContent, '1');

  document.querySelector('[data-view="devices"]').click();
  assert.equal(document.querySelector('[data-view-section="overview"]').classList.contains('view-hidden'), true);
  const deviceSection = document.querySelector('[data-view-section="devices"]');
  assert.equal(deviceSection.classList.contains('view-hidden'), false);
  assert.equal(deviceSection.querySelector('td[data-label="Device ID"]').textContent.trim(), 'HWID_TEST_DEVICE');

  responses['/api/admin/control-config'] = jsonResponse(500, {
    success: false,
    message: 'Remote policy API is temporarily unavailable.'
  });
  document.querySelector('#refresh-btn').click();
  await new Promise(resolve => dom.window.setTimeout(resolve, 120));
  assert.equal(document.querySelector('#menu-enabled-input').disabled, true);
  assert.equal(document.querySelector('#save-control-btn').disabled, true);
  assert.equal(document.querySelector('#control-save-status').textContent, 'Remote policy API is temporarily unavailable.');
  dom.window.close();
});

test('master switch persists immediately and targeted notification uses the selected device', async () => {
  const responses = successfulResponses();
  const dom = await bootDashboard(responses);
  const { document } = dom.window;

  responses['/api/admin/control-config'] = jsonResponse(200, {
    success: true,
    config: {
      id: 1, menu_enabled: false, maintenance_mode: false, auto_update_enabled: false,
      minimum_version: '1.0.0', latest_version: '1.1.0', update_url: null,
      heartbeat_interval_seconds: 45, announcement: null, config_revision: 8,
      updated_at: '2026-07-15T10:01:00.000Z'
    },
    features: {}
  });
  document.querySelector('#menu-enabled-input').click();
  await new Promise(resolve => dom.window.setTimeout(resolve, 80));
  assert.equal(document.querySelector('#menu-enabled-input').checked, false);
  assert.equal(document.querySelector('#config-revision').textContent, 'Revision 8');

  responses['/api/admin/notifications'] = jsonResponse(201, {
    success: true,
    target: 'device',
    device_id: 9,
    notification: { id: 'notification-1', title: 'VIP', message: 'Hello', created_at: '2026-07-15T10:02:00.000Z' }
  });
  document.querySelector('#notification-target-input').value = '9';
  document.querySelector('#notification-title-input').value = 'VIP';
  document.querySelector('#announcement-input').value = 'Hello';
  document.querySelector('#send-notification-btn').click();
  await new Promise(resolve => dom.window.setTimeout(resolve, 80));
  assert.match(document.querySelector('#notification-send-status').textContent, /Android device/);
  assert.equal(document.querySelector('#announcement-input').value, '');

  const connectionUri = 'serverkey://connect?base_url=https%3A%2F%2Fserver.example&product_token=TKN_TEST&project_id=aov.vip&protocol=1';
  responses['/api/admin/integration-manifest'] = jsonResponse(200, {
    success: true,
    manifest: {
      connection_uri: connectionUri,
      project: { project_id: 'aov.vip', app_version: '1.0.0', product_name: 'VIP Business' },
      server: {
        base_url: 'https://server.example',
        bootstrap: '/api/v1/sdk/bootstrap/TKN_TEST'
      }
    }
  });
  document.querySelector('#integration-product-input').value = 'TKN_TEST';
  document.querySelector('#integration-project-input').value = 'aov.vip';
  document.querySelector('#integration-version-input').value = '1.0.0';
  document.querySelector('#generate-integration-btn').click();
  await new Promise(resolve => dom.window.setTimeout(resolve, 80));
  assert.equal(document.querySelector('#integration-uri-output').value, connectionUri);
  assert.match(document.querySelector('#integration-code-output').textContent, /ServerKeyRuntime\.create/);
  assert.equal(document.querySelector('#integration-result').classList.contains('hidden'), false);
  assert.equal(document.querySelector('#download-sdk-zip').disabled, false);
  assert.equal(document.querySelector('.integration-api-meta a'), null);
  dom.window.close();
});

test('migration and module failures are shown as degraded, never connected', async () => {
  const responses = successfulResponses();
  responses['/api/health'] = jsonResponse(503, {
    status: 'migration_required', schema_ready: false, database_configured: true,
    version: '4.5.0', message: 'Run supabase.sql to install the v4 database schema.'
  });
  for (const endpoint of ['/api/admin/stats', '/api/admin/control-config', '/api/admin/devices', '/api/admin/sessions']) {
    responses[endpoint] = jsonResponse(500, { success: false, message: `Database module unavailable: ${endpoint}` });
  }

  const dom = await bootDashboard(responses);
  const { document } = dom.window;
  assert.equal(document.querySelector('#api-status-text').textContent, 'Cần migration');
  assert.equal(document.querySelector('#system-banner').classList.contains('hidden'), false);
  assert.match(document.querySelector('#system-banner-message').textContent, /Run supabase\.sql/);
  assert.equal(document.querySelector('[data-stat="total"]').textContent, '—');
  assert.equal(document.querySelector('#nav-device-count').textContent, '—');

  document.querySelector('[data-view="devices"]').click();
  assert.match(document.querySelector('#devices-table-body').textContent, /Database module unavailable/);
  dom.window.close();
});

test('server error text is rendered as text, not injected HTML', async () => {
  const malicious = '<img src=x onerror="globalThis.injected=true">Invalid password';
  const dom = await bootDashboard({
    '/api/admin/login': jsonResponse(401, { success: false, message: malicious })
  }, { authenticated: false });
  const { window } = dom;
  const password = window.document.querySelector('#admin-password');
  password.value = 'wrong-password';
  window.document.querySelector('#login-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise(resolve => window.setTimeout(resolve, 80));

  const toast = window.document.querySelector('.toast-message');
  assert.equal(toast.textContent, malicious);
  assert.equal(window.document.querySelector('.toast img'), null);
  assert.equal(window.injected, undefined);
  dom.window.close();
});
