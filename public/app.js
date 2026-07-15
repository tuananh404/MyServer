/**
 * Client-side Controller for Owner Dashboard v3.0
 * Token-based key management system
 */

document.addEventListener('DOMContentLoaded', () => {
    // State management
    const state = {
        adminToken: localStorage.getItem('admin_token') || '',
        keysList: [],
        tokensList: [],
        fraudLogs: [],
        controlConfig: null,
        featureFlags: [],
        devices: [],
        sessions: [],
        stats: { total: 0, unactivated: 0, activated: 0, expired: 0, banned: 0, fraudAlerts: 0, totalTokens: 0, devices: 0, activeSessions: 0 },
        selectedDuration: 1,
        selectedTokenId: null,
        currentModalAction: null
    };

    // DOM Elements Cache
    const loginContainer = document.getElementById('login-container');
    const dashboardContainer = document.getElementById('dashboard-container');
    const loginForm = document.getElementById('login-form');
    const loginBtn = document.getElementById('login-btn');
    const adminPasswordInput = document.getElementById('admin-password');
    const togglePasswordBtn = document.getElementById('toggle-password');
    const apiStatusText = document.getElementById('api-status-text');
    const statusIndicator = document.getElementById('status-indicator');
    const logoutBtn = document.getElementById('logout-btn');
    const refreshBtn = document.getElementById('refresh-btn');

    // Token management elements
    const tokenForm = document.getElementById('token-form');
    const tokenNameInput = document.getElementById('token-name-input');
    const tokenMaxDaysInput = document.getElementById('token-max-days-input');
    const tokenDisplayTextInput = document.getElementById('token-display-text-input');
    const tokenDescInput = document.getElementById('token-desc-input');
    const createTokenBtn = document.getElementById('create-token-btn');
    const tokensTableBody = document.getElementById('tokens-table-body');

    // Generator elements
    const tokenSelect = document.getElementById('token-select');
    const tokenWarning = document.getElementById('token-warning');
    const presetButtons = document.querySelectorAll('.btn-preset');
    const durationInput = document.getElementById('duration-input');
    const countInput = document.getElementById('count-input');
    const maxDevicesInput = document.getElementById('max-devices-input');
    const customKeyInput = document.getElementById('custom-key-input');
    const noteInput = document.getElementById('note-input');
    const createKeyBtn = document.getElementById('create-key-btn');
    const generatedKeyBox = document.getElementById('generated-key-box');
    const generatedKeysList = document.getElementById('generated-keys-list');
    const copyAllBtn = document.getElementById('copy-all-btn');

    // Table elements
    const keysTableBody = document.getElementById('keys-table-body');
    const searchKeyInput = document.getElementById('search-key-input');

    // Fraud elements
    const fraudCard = document.getElementById('fraud-card');
    const fraudSubtitle = document.getElementById('fraud-subtitle');
    const fraudLogsEmpty = document.getElementById('fraud-logs-empty');
    const fraudLogsList = document.getElementById('fraud-logs-list');
    const clearFraudBtn = document.getElementById('clear-fraud-btn');

    // Modal elements
    const confirmModal = document.getElementById('confirm-modal');
    const modalTitle = document.getElementById('modal-title');
    const modalMessage = document.getElementById('modal-message');
    const modalBtnCancel = document.getElementById('modal-btn-cancel');
    const modalBtnConfirm = document.getElementById('modal-btn-confirm');

    // Control plane elements
    const menuEnabledInput = document.getElementById('menu-enabled-input');
    const maintenanceModeInput = document.getElementById('maintenance-mode-input');
    const autoUpdateEnabledInput = document.getElementById('auto-update-enabled-input');
    const minimumVersionInput = document.getElementById('minimum-version-input');
    const latestVersionInput = document.getElementById('latest-version-input');
    const updateUrlInput = document.getElementById('update-url-input');
    const heartbeatIntervalInput = document.getElementById('heartbeat-interval-input');
    const announcementInput = document.getElementById('announcement-input');
    const configRevision = document.getElementById('config-revision');
    const saveControlBtn = document.getElementById('save-control-btn');
    const controlSaveStatus = document.getElementById('control-save-status');

    // Feature, device and session elements
    const featureFlagForm = document.getElementById('feature-flag-form');
    const featureKeyInput = document.getElementById('feature-key-input');
    const featureNameInput = document.getElementById('feature-name-input');
    const featureDescriptionInput = document.getElementById('feature-description-input');
    const featureSortInput = document.getElementById('feature-sort-input');
    const featureEnabledInput = document.getElementById('feature-enabled-input');
    const featureLockedInput = document.getElementById('feature-locked-input');
    const saveFeatureBtn = document.getElementById('save-feature-btn');
    const featureFlagsTableBody = document.getElementById('feature-flags-table-body');
    const devicesTableBody = document.getElementById('devices-table-body');
    const sessionsTableBody = document.getElementById('sessions-table-body');
    const deviceSearchInput = document.getElementById('device-search-input');

    // Auto-refresh interval
    let refreshIntervalId = null;

    // ==========================================
    // INITIALIZATION & SESSION CONTROL
    // ==========================================
    function init() {
        if (state.adminToken) {
            verifyTokenAndStart();
        } else {
            showLogin();
        }
    }

    async function verifyTokenAndStart() {
        showLoadingState();
        const success = await loadData();
        if (success) {
            showDashboard();
            startAutoRefresh();
        } else {
            showToast('Phiên làm việc hết hạn. Vui lòng đăng nhập lại.', 'error');
            clearSession();
            showLogin();
        }
    }

    function clearSession() {
        state.adminToken = '';
        localStorage.removeItem('admin_token');
        stopAutoRefresh();
    }

    function showLogin() {
        loginContainer.classList.remove('hidden');
        dashboardContainer.classList.add('hidden');
        adminPasswordInput.value = '';
        setTimeout(() => adminPasswordInput.focus(), 200);
    }

    function showDashboard() {
        loginContainer.classList.add('hidden');
        dashboardContainer.classList.remove('hidden');
    }

    function showLoadingState() {
        keysTableBody.innerHTML = `
            <tr>
                <td colspan="8" class="loading-state">
                    <i class="fa-solid fa-spinner fa-spin"></i> Đang tải dữ liệu...
                </td>
            </tr>
        `;
    }

    // ==========================================
    // API HELPERS
    // ==========================================
    async function apiRequest(endpoint, method = 'GET', body = null) {
        const headers = { 'Content-Type': 'application/json' };
        if (state.adminToken) {
            headers['Authorization'] = `Bearer ${state.adminToken}`;
        }

        const config = { method, headers };
        if (body) config.body = JSON.stringify(body);

        try {
            const response = await fetch(endpoint, config);
            if (response.status === 401 || response.status === 403) {
                if (endpoint.includes('/get-keys') || endpoint.includes('/stats') || endpoint.includes('/get-tokens')) {
                    return { success: false, status: response.status, message: 'Unauthorized' };
                }
                showToast('Phiên làm việc hết hạn.', 'error');
                clearSession();
                showLogin();
                return { success: false, status: response.status, message: 'Unauthorized' };
            }
            const data = await response.json();
            return { success: response.ok, status: response.status, data };
        } catch (error) {
            console.error(`API request failed [${endpoint}]:`, error);
            return { success: false, error: true, message: 'Network error' };
        }
    }

    async function loadData() {
        const [keysRes, fraudRes, statsRes, tokensRes, controlRes, devicesRes, sessionsRes] = await Promise.all([
            apiRequest('/api/admin/get-keys'),
            apiRequest('/api/admin/get-fraud'),
            apiRequest('/api/admin/stats'),
            apiRequest('/api/admin/get-tokens'),
            apiRequest('/api/admin/control-config'),
            apiRequest('/api/admin/devices'),
            apiRequest('/api/admin/sessions')
        ]);

        if (keysRes.success && fraudRes.success) {
            state.keysList = keysRes.data.keys || [];
            state.fraudLogs = fraudRes.data.logs || [];
            if (statsRes.success) {
                state.stats = statsRes.data.stats;
            }
            if (tokensRes.success) {
                state.tokensList = tokensRes.data.tokens || [];
            }
            if (controlRes.success) {
                state.controlConfig = controlRes.data.config || null;
                state.featureFlags = Object.entries(controlRes.data.features || {}).map(([feature_key, flag]) => ({ feature_key, ...flag }));
            }
            if (devicesRes.success) state.devices = devicesRes.data.devices || [];
            if (sessionsRes.success) state.sessions = sessionsRes.data.sessions || [];

            updateApiStatus(true);
            renderStats();
            renderKeys();
            renderFraudLogs();
            renderTokens();
            renderTokenSelect();
            renderControlPlane();
            renderFeatureFlags();
            renderDevices();
            renderSessions();
            return true;
        } else {
            updateApiStatus(false);
            return false;
        }
    }

    async function loadTokens() {
        const res = await apiRequest('/api/admin/get-tokens');
        if (res.success) {
            state.tokensList = res.data.tokens || [];
            renderTokens();
            renderTokenSelect();
        }
    }

    function updateApiStatus(connected) {
        const dot = statusIndicator.querySelector('.pulse-dot');
        if (connected) {
            apiStatusText.innerText = 'Connected';
            dot.style.backgroundColor = '';
        } else {
            apiStatusText.innerText = 'Offline';
            dot.style.backgroundColor = 'var(--color-danger)';
        }
    }

    function startAutoRefresh() {
        stopAutoRefresh();
        refreshIntervalId = setInterval(() => loadData(), 12000);
    }

    function stopAutoRefresh() {
        if (refreshIntervalId) {
            clearInterval(refreshIntervalId);
            refreshIntervalId = null;
        }
    }

    // ==========================================
    // ANIMATED COUNTER
    // ==========================================
    function animateCounter(element, target) {
        const current = parseInt(element.innerText) || 0;
        if (current === target) return;

        const duration = 500;
        const start = performance.now();

        function update(now) {
            const elapsed = now - start;
            const progress = Math.min(elapsed / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
            const value = Math.round(current + (target - current) * eased);
            element.innerText = value;
            if (progress < 1) requestAnimationFrame(update);
        }
        requestAnimationFrame(update);
    }

    // ==========================================
    // RENDER FUNCTIONS
    // ==========================================
    function renderStats() {
        document.querySelectorAll('[data-stat]').forEach(el => {
            const key = el.getAttribute('data-stat');
            if (state.stats[key] !== undefined) {
                animateCounter(el, state.stats[key]);
            }
        });

        // Fraud card glow on stat card
        const fraudStatCard = document.getElementById('stat-fraud');
        if (state.stats.fraudAlerts > 0) {
            fraudStatCard.style.borderColor = 'rgba(244, 63, 94, 0.3)';
        } else {
            fraudStatCard.style.borderColor = '';
        }
    }

    function renderTokens() {
        if (state.tokensList.length === 0) {
            tokensTableBody.innerHTML = `
                <tr>
                    <td colspan="6" class="loading-state">
                        <i class="fa-solid fa-cube" style="opacity:0.3;"></i> Chưa có Token nào
                    </td>
                </tr>
            `;
            return;
        }

        tokensTableBody.innerHTML = state.tokensList.map(token => {
            const maxDaysDisplay = token.max_days
                ? `${token.max_days} ngày`
                : '<span style="color:var(--color-warning)">∞ Không giới hạn</span>';

            return `
                <tr>
                    <td><strong>${escapeHTML(token.token_name)}</strong></td>
                    <td class="key-string-cell">${escapeHTML(token.token_string || token.id)}</td>
                    <td>${maxDaysDisplay}</td>
                    <td><span style="font-size:12px; font-family:var(--font-mono); color: var(--color-primary);">${escapeHTML(token.display_text || 'ServerKey by #wtuananh6868')}</span></td>
                    <td><span style="font-size:12px; color: var(--color-text-muted);">${escapeHTML(token.description || '')}</span></td>
                    <td class="actions-cell">
                        <button class="btn btn-danger-outline btn-sm action-delete-token" data-token-id="${token.id}" title="Xóa Token">
                            <i class="fa-solid fa-trash-can"></i>
                        </button>
                    </td>
                </tr>
            `;
        }).join('');

        // Attach delete event listeners
        document.querySelectorAll('.action-delete-token').forEach(btn => {
            btn.addEventListener('click', () => {
                const tokenId = btn.getAttribute('data-token-id');
                const token = state.tokensList.find(t => String(t.id) === tokenId);
                const tokenName = token ? token.token_name : tokenId;
                confirmAction('Xóa Token', `<strong style="color:var(--color-danger)">Hành động không thể hoàn tác!</strong><br>Xóa Token: <strong>${escapeHTML(tokenName)}</strong>?<br><small style="color:var(--color-text-dark)">Các key liên kết cũng sẽ bị xóa.</small>`, async () => {
                    const res = await apiRequest('/api/admin/delete-token', 'DELETE', { token_id: tokenId });
                    if (res.success) {
                        showToast(`Đã xóa Token "${tokenName}".`, 'success');
                        loadData();
                    } else {
                        showToast(`Lỗi: ${res.data?.message || 'Unknown error'}`, 'error');
                    }
                });
            });
        });
    }

    function renderTokenSelect() {
        // Preserve current selection if possible
        const prevSelected = state.selectedTokenId;

        // Clear existing options except default
        tokenSelect.innerHTML = '<option value="" disabled>-- Chọn Token --</option>';

        state.tokensList.forEach(token => {
            const maxDaysLabel = token.max_days ? ` (${token.max_days}d)` : ' (∞)';
            const option = document.createElement('option');
            option.value = token.id;
            option.textContent = `${token.token_name}${maxDaysLabel}`;
            tokenSelect.appendChild(option);
        });

        // Auto-select if only 1 token
        if (state.tokensList.length === 1) {
            tokenSelect.value = state.tokensList[0].id;
            state.selectedTokenId = state.tokensList[0].id;
            updatePresetStates();
        } else if (prevSelected && state.tokensList.find(t => t.id === prevSelected)) {
            tokenSelect.value = prevSelected;
            state.selectedTokenId = prevSelected;
            updatePresetStates();
        } else {
            tokenSelect.selectedIndex = 0;
            state.selectedTokenId = null;
        }
    }

    function getSelectedToken() {
        if (!state.selectedTokenId) return null;
        return state.tokensList.find(t => t.id === state.selectedTokenId) || null;
    }

    function updatePresetStates() {
        const token = getSelectedToken();
        const maxDays = token?.max_days || null; // null = unlimited

        presetButtons.forEach(btn => {
            const days = parseInt(btn.getAttribute('data-days'));
            // If token has max_days, disable presets that exceed it (except lifetime -1 needs special handling)
            if (maxDays !== null) {
                if (days === -1) {
                    // Lifetime — disable if token has max_days
                    btn.classList.add('disabled-by-token');
                } else if (days > maxDays) {
                    btn.classList.add('disabled-by-token');
                } else {
                    btn.classList.remove('disabled-by-token');
                }
            } else {
                // No max_days limit, enable all
                btn.classList.remove('disabled-by-token');
            }
        });

        // Check custom duration warning
        validateDurationAgainstToken();
    }

    function validateDurationAgainstToken() {
        const token = getSelectedToken();
        if (!token || !token.max_days) {
            tokenWarning.classList.add('hidden');
            tokenWarning.textContent = '';
            return true;
        }

        const duration = parseInt(durationInput.value);
        if (duration === -1 || (duration > token.max_days)) {
            tokenWarning.classList.remove('hidden');
            tokenWarning.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Token "${escapeHTML(token.token_name)}" giới hạn tối đa ${token.max_days} ngày`;
            return false;
        }

        tokenWarning.classList.add('hidden');
        tokenWarning.textContent = '';
        return true;
    }

    function renderKeys() {
        const query = searchKeyInput.value.toLowerCase().trim();
        const filteredKeys = state.keysList.filter(key => {
            const keyMatch = key.key_string.toLowerCase().includes(query);
            const noteMatch = (key.note || '').toLowerCase().includes(query);
            const tokenMatch = (key.token_name || '').toLowerCase().includes(query);
            return keyMatch || noteMatch || tokenMatch;
        });

        if (filteredKeys.length === 0) {
            keysTableBody.innerHTML = `
                <tr>
                    <td colspan="8" class="loading-state">
                        <i class="fa-solid fa-folder-open" style="opacity:0.3;"></i> Không tìm thấy keys nào
                    </td>
                </tr>
            `;
            return;
        }

        keysTableBody.innerHTML = filteredKeys.map(key => {
            // Expiry display
            let expiryDisplay = '<span style="color:var(--color-text-dark)">—</span>';
            if (key.duration_days === -1) {
                expiryDisplay = '<span style="color: var(--color-warning); font-weight:600;">∞ Lifetime</span>';
            } else if (key.expires_at) {
                const date = new Date(key.expires_at);
                expiryDisplay = date.toLocaleString('vi-VN');
            }

            // Duration display
            const durationDisplay = key.duration_days === -1
                ? '<span style="color:var(--color-warning)">∞</span>'
                : `${key.duration_days} ngày`;

            // Token name badge
            const tokenDisplay = key.token_name
                ? `<span class="badge-token"><i class="fa-solid fa-cube"></i> ${escapeHTML(key.token_name)}</span>`
                : '<span style="color:var(--color-text-dark); font-size:11px;">—</span>';

            // Device count display
            const deviceCount = key.device_count || 0;
            const maxDevices = key.max_devices !== undefined ? key.max_devices : '?';
            const deviceDisplay = `<span class="badge-devices"><i class="fa-solid fa-display" style="font-size:9px;"></i> ${deviceCount}/${maxDevices}</span>`;

            // Status badges
            const statusMap = {
                'unactivated': '<span class="badge badge-unactivated"><i class="fa-solid fa-circle" style="font-size:6px"></i> Sẵn sàng</span>',
                'activated': '<span class="badge badge-activated"><i class="fa-solid fa-circle" style="font-size:6px"></i> Hoạt động</span>',
                'expired': '<span class="badge badge-expired"><i class="fa-solid fa-circle" style="font-size:6px"></i> Hết hạn</span>',
                'banned': '<span class="badge badge-banned"><i class="fa-solid fa-circle" style="font-size:6px"></i> Bị khóa</span>'
            };
            const statusBadge = statusMap[key.status] || `<span class="badge">${key.status}</span>`;

            // Action buttons
            let actionButtons = '';

            // Reset HWID button (only when activated or expired)
            if (key.status === 'activated' || key.status === 'expired') {
                actionButtons += `<button class="btn btn-outline btn-sm action-reset-hwid" data-key="${key.key_string}" title="Reset HWID">
                    <i class="fa-solid fa-arrows-rotate"></i>
                </button>`;
            }

            // Ban/Unban button
            if (key.status === 'banned') {
                actionButtons += `<button class="btn btn-warning-outline btn-sm action-unban-key" data-key="${key.key_string}" title="Mở khóa Key">
                    <i class="fa-solid fa-lock-open"></i>
                </button>`;
            } else {
                actionButtons += `<button class="btn btn-danger-outline btn-sm action-ban-key" data-key="${key.key_string}" title="Khóa Key">
                    <i class="fa-solid fa-ban"></i>
                </button>`;
            }

            // Delete button
            actionButtons += `<button class="btn btn-danger-outline btn-sm action-delete-key" data-key="${key.key_string}" title="Xóa Key">
                <i class="fa-solid fa-trash-can"></i>
            </button>`;

            return `
                <tr>
                    <td class="key-string-cell">${escapeHTML(key.key_string)}</td>
                    <td>${tokenDisplay}</td>
                    <td>${durationDisplay}</td>
                    <td style="font-size:12px;">${expiryDisplay}</td>
                    <td>${deviceDisplay}</td>
                    <td>${statusBadge}</td>
                    <td><span style="font-size:12px; color: var(--color-text-muted);">${escapeHTML(key.note || '')}</span></td>
                    <td class="actions-cell">${actionButtons}</td>
                </tr>
            `;
        }).join('');

        // Attach action event listeners
        attachKeyActions();
    }

    function attachKeyActions() {
        // Reset HWID
        document.querySelectorAll('.action-reset-hwid').forEach(btn => {
            btn.addEventListener('click', () => {
                const key = btn.getAttribute('data-key');
                confirmAction('Đặt lại HWID', `Reset Hardware ID cho Key: <strong>${key}</strong>?<br><small style="color:var(--color-text-dark)">Khách hàng sẽ kích hoạt được thiết bị mới.</small>`, async () => {
                    const res = await apiRequest('/api/admin/reset-hwid', 'POST', { key_string: key });
                    if (res.success) {
                        showToast(`Reset HWID cho ${key} thành công.`, 'success');
                        loadData();
                    } else {
                        showToast(`Lỗi: ${res.data?.message || 'Unknown error'}`, 'error');
                    }
                });
            });
        });

        // Ban key
        document.querySelectorAll('.action-ban-key').forEach(btn => {
            btn.addEventListener('click', () => {
                const key = btn.getAttribute('data-key');
                confirmAction('Khóa Key', `Bạn muốn <strong>cấm</strong> Key: <strong>${key}</strong>?<br><small style="color:var(--color-text-dark)">Key bị khóa sẽ không thể sử dụng để đăng nhập.</small>`, async () => {
                    const res = await apiRequest('/api/admin/ban-key', 'POST', { key_string: key, action: 'ban' });
                    if (res.success) {
                        showToast(`Đã khóa Key ${key}.`, 'success');
                        loadData();
                    } else {
                        showToast(`Lỗi: ${res.data?.message || 'Unknown error'}`, 'error');
                    }
                });
            });
        });

        // Unban key
        document.querySelectorAll('.action-unban-key').forEach(btn => {
            btn.addEventListener('click', () => {
                const key = btn.getAttribute('data-key');
                confirmAction('Mở khóa Key', `Mở khóa Key: <strong>${key}</strong>?<br><small style="color:var(--color-text-dark)">Key sẽ trở về trạng thái sẵn sàng, HWID sẽ được reset.</small>`, async () => {
                    const res = await apiRequest('/api/admin/ban-key', 'POST', { key_string: key, action: 'unban' });
                    if (res.success) {
                        showToast(`Đã mở khóa Key ${key}.`, 'success');
                        loadData();
                    } else {
                        showToast(`Lỗi: ${res.data?.message || 'Unknown error'}`, 'error');
                    }
                });
            });
        });

        // Delete key
        document.querySelectorAll('.action-delete-key').forEach(btn => {
            btn.addEventListener('click', () => {
                const key = btn.getAttribute('data-key');
                confirmAction('Xóa Key', `<strong style="color:var(--color-danger)">Hành động không thể hoàn tác!</strong><br>Xóa vĩnh viễn Key: <strong>${key}</strong>?`, async () => {
                    const res = await apiRequest('/api/admin/delete-key', 'DELETE', { key_string: key });
                    if (res.success) {
                        showToast(`Đã xóa Key ${key}.`, 'success');
                        loadData();
                    } else {
                        showToast(`Lỗi: ${res.data?.message || 'Unknown error'}`, 'error');
                    }
                });
            });
        });
    }

    function renderFraudLogs() {
        if (state.fraudLogs.length === 0) {
            fraudLogsEmpty.classList.remove('hidden');
            fraudLogsList.classList.add('hidden');
            fraudCard.classList.remove('has-fraud');
            clearFraudBtn.classList.add('hidden');
            fraudSubtitle.innerText = 'Không có vi phạm mới được phát hiện';
            return;
        }

        // Fraud detected!
        fraudLogsEmpty.classList.add('hidden');
        fraudLogsList.classList.remove('hidden');
        fraudCard.classList.add('has-fraud');
        clearFraudBtn.classList.remove('hidden');
        fraudSubtitle.innerText = `Phát hiện ${state.fraudLogs.length} hoạt động đáng ngờ!`;

        fraudLogsList.innerHTML = state.fraudLogs.map(log => {
            const time = new Date(log.logged_at).toLocaleString('vi-VN');
            return `
                <li class="fraud-log-item">
                    <div class="fraud-meta">
                        <span class="fraud-reason"><i class="fa-solid fa-triangle-exclamation"></i> ${escapeHTML(log.reason)}</span>
                        <span class="fraud-time">${time}</span>
                    </div>
                    <div>
                        <span style="font-size:10px; color: var(--color-text-dark); display:block; margin-bottom:2px;">HWID:</span>
                        <span class="fraud-hwid">${escapeHTML(log.hwid)}</span>
                    </div>
                </li>
            `;
        }).join('');
    }

    // ==========================================
    // CONTROL PLANE RENDERING
    // ==========================================

    function formatDateTime(value) {
        if (!value) return '—';
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('vi-VN');
    }

    function renderControlPlane() {
        const config = state.controlConfig;
        if (!config) {
            configRevision.textContent = 'Revision —';
            controlSaveStatus.textContent = 'Chưa có migration v4 hoặc không tải được policy';
            return;
        }

        menuEnabledInput.checked = Boolean(config.menu_enabled);
        maintenanceModeInput.checked = Boolean(config.maintenance_mode);
        autoUpdateEnabledInput.checked = Boolean(config.auto_update_enabled);
        minimumVersionInput.value = config.minimum_version || '1.0.0';
        latestVersionInput.value = config.latest_version || '1.0.0';
        updateUrlInput.value = config.update_url || '';
        heartbeatIntervalInput.value = config.heartbeat_interval_seconds || 45;
        announcementInput.value = config.announcement || '';
        configRevision.textContent = `Revision ${config.config_revision || 1}`;
        controlSaveStatus.textContent = `Cập nhật: ${formatDateTime(config.updated_at)}`;
    }

    function renderFeatureFlags() {
        const flags = [...state.featureFlags].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
        if (flags.length === 0) {
            featureFlagsTableBody.innerHTML = '<tr><td colspan="7" class="loading-state">Chưa có feature flag</td></tr>';
            return;
        }

        featureFlagsTableBody.innerHTML = flags.map(flag => `
            <tr>
                <td class="mono-value">${escapeHTML(flag.feature_key)}</td>
                <td><strong>${escapeHTML(flag.display_name)}</strong></td>
                <td class="muted-value">${escapeHTML(flag.description || '')}</td>
                <td><span class="flag-state ${flag.enabled ? 'is-on' : ''}">${flag.enabled ? 'ON' : 'OFF'}</span></td>
                <td><span class="flag-state ${flag.locked ? 'is-locked' : ''}">${flag.locked ? 'LOCKED' : 'OPEN'}</span></td>
                <td>${Number(flag.sort_order) || 0}</td>
                <td class="actions-cell">
                    <button class="btn btn-outline btn-sm action-edit-feature" data-feature="${flag.feature_key}" title="Chỉnh sửa"><i class="fa-solid fa-pen"></i></button>
                    <button class="btn btn-outline btn-sm action-toggle-feature" data-feature="${flag.feature_key}" title="Bật/tắt"><i class="fa-solid fa-power-off"></i></button>
                    <button class="btn btn-danger-outline btn-sm action-delete-feature" data-feature="${flag.feature_key}" title="Xóa"><i class="fa-solid fa-trash-can"></i></button>
                </td>
            </tr>
        `).join('');

        document.querySelectorAll('.action-edit-feature').forEach(button => {
            button.addEventListener('click', () => {
                const flag = state.featureFlags.find(item => item.feature_key === button.dataset.feature);
                if (!flag) return;
                featureKeyInput.value = flag.feature_key;
                featureKeyInput.readOnly = true;
                featureNameInput.value = flag.display_name || '';
                featureDescriptionInput.value = flag.description || '';
                featureSortInput.value = flag.sort_order || 0;
                featureEnabledInput.checked = Boolean(flag.enabled);
                featureLockedInput.checked = Boolean(flag.locked);
                featureNameInput.focus();
            });
        });

        document.querySelectorAll('.action-toggle-feature').forEach(button => {
            button.addEventListener('click', async () => {
                const flag = state.featureFlags.find(item => item.feature_key === button.dataset.feature);
                if (!flag) return;
                const res = await saveFeatureFlag({ ...flag, enabled: !flag.enabled });
                if (res) showToast(`${flag.display_name}: ${flag.enabled ? 'OFF' : 'ON'}`, 'success');
            });
        });

        document.querySelectorAll('.action-delete-feature').forEach(button => {
            button.addEventListener('click', () => {
                const featureKey = button.dataset.feature;
                confirmAction('Xóa Feature Flag', `Xóa flag <strong>${escapeHTML(featureKey)}</strong>?`, async () => {
                    const res = await apiRequest('/api/admin/feature-flag', 'DELETE', { feature_key: featureKey });
                    if (res.success) {
                        showToast(`Đã xóa ${featureKey}.`, 'success');
                        loadData();
                    } else {
                        showToast(res.data?.message || 'Không thể xóa flag.', 'error');
                    }
                });
            });
        });
    }

    async function saveFeatureFlag(flag) {
        const res = await apiRequest('/api/admin/feature-flag', 'POST', {
            feature_key: flag.feature_key,
            display_name: flag.display_name,
            description: flag.description || '',
            enabled: Boolean(flag.enabled),
            locked: Boolean(flag.locked),
            sort_order: Number(flag.sort_order) || 0
        });
        if (res.success) {
            await loadData();
            return true;
        }
        showToast(res.data?.message || 'Không thể lưu feature flag.', 'error');
        return false;
    }

    function renderDevices() {
        const query = (deviceSearchInput.value || '').trim().toLowerCase();
        const devices = state.devices.filter(device => {
            if (!query) return true;
            const licenses = (device.licenses || []).map(item => item.key_string).join(' ');
            return `${device.hwid} ${device.app_version || ''} ${licenses}`.toLowerCase().includes(query);
        });

        if (devices.length === 0) {
            devicesTableBody.innerHTML = '<tr><td colspan="8" class="loading-state">Không tìm thấy thiết bị</td></tr>';
            return;
        }

        devicesTableBody.innerHTML = devices.map(device => {
            const licenses = (device.licenses || []).length
                ? `<div class="license-stack">${device.licenses.map(item => `<span class="license-chip" title="${escapeHTML(item.key_string)}">${escapeHTML(item.key_string)}</span>`).join('')}</div>`
                : '<span class="muted-value">—</span>';
            const banned = device.status === 'banned';
            return `
                <tr>
                    <td><span class="mono-value">${escapeHTML(device.hwid)}</span></td>
                    <td>${escapeHTML(device.app_version || '—')}</td>
                    <td>${licenses}</td>
                    <td>${Number(device.active_sessions) || 0}</td>
                    <td class="muted-value">${formatDateTime(device.last_seen_at)}</td>
                    <td><span class="status-pill ${banned ? 'status-banned' : 'status-active'}">${banned ? 'Banned' : 'Active'}</span></td>
                    <td class="muted-value">${escapeHTML(device.ban_reason || '—')}</td>
                    <td class="actions-cell">
                        <button class="btn ${banned ? 'btn-warning-outline' : 'btn-danger-outline'} btn-sm action-device-status" data-device-id="${device.id}" data-device-status="${banned ? 'active' : 'banned'}">
                            <i class="fa-solid ${banned ? 'fa-lock-open' : 'fa-ban'}"></i> ${banned ? 'Mở khóa' : 'Khóa'}
                        </button>
                    </td>
                </tr>
            `;
        }).join('');

        document.querySelectorAll('.action-device-status').forEach(button => {
            button.addEventListener('click', () => {
                const deviceId = Number(button.dataset.deviceId);
                const nextStatus = button.dataset.deviceStatus;
                const device = state.devices.find(item => Number(item.id) === deviceId);
                if (!device) return;
                const actionText = nextStatus === 'banned' ? 'khóa' : 'mở khóa';
                confirmAction(`${nextStatus === 'banned' ? 'Khóa' : 'Mở khóa'} thiết bị`, `${actionText} <strong>${escapeHTML(device.hwid)}</strong>?`, async () => {
                    let reason = '';
                    if (nextStatus === 'banned') {
                        reason = window.prompt('Lý do khóa thiết bị:', 'Policy violation') || 'Policy violation';
                    }
                    const res = await apiRequest('/api/admin/device-status', 'POST', {
                        device_id: deviceId,
                        status: nextStatus,
                        reason
                    });
                    if (res.success) {
                        showToast(`Đã ${actionText} thiết bị.`, 'success');
                        loadData();
                    } else {
                        showToast(res.data?.message || `Không thể ${actionText} thiết bị.`, 'error');
                    }
                });
            });
        });
    }

    function renderSessions() {
        if (state.sessions.length === 0) {
            sessionsTableBody.innerHTML = '<tr><td colspan="8" class="loading-state">Chưa có client session</td></tr>';
            return;
        }

        sessionsTableBody.innerHTML = state.sessions.map(session => {
            const statusClass = session.status === 'active' ? 'status-active' : session.status === 'revoked' ? 'status-revoked' : 'status-expired';
            return `
                <tr>
                    <td class="mono-value">#${session.id}</td>
                    <td class="mono-value">${escapeHTML(session.device?.hwid || '—')}</td>
                    <td>${escapeHTML(session.license?.key_string || '—')}</td>
                    <td>${escapeHTML(session.device?.app_version || '—')}</td>
                    <td class="muted-value">${formatDateTime(session.last_seen_at)}</td>
                    <td class="muted-value">${formatDateTime(session.expires_at)}</td>
                    <td><span class="status-pill ${statusClass}">${escapeHTML(session.status)}</span></td>
                    <td class="actions-cell">
                        ${session.status === 'active' ? `<button class="btn btn-danger-outline btn-sm action-revoke-session" data-session-id="${session.id}"><i class="fa-solid fa-xmark"></i> Revoke</button>` : '—'}
                    </td>
                </tr>
            `;
        }).join('');

        document.querySelectorAll('.action-revoke-session').forEach(button => {
            button.addEventListener('click', () => {
                const sessionId = Number(button.dataset.sessionId);
                confirmAction('Revoke Session', `Thu hồi session <strong>#${sessionId}</strong>?`, async () => {
                    const res = await apiRequest('/api/admin/revoke-session', 'POST', { session_id: sessionId });
                    if (res.success) {
                        showToast(`Session #${sessionId} đã bị thu hồi.`, 'success');
                        loadData();
                    } else {
                        showToast(res.data?.message || 'Không thể thu hồi session.', 'error');
                    }
                });
            });
        });
    }

    // ==========================================
    // EVENT LISTENERS
    // ==========================================

    [menuEnabledInput, maintenanceModeInput, autoUpdateEnabledInput, minimumVersionInput,
        latestVersionInput, updateUrlInput, heartbeatIntervalInput, announcementInput]
        .forEach(input => input.addEventListener('input', () => {
            controlSaveStatus.textContent = 'Có thay đổi chưa lưu';
        }));

    saveControlBtn.addEventListener('click', async () => {
        const heartbeat = Number.parseInt(heartbeatIntervalInput.value, 10);
        if (!Number.isInteger(heartbeat) || heartbeat < 15 || heartbeat > 3600) {
            showToast('Heartbeat phải nằm trong khoảng 15–3600 giây.', 'error');
            heartbeatIntervalInput.focus();
            return;
        }

        saveControlBtn.disabled = true;
        saveControlBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang lưu...';
        const res = await apiRequest('/api/admin/control-config', 'PATCH', {
            menu_enabled: menuEnabledInput.checked,
            maintenance_mode: maintenanceModeInput.checked,
            auto_update_enabled: autoUpdateEnabledInput.checked,
            minimum_version: minimumVersionInput.value.trim(),
            latest_version: latestVersionInput.value.trim(),
            update_url: updateUrlInput.value.trim(),
            heartbeat_interval_seconds: heartbeat,
            announcement: announcementInput.value.trim()
        });
        saveControlBtn.disabled = false;
        saveControlBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i><span>Lưu Remote Policy</span>';

        if (res.success) {
            state.controlConfig = res.data.config;
            renderControlPlane();
            showToast('Remote policy đã được cập nhật.', 'success');
        } else {
            showToast(res.data?.message || 'Không thể lưu remote policy.', 'error');
        }
    });

    featureFlagForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const flag = {
            feature_key: featureKeyInput.value.trim().toLowerCase(),
            display_name: featureNameInput.value.trim(),
            description: featureDescriptionInput.value.trim(),
            enabled: featureEnabledInput.checked,
            locked: featureLockedInput.checked,
            sort_order: Number.parseInt(featureSortInput.value, 10) || 0
        };
        if (!/^[a-z][a-z0-9_]{1,63}$/.test(flag.feature_key) || !flag.display_name) {
            showToast('Feature key phải là snake_case và cần có tên hiển thị.', 'error');
            return;
        }

        saveFeatureBtn.disabled = true;
        const saved = await saveFeatureFlag(flag);
        saveFeatureBtn.disabled = false;
        if (saved) {
            featureFlagForm.reset();
            featureEnabledInput.checked = true;
            featureSortInput.value = '0';
            featureKeyInput.readOnly = false;
            showToast(`Đã lưu flag ${flag.feature_key}.`, 'success');
        }
    });

    deviceSearchInput.addEventListener('input', renderDevices);

    // Password visibility toggle
    togglePasswordBtn.addEventListener('click', () => {
        const isPassword = adminPasswordInput.type === 'password';
        adminPasswordInput.type = isPassword ? 'text' : 'password';
        togglePasswordBtn.querySelector('i').className = isPassword
            ? 'fa-solid fa-eye-slash'
            : 'fa-solid fa-eye';
    });

    // Login form
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const pwd = adminPasswordInput.value.trim();
        if (!pwd) return;

        loginBtn.disabled = true;
        loginBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>Đang kiểm tra...</span>';

        let loginData = null;
        try {
            const response = await fetch('/api/admin/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: pwd })
            });
            loginData = await response.json();
        } catch (error) {
            console.error('Admin login failed:', error);
        }

        if (loginData?.success && loginData.token) {
            state.adminToken = loginData.token;
            localStorage.setItem('admin_token', loginData.token);
            await loadData();
            showDashboard();
            updateApiStatus(true);
            startAutoRefresh();
            showToast('Đăng nhập thành công!', 'success');
        } else {
            clearSession();
            showToast('Mật khẩu không đúng hoặc lỗi kết nối API.', 'error');
            showLogin();
        }

        loginBtn.disabled = false;
        loginBtn.innerHTML = '<span class="btn-text">Đăng nhập</span><i class="fa-solid fa-arrow-right"></i>';
    });

    // Logout
    logoutBtn.addEventListener('click', () => {
        clearSession();
        showLogin();
        showToast('Đã đăng xuất.', 'info');
    });

    // Manual refresh
    refreshBtn.addEventListener('click', async () => {
        refreshBtn.querySelector('i').classList.add('spin-animation');
        await loadData();
        showToast('Dữ liệu đã được cập nhật.', 'success');
        setTimeout(() => {
            refreshBtn.querySelector('i').classList.remove('spin-animation');
        }, 800);
    });

    // Token select change
    tokenSelect.addEventListener('change', () => {
        state.selectedTokenId = tokenSelect.value || null;
        updatePresetStates();
    });

    // Preset buttons
    presetButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.classList.contains('disabled-by-token')) return;
            presetButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const days = parseInt(btn.getAttribute('data-days'));
            state.selectedDuration = days;
            durationInput.value = days;
            validateDurationAgainstToken();
        });
    });

    // Custom duration input
    durationInput.addEventListener('input', () => {
        const val = parseInt(durationInput.value);
        state.selectedDuration = isNaN(val) ? 1 : val;
        presetButtons.forEach(btn => {
            const btnDays = parseInt(btn.getAttribute('data-days'));
            btn.classList.toggle('active', btnDays === val);
        });
        validateDurationAgainstToken();
    });

    // Create Token
    createTokenBtn.addEventListener('click', async () => {
        const tokenName = tokenNameInput.value.trim();
        if (!tokenName) {
            showToast('Vui lòng nhập tên Token.', 'error');
            tokenNameInput.focus();
            return;
        }

        const maxDaysVal = tokenMaxDaysInput.value.trim();
        const maxDays = maxDaysVal ? parseInt(maxDaysVal) : null;
        const displayText = tokenDisplayTextInput.value.trim();
        const description = tokenDescInput.value.trim();

        createTokenBtn.disabled = true;
        createTokenBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>Đang tạo...</span>';

        const body = {
            token_name: tokenName,
            display_text: displayText,
            description: description
        };
        if (maxDays !== null) body.max_days = maxDays;

        const res = await apiRequest('/api/admin/create-token', 'POST', body);

        createTokenBtn.disabled = false;
        createTokenBtn.innerHTML = '<i class="fa-solid fa-plus"></i> <span class="btn-text">Tạo Token</span>';

        if (res.success && res.data.token) {
            showToast(`Tạo Token "${tokenName}" thành công!`, 'success');
            tokenNameInput.value = '';
            tokenMaxDaysInput.value = '';
            tokenDisplayTextInput.value = '';
            tokenDescInput.value = '';
            loadData();
        } else {
            showToast(`Lỗi tạo Token: ${res.data?.message || 'Unknown'}`, 'error');
        }
    });

    // Create key
    createKeyBtn.addEventListener('click', async () => {
        // Validate token selection
        if (!state.selectedTokenId) {
            showToast('Vui lòng chọn Token Package trước khi tạo key.', 'error');
            tokenSelect.focus();
            return;
        }

        const note = noteInput.value.trim();
        const duration = state.selectedDuration;
        const count = parseInt(countInput.value) || 1;
        const maxDevices = parseInt(maxDevicesInput.value) || 1;
        const customKeyString = customKeyInput.value.trim();

        if (maxDevices < 1) {
            showToast('Số thiết bị (Max Devices) phải lớn hơn hoặc bằng 1.', 'error');
            maxDevicesInput.focus();
            return;
        }

        // Validate duration against token max_days
        if (!validateDurationAgainstToken()) {
            showToast('Thời hạn vượt quá giới hạn của Token đã chọn.', 'error');
            return;
        }

        createKeyBtn.disabled = true;
        createKeyBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>Đang tạo...</span>';

        const res = await apiRequest('/api/admin/create-key', 'POST', {
            token_id: state.selectedTokenId,
            duration_days: duration,
            count: count,
            max_devices: maxDevices,
            custom_key_string: customKeyString,
            note: note
        });

        createKeyBtn.disabled = false;
        createKeyBtn.innerHTML = '<i class="fa-solid fa-bolt"></i> <span class="btn-text">Tạo Key Ngay</span>';

        if (res.success && res.data.keys) {
            const keys = res.data.keys;
            displayGeneratedKeys(keys);
            noteInput.value = '';
            countInput.value = '1';
            maxDevicesInput.value = '1';
            customKeyInput.value = '';
            showToast(`Tạo ${keys.length} Key thành công!`, 'success');
            loadData();
        } else {
            showToast(`Lỗi tạo key: ${res.data?.message || 'Unknown'}`, 'error');
        }
    });

    // Display generated keys in the box
    function displayGeneratedKeys(keys) {
        generatedKeysList.innerHTML = keys.map(key => {
            const keyStr = key.key_string || key;
            return `
                <li class="generated-key-item">
                    <span class="key-text">${escapeHTML(keyStr)}</span>
                    <button class="btn-copy-single" data-key="${escapeHTML(keyStr)}" title="Copy">
                        <i class="fa-regular fa-copy"></i> Copy
                    </button>
                </li>
            `;
        }).join('');

        generatedKeyBox.classList.remove('hidden');

        // Attach copy single handlers
        document.querySelectorAll('.btn-copy-single').forEach(btn => {
            btn.addEventListener('click', () => {
                const keyStr = btn.getAttribute('data-key');
                copyToClipboard(keyStr).then(() => {
                    const origHTML = btn.innerHTML;
                    btn.innerHTML = '<i class="fa-solid fa-check"></i> Copied!';
                    btn.style.background = 'var(--color-success)';
                    btn.style.color = 'white';
                    btn.style.borderColor = 'var(--color-success)';
                    setTimeout(() => {
                        btn.innerHTML = origHTML;
                        btn.style.background = '';
                        btn.style.color = '';
                        btn.style.borderColor = '';
                    }, 1500);
                });
            });
        });
    }

    // Copy All button
    copyAllBtn.addEventListener('click', () => {
        const allKeys = Array.from(generatedKeysList.querySelectorAll('.key-text'))
            .map(el => el.textContent)
            .join('\n');

        copyToClipboard(allKeys).then(() => {
            const origHTML = copyAllBtn.innerHTML;
            copyAllBtn.innerHTML = '<i class="fa-solid fa-check"></i> <span>Copied!</span>';
            copyAllBtn.classList.add('btn-success');
            showToast('Đã copy tất cả Keys!', 'success');
            setTimeout(() => {
                copyAllBtn.innerHTML = origHTML;
                copyAllBtn.classList.remove('btn-success');
            }, 2000);
        });
    });

    // Generic copy helper
    function copyToClipboard(text) {
        return navigator.clipboard.writeText(text).catch(() => {
            // Fallback for older browsers
            const textarea = document.createElement('textarea');
            textarea.value = text;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            return Promise.resolve();
        });
    }

    // Search filter
    searchKeyInput.addEventListener('input', () => renderKeys());

    // Clear fraud logs
    clearFraudBtn.addEventListener('click', () => {
        confirmAction('Xóa Log Gian Lận', 'Xóa tất cả nhật ký gian lận?<br><small style="color:var(--color-text-dark)">Hành động này không thể hoàn tác.</small>', async () => {
            const res = await apiRequest('/api/admin/clear-fraud', 'DELETE');
            if (res.success) {
                showToast('Đã xóa toàn bộ log gian lận.', 'success');
                loadData();
            } else {
                showToast(`Lỗi: ${res.data?.message || 'Unknown error'}`, 'error');
            }
        });
    });

    // ==========================================
    // TOAST & MODAL UTILS
    // ==========================================
    function showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;

        const icons = {
            success: 'fa-circle-check',
            error: 'fa-triangle-exclamation',
            info: 'fa-info-circle'
        };

        toast.innerHTML = `
            <i class="fa-solid ${icons[type] || icons.info}"></i>
            <span class="toast-message">${message}</span>
        `;
        container.appendChild(toast);
        requestAnimationFrame(() => toast.classList.add('show'));

        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 400);
        }, 3500);
    }

    function confirmAction(title, message, callback) {
        modalTitle.innerText = title;
        modalMessage.innerHTML = message;
        confirmModal.classList.remove('hidden');
        state.currentModalAction = callback;
    }

    modalBtnCancel.addEventListener('click', () => {
        confirmModal.classList.add('hidden');
        state.currentModalAction = null;
    });

    modalBtnConfirm.addEventListener('click', () => {
        confirmModal.classList.add('hidden');
        if (state.currentModalAction) state.currentModalAction();
        state.currentModalAction = null;
    });

    // Close modal on backdrop click
    confirmModal.addEventListener('click', (e) => {
        if (e.target === confirmModal) {
            confirmModal.classList.add('hidden');
            state.currentModalAction = null;
        }
    });

    // Close modal on Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !confirmModal.classList.contains('hidden')) {
            confirmModal.classList.add('hidden');
            state.currentModalAction = null;
        }
    });

    // XSS protection
    function escapeHTML(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // Launch
    init();
});
