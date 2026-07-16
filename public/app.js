/**
 * ServerKey Cloud Business Control Center v4.7
 * Real-state owner dashboard for licenses, devices and remote client policy.
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
        health: null,
        moduleErrors: {},
        currentView: localStorage.getItem('dashboard_view') || 'overview',
        stats: { total: 0, unactivated: 0, activated: 0, expired: 0, banned: 0, fraudAlerts: 0, totalTokens: 0, devices: 0, activeSessions: 0 },
        selectedDuration: 1,
        selectedTokenId: null,
        integrationPackage: null,
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
    const systemBanner = document.getElementById('system-banner');
    const systemBannerIcon = document.getElementById('system-banner-icon');
    const systemBannerTitle = document.getElementById('system-banner-title');
    const systemBannerMessage = document.getElementById('system-banner-message');
    const currentViewTitle = document.getElementById('current-view-title');
    const currentViewDescription = document.getElementById('current-view-description');
    const currentDateLabel = document.getElementById('current-date-label');
    const overviewStatusTitle = document.getElementById('overview-status-title');
    const overviewStatusCopy = document.getElementById('overview-status-copy');
    const overviewRevision = document.getElementById('overview-revision');
    const navLicenseCount = document.getElementById('nav-license-count');
    const navDeviceCount = document.getElementById('nav-device-count');
    const navAlertCount = document.getElementById('nav-alert-count');

    // Token management elements
    const tokenForm = document.getElementById('token-form');
    const tokenNameInput = document.getElementById('token-name-input');
    const tokenMaxDaysInput = document.getElementById('token-max-days-input');
    const tokenDisplayTextInput = document.getElementById('token-display-text-input');
    const tokenDescInput = document.getElementById('token-desc-input');
    const createTokenBtn = document.getElementById('create-token-btn');
    const tokensTableBody = document.getElementById('tokens-table-body');

    // Universal Project Connect elements
    const integrationProductInput = document.getElementById('integration-product-input');
    const integrationProjectInput = document.getElementById('integration-project-input');
    const integrationVersionInput = document.getElementById('integration-version-input');
    const generateIntegrationBtn = document.getElementById('generate-integration-btn');
    const integrationResult = document.getElementById('integration-result');
    const integrationProductLabel = document.getElementById('integration-product-label');
    const integrationUriOutput = document.getElementById('integration-uri-output');
    const integrationCodeOutput = document.getElementById('integration-code-output');
    const integrationBootstrapOutput = document.getElementById('integration-bootstrap-output');
    const copyIntegrationUriBtn = document.getElementById('copy-integration-uri');
    const copyIntegrationCodeBtn = document.getElementById('copy-integration-code');
    const downloadSdkZipBtn = document.getElementById('download-sdk-zip');

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
    const modalReasonGroup = document.getElementById('modal-reason-group');
    const modalReasonInput = document.getElementById('modal-reason-input');

    // Control plane elements
    const menuEnabledInput = document.getElementById('menu-enabled-input');
    const maintenanceModeInput = document.getElementById('maintenance-mode-input');
    const autoUpdateEnabledInput = document.getElementById('auto-update-enabled-input');
    const minimumVersionInput = document.getElementById('minimum-version-input');
    const latestVersionInput = document.getElementById('latest-version-input');
    const updateUrlInput = document.getElementById('update-url-input');
    const heartbeatIntervalInput = document.getElementById('heartbeat-interval-input');
    const announcementInput = document.getElementById('announcement-input');
    const notificationTargetInput = document.getElementById('notification-target-input');
    const notificationTitleInput = document.getElementById('notification-title-input');
    const notificationCharacterCount = document.getElementById('notification-character-count');
    const notificationSendStatus = document.getElementById('notification-send-status');
    const configRevision = document.getElementById('config-revision');
    const saveControlBtn = document.getElementById('save-control-btn');
    const sendNotificationBtn = document.getElementById('send-notification-btn');
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
    let currentModalOptions = {};

    const viewMeta = {
        overview: {
            title: 'Tổng quan hệ thống',
            description: 'Trạng thái vận hành và chính sách client theo thời gian thực.'
        },
        licenses: {
            title: 'Sản phẩm & Licenses',
            description: 'Tạo package, phát hành license và quản lý vòng đời truy cập.'
        },
        devices: {
            title: 'Thiết bị khách hàng',
            description: 'Theo dõi thiết bị, phiên bản client, license liên kết và trạng thái khóa.'
        },
        features: {
            title: 'Menu Control',
            description: 'Điều khiển feature flags và trạng thái hiển thị trên client.'
        },
        security: {
            title: 'Sessions & Bảo mật',
            description: 'Giám sát heartbeat, thu hồi phiên và xem sự kiện bảo mật thực tế.'
        }
    };

    // ==========================================
    // INITIALIZATION & SESSION CONTROL
    // ==========================================
    function init() {
        currentDateLabel.textContent = new Intl.DateTimeFormat('vi-VN', {
            weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric'
        }).format(new Date());
        setActiveView(viewMeta[state.currentView] ? state.currentView : 'overview', false);
        if (state.adminToken) {
            verifyTokenAndStart();
        } else {
            showLogin();
        }
    }

    async function verifyTokenAndStart() {
        showLoadingState();
        const result = await loadData();
        if (result.success) {
            showDashboard();
            startAutoRefresh();
            if (result.partial) {
                showToast(`Đã đăng nhập nhưng ${result.failedModules.length} khu vực chưa tải được.`, 'warning');
            }
        } else if (result.unauthorized) {
            showToast('Phiên quản trị đã hết hạn hoặc không hợp lệ.', 'error');
            clearSession();
            showLogin();
        } else {
            showToast(result.message || 'Không tải được dữ liệu hệ thống.', 'error');
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
        setActiveView(state.currentView, false);
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

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        const config = { method, headers, signal: controller.signal };
        if (body) config.body = JSON.stringify(body);

        try {
            const response = await fetch(endpoint, config);
            const raw = await response.text();
            let data = {};
            if (raw) {
                try {
                    data = JSON.parse(raw);
                } catch {
                    data = { message: `Máy chủ trả dữ liệu không hợp lệ (HTTP ${response.status}).` };
                }
            }
            return {
                success: response.ok,
                unauthorized: response.status === 401 || response.status === 403,
                status: response.status,
                data,
                message: data.message || `HTTP ${response.status}`,
                endpoint
            };
        } catch (error) {
            console.error(`API request failed [${endpoint}]:`, error);
            return {
                success: false,
                networkError: true,
                status: 0,
                endpoint,
                message: error.name === 'AbortError'
                    ? 'Yêu cầu hết thời gian chờ sau 15 giây.'
                    : 'Không thể kết nối đến máy chủ.'
            };
        } finally {
            clearTimeout(timeoutId);
        }
    }

    async function loadHealth() {
        const result = await apiRequest('/api/health');
        state.health = result.data || null;
        return result;
    }

    async function loadData() {
        updateApiStatus('loading', 'Đang đồng bộ');
        const endpointMap = {
            keys: '/api/admin/get-keys',
            fraud: '/api/admin/get-fraud',
            stats: '/api/admin/stats',
            tokens: '/api/admin/get-tokens',
            control: '/api/admin/control-config',
            devices: '/api/admin/devices',
            sessions: '/api/admin/sessions'
        };
        const names = Object.keys(endpointMap);
        const [healthResult, ...responses] = await Promise.all([
            loadHealth(),
            ...names.map(name => apiRequest(endpointMap[name]))
        ]);
        const modules = Object.fromEntries(names.map((name, index) => [name, responses[index]]));
        state.moduleErrors = Object.fromEntries(
            Object.entries(modules)
                .filter(([, result]) => !result.success)
                .map(([name, result]) => [name, result.message])
        );

        const unauthorized = Object.values(modules).some(result => result.unauthorized);
        if (unauthorized) {
            updateApiStatus('offline', 'Phiên không hợp lệ');
            return { success: false, unauthorized: true, message: 'Phiên quản trị không hợp lệ.' };
        }

        if (modules.keys.success) state.keysList = modules.keys.data.keys || [];
        if (modules.fraud.success) state.fraudLogs = modules.fraud.data.logs || [];
        if (modules.stats.success) state.stats = modules.stats.data.stats || state.stats;
        if (modules.tokens.success) state.tokensList = modules.tokens.data.tokens || [];
        if (modules.control.success) {
            state.controlConfig = modules.control.data.config || null;
            state.featureFlags = Object.entries(modules.control.data.features || {})
                .map(([feature_key, flag]) => ({ feature_key, ...flag }));
        }
        if (modules.devices.success) state.devices = modules.devices.data.devices || [];
        if (modules.sessions.success) state.sessions = modules.sessions.data.sessions || [];

        renderStats();
        renderKeys();
        renderFraudLogs();
        renderTokens();
        renderTokenSelect();
        renderIntegrationProducts();
        renderControlPlane();
        renderFeatureFlags();
        renderDevices();
        renderSessions();
        renderNavigationCounts();

        const failedModules = Object.keys(state.moduleErrors);
        const criticalReady = modules.keys.success && modules.tokens.success;
        updateSystemState(healthResult, failedModules);
        return {
            success: criticalReady,
            partial: criticalReady && failedModules.length > 0,
            failedModules,
            message: criticalReady ? '' : (modules.keys.message || modules.tokens.message || 'Không tải được dữ liệu licenses.')
        };
    }

    async function loadTokens() {
        const res = await apiRequest('/api/admin/get-tokens');
        if (res.success) {
            state.tokensList = res.data.tokens || [];
            renderTokens();
            renderTokenSelect();
        }
    }

    function updateApiStatus(mode, label) {
        statusIndicator.classList.remove('status-loading', 'status-online', 'status-degraded', 'status-offline');
        statusIndicator.classList.add(`status-${mode}`);
        apiStatusText.textContent = label;
    }

    function updateSystemState(healthResult, failedModules) {
        const health = healthResult.data || null;
        const schemaReady = Boolean(health?.schema_ready);
        const healthOnline = healthResult.status > 0;
        systemBanner.classList.remove('hidden', 'is-warning', 'is-error', 'is-success');

        if (!healthOnline) {
            updateApiStatus('offline', 'Mất kết nối');
            systemBanner.classList.add('is-error');
            systemBannerIcon.className = 'fa-solid fa-cloud-bolt';
            systemBannerTitle.textContent = 'Không thể kết nối API';
            systemBannerMessage.textContent = healthResult.message;
            overviewStatusTitle.textContent = 'Chưa xác nhận được trạng thái hệ thống';
            overviewStatusCopy.textContent = healthResult.message;
        } else if (!schemaReady) {
            updateApiStatus('degraded', 'Cần migration');
            systemBanner.classList.add('is-warning');
            systemBannerIcon.className = 'fa-solid fa-database';
            systemBannerTitle.textContent = health?.status === 'migration_required' ? 'Database chưa sẵn sàng' : 'Hệ thống đang ở trạng thái giới hạn';
            systemBannerMessage.textContent = health?.message || 'API chưa xác nhận schema database.';
            overviewStatusTitle.textContent = 'Cần hoàn tất database migration';
            overviewStatusCopy.textContent = health?.message || 'Một số module sẽ chưa hoạt động cho đến khi schema sẵn sàng.';
        } else if (failedModules.length > 0) {
            updateApiStatus('degraded', `${failedModules.length} module lỗi`);
            systemBanner.classList.add('is-warning');
            systemBannerIcon.className = 'fa-solid fa-triangle-exclamation';
            systemBannerTitle.textContent = 'Dữ liệu chỉ được tải một phần';
            systemBannerMessage.textContent = `Không tải được: ${failedModules.join(', ')}. Các khu vực khác vẫn dùng dữ liệu thật từ API.`;
            overviewStatusTitle.textContent = 'Một số module chưa đồng bộ';
            overviewStatusCopy.textContent = systemBannerMessage.textContent;
        } else {
            updateApiStatus('online', 'Hệ thống online');
            systemBanner.classList.add('hidden');
            overviewStatusTitle.textContent = 'Hệ thống đang vận hành ổn định';
            overviewStatusCopy.textContent = 'API, database và các module quản trị đã phản hồi thành công.';
        }

        overviewRevision.textContent = state.controlConfig
            ? `Config revision ${state.controlConfig.config_revision || 1}`
            : 'Config revision —';
    }

    function startAutoRefresh() {
        stopAutoRefresh();
        refreshIntervalId = setInterval(async () => {
            const result = await loadData();
            if (result.unauthorized) {
                clearSession();
                showLogin();
                showToast('Phiên quản trị đã hết hạn. Vui lòng đăng nhập lại.', 'error');
            }
        }, 30000);
    }

    function stopAutoRefresh() {
        if (refreshIntervalId) {
            clearInterval(refreshIntervalId);
            refreshIntervalId = null;
        }
    }

    function setActiveView(view, shouldScroll = true) {
        const selected = viewMeta[view] ? view : 'overview';
        state.currentView = selected;
        localStorage.setItem('dashboard_view', selected);
        document.querySelectorAll('.dashboard-nav-item').forEach(button => {
            const active = button.dataset.view === selected;
            button.classList.toggle('active', active);
            button.setAttribute('aria-current', active ? 'page' : 'false');
        });
        document.querySelectorAll('[data-view-section]').forEach(section => {
            section.classList.toggle('view-hidden', section.dataset.viewSection !== selected);
        });
        currentViewTitle.textContent = viewMeta[selected].title;
        currentViewDescription.textContent = viewMeta[selected].description;
        if (shouldScroll) {
            document.querySelector('.page-heading').scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }

    function renderNavigationCounts() {
        navLicenseCount.textContent = state.moduleErrors.stats && state.moduleErrors.keys
            ? '—'
            : String(state.moduleErrors.stats ? state.keysList.length : (state.stats.total || 0));
        navDeviceCount.textContent = state.moduleErrors.stats && state.moduleErrors.devices
            ? '—'
            : String(state.moduleErrors.stats ? state.devices.length : (state.stats.devices || 0));
        navAlertCount.textContent = state.moduleErrors.stats && state.moduleErrors.fraud
            ? '—'
            : String(state.moduleErrors.stats ? state.fraudLogs.length : (state.stats.fraudAlerts || 0));
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
    function tableErrorRow(message, colspan) {
        return `<tr class="module-error-row"><td colspan="${colspan}" class="loading-state"><i class="fa-solid fa-circle-exclamation"></i> ${escapeHTML(message)}</td></tr>`;
    }

    function renderStats() {
        document.querySelectorAll('[data-stat]').forEach(el => {
            const key = el.getAttribute('data-stat');
            if (state.moduleErrors.stats) {
                el.textContent = '—';
                el.title = state.moduleErrors.stats;
            } else if (state.stats[key] !== undefined) {
                el.removeAttribute('title');
                animateCounter(el, state.stats[key]);
            }
        });

        // Fraud card glow on stat card
        const fraudStatCard = document.getElementById('stat-fraud');
        if (!state.moduleErrors.stats && state.stats.fraudAlerts > 0) {
            fraudStatCard.style.borderColor = 'rgba(244, 63, 94, 0.3)';
        } else {
            fraudStatCard.style.borderColor = '';
        }
    }

    function renderTokens() {
        if (state.moduleErrors.tokens) {
            tokensTableBody.innerHTML = tableErrorRow(state.moduleErrors.tokens, 6);
            return;
        }
        if (state.tokensList.length === 0) {
            tokensTableBody.innerHTML = `
                <tr>
                    <td colspan="6" class="loading-state">
                        <i class="fa-solid fa-cube" style="opacity:0.3;"></i> Chưa có sản phẩm nào
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
                    <td data-label="Package"><strong>${escapeHTML(token.token_name)}</strong></td>
                    <td data-label="Token" class="key-string-cell">${escapeHTML(token.token_string || token.id)}</td>
                    <td data-label="Max days">${maxDaysDisplay}</td>
                    <td data-label="Display text"><span style="font-size:12px; font-family:var(--font-mono); color: var(--color-primary);">${escapeHTML(token.display_text || 'ServerKey by #wtuananh6868')}</span></td>
                    <td data-label="Mô tả"><span style="font-size:12px; color: var(--color-text-muted);">${escapeHTML(token.description || '')}</span></td>
                    <td data-label="Hành động" class="actions-cell">
                        <button class="btn btn-danger-outline btn-sm action-delete-token" data-token-id="${token.id}" title="Xóa sản phẩm">
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
                confirmAction('Xóa sản phẩm', `<strong style="color:var(--color-danger)">Hành động không thể hoàn tác!</strong><br>Xóa sản phẩm: <strong>${escapeHTML(tokenName)}</strong>?<br><small style="color:var(--color-text-dark)">Các license liên kết cũng sẽ bị xóa.</small>`, async () => {
                    const res = await apiRequest('/api/admin/delete-token', 'DELETE', { token_id: tokenId });
                    if (res.success) {
                        showToast(`Đã xóa sản phẩm "${tokenName}".`, 'success');
                        loadData();
                    } else {
                        showToast(res.message || 'Không thể xóa package.', 'error');
                    }
                });
            });
        });
    }

    function renderTokenSelect() {
        if (state.moduleErrors.tokens) {
            tokenSelect.innerHTML = '<option value="" selected>Không tải được danh sách sản phẩm</option>';
            tokenSelect.disabled = true;
            createKeyBtn.disabled = true;
            state.selectedTokenId = null;
            return;
        }

        tokenSelect.disabled = false;
        createKeyBtn.disabled = false;
        // Preserve current selection if possible
        const prevSelected = state.selectedTokenId;

        // Clear existing options except default
        tokenSelect.innerHTML = '<option value="" disabled>-- Chọn sản phẩm --</option>';

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
            state.selectedTokenId = String(state.tokensList[0].id);
            updatePresetStates();
        } else if (prevSelected && state.tokensList.find(t => String(t.id) === String(prevSelected))) {
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
        return state.tokensList.find(t => String(t.id) === String(state.selectedTokenId)) || null;
    }

    function renderIntegrationProducts() {
        const selected = integrationProductInput.value;
        if (state.moduleErrors.tokens) {
            integrationProductInput.innerHTML = '<option value="">Không tải được sản phẩm</option>';
            integrationProductInput.disabled = true;
            generateIntegrationBtn.disabled = true;
            return;
        }
        integrationProductInput.disabled = false;
        generateIntegrationBtn.disabled = state.tokensList.length === 0;
        integrationProductInput.innerHTML = '<option value="">Chọn sản phẩm</option>' +
            state.tokensList.map(token =>
                `<option value="${escapeHTML(token.token_string)}">${escapeHTML(token.token_name)}</option>`
            ).join('');
        if ([...integrationProductInput.options].some(option => option.value === selected)) {
            integrationProductInput.value = selected;
        } else if (state.tokensList.length === 1) {
            integrationProductInput.value = state.tokensList[0].token_string;
        }
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
            tokenWarning.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Sản phẩm "${escapeHTML(token.token_name)}" giới hạn tối đa ${token.max_days} ngày`;
            return false;
        }

        tokenWarning.classList.add('hidden');
        tokenWarning.textContent = '';
        return true;
    }

    function renderKeys() {
        if (state.moduleErrors.keys) {
            keysTableBody.innerHTML = tableErrorRow(state.moduleErrors.keys, 8);
            return;
        }
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
                        <i class="fa-solid fa-folder-open" style="opacity:0.3;"></i> Không tìm thấy license nào
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
                actionButtons += `<button class="btn btn-outline btn-sm action-reset-hwid" data-key="${escapeHTML(key.key_string)}" title="Reset HWID">
                    <i class="fa-solid fa-arrows-rotate"></i>
                </button>`;
            }

            // Ban/Unban button
            if (key.status === 'banned') {
                actionButtons += `<button class="btn btn-warning-outline btn-sm action-unban-key" data-key="${escapeHTML(key.key_string)}" title="Mở khóa Key">
                    <i class="fa-solid fa-lock-open"></i>
                </button>`;
            } else {
                actionButtons += `<button class="btn btn-danger-outline btn-sm action-ban-key" data-key="${escapeHTML(key.key_string)}" title="Khóa Key">
                    <i class="fa-solid fa-ban"></i>
                </button>`;
            }

            // Delete button
            actionButtons += `<button class="btn btn-danger-outline btn-sm action-delete-key" data-key="${escapeHTML(key.key_string)}" title="Xóa Key">
                <i class="fa-solid fa-trash-can"></i>
            </button>`;

            return `
                <tr>
                    <td data-label="License" class="key-string-cell">${escapeHTML(key.key_string)}</td>
                    <td data-label="Package">${tokenDisplay}</td>
                    <td data-label="Thời hạn">${durationDisplay}</td>
                    <td data-label="Hết hạn" style="font-size:12px;">${expiryDisplay}</td>
                    <td data-label="Thiết bị">${deviceDisplay}</td>
                    <td data-label="Trạng thái">${statusBadge}</td>
                    <td data-label="Ghi chú"><span style="font-size:12px; color: var(--color-text-muted);">${escapeHTML(key.note || '—')}</span></td>
                    <td data-label="Hành động" class="actions-cell">${actionButtons}</td>
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
                confirmAction('Đặt lại HWID', `Reset Hardware ID cho Key: <strong>${escapeHTML(key)}</strong>?<br><small style="color:var(--color-text-dark)">Khách hàng sẽ kích hoạt được thiết bị mới.</small>`, async () => {
                    const res = await apiRequest('/api/admin/reset-hwid', 'POST', { key_string: key });
                    if (res.success) {
                        showToast(`Reset HWID cho ${key} thành công.`, 'success');
                        loadData();
                    } else {
                        showToast(res.message || 'Không thể reset HWID.', 'error');
                    }
                });
            });
        });

        // Ban key
        document.querySelectorAll('.action-ban-key').forEach(btn => {
            btn.addEventListener('click', () => {
                const key = btn.getAttribute('data-key');
                confirmAction('Khóa Key', `Bạn muốn <strong>cấm</strong> Key: <strong>${escapeHTML(key)}</strong>?<br><small style="color:var(--color-text-dark)">Session đang hoạt động cũng sẽ bị thu hồi.</small>`, async () => {
                    const res = await apiRequest('/api/admin/ban-key', 'POST', { key_string: key, action: 'ban' });
                    if (res.success) {
                        showToast(`Đã khóa Key ${key}.`, 'success');
                        loadData();
                    } else {
                        showToast(res.message || 'Không thể khóa license.', 'error');
                    }
                });
            });
        });

        // Unban key
        document.querySelectorAll('.action-unban-key').forEach(btn => {
            btn.addEventListener('click', () => {
                const key = btn.getAttribute('data-key');
                confirmAction('Mở khóa Key', `Mở khóa Key: <strong>${escapeHTML(key)}</strong>?<br><small style="color:var(--color-text-dark)">Key sẽ trở về trạng thái sẵn sàng, HWID sẽ được reset.</small>`, async () => {
                    const res = await apiRequest('/api/admin/ban-key', 'POST', { key_string: key, action: 'unban' });
                    if (res.success) {
                        showToast(`Đã mở khóa Key ${key}.`, 'success');
                        loadData();
                    } else {
                        showToast(res.message || 'Không thể mở khóa license.', 'error');
                    }
                });
            });
        });

        // Delete key
        document.querySelectorAll('.action-delete-key').forEach(btn => {
            btn.addEventListener('click', () => {
                const key = btn.getAttribute('data-key');
                confirmAction('Xóa Key', `<strong style="color:var(--color-danger)">Hành động không thể hoàn tác!</strong><br>Xóa vĩnh viễn Key: <strong>${escapeHTML(key)}</strong>?`, async () => {
                    const res = await apiRequest('/api/admin/delete-key', 'DELETE', { key_string: key });
                    if (res.success) {
                        showToast(`Đã xóa Key ${key}.`, 'success');
                        loadData();
                    } else {
                        showToast(res.message || 'Không thể xóa license.', 'error');
                    }
                });
            });
        });
    }

    function renderFraudLogs() {
        if (state.moduleErrors.fraud) {
            fraudLogsEmpty.classList.remove('hidden');
            fraudLogsList.classList.add('hidden');
            fraudCard.classList.remove('has-fraud');
            clearFraudBtn.classList.add('hidden');
            fraudSubtitle.textContent = state.moduleErrors.fraud;
            fraudLogsEmpty.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i><p>${escapeHTML(state.moduleErrors.fraud)}</p>`;
            return;
        }
        if (state.fraudLogs.length === 0) {
            fraudLogsEmpty.classList.remove('hidden');
            fraudLogsList.classList.add('hidden');
            fraudCard.classList.remove('has-fraud');
            clearFraudBtn.classList.add('hidden');
            fraudSubtitle.innerText = 'Không có vi phạm mới được phát hiện';
            fraudLogsEmpty.innerHTML = '<i class="fa-solid fa-shield-halved"></i><p>Không có hoạt động gian lận</p>';
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
        const inputs = [menuEnabledInput, maintenanceModeInput, autoUpdateEnabledInput,
            minimumVersionInput, latestVersionInput, updateUrlInput,
            heartbeatIntervalInput];

        if (state.moduleErrors.control) {
            inputs.forEach(input => { input.disabled = true; });
            configRevision.textContent = 'Revision —';
            controlSaveStatus.textContent = state.moduleErrors.control;
            saveControlBtn.disabled = true;
            return;
        }

        if (!config) {
            inputs.forEach(input => { input.disabled = true; });
            configRevision.textContent = 'Revision —';
            controlSaveStatus.textContent = 'API chưa trả về remote policy.';
            saveControlBtn.disabled = true;
            return;
        }

        inputs.forEach(input => { input.disabled = false; });
        saveControlBtn.disabled = false;

        menuEnabledInput.checked = Boolean(config.menu_enabled);
        maintenanceModeInput.checked = Boolean(config.maintenance_mode);
        autoUpdateEnabledInput.checked = Boolean(config.auto_update_enabled);
        minimumVersionInput.value = config.minimum_version || '1.0.0';
        latestVersionInput.value = config.latest_version || '1.0.0';
        updateUrlInput.value = config.update_url || '';
        heartbeatIntervalInput.value = config.heartbeat_interval_seconds || 45;
        configRevision.textContent = `Revision ${config.config_revision || 1}`;
        controlSaveStatus.textContent = `Cập nhật: ${formatDateTime(config.updated_at)}`;
    }

    function renderFeatureFlags() {
        if (state.moduleErrors.control) {
            featureFlagsTableBody.innerHTML = tableErrorRow(state.moduleErrors.control, 7);
            saveFeatureBtn.disabled = true;
            return;
        }
        saveFeatureBtn.disabled = false;
        const flags = [...state.featureFlags].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
        if (flags.length === 0) {
            featureFlagsTableBody.innerHTML = '<tr><td colspan="7" class="loading-state">Chưa có feature flag</td></tr>';
            return;
        }

        featureFlagsTableBody.innerHTML = flags.map(flag => `
            <tr>
                <td data-label="Feature key" class="mono-value">${escapeHTML(flag.feature_key)}</td>
                <td data-label="Tên"><strong>${escapeHTML(flag.display_name)}</strong></td>
                <td data-label="Mô tả" class="muted-value">${escapeHTML(flag.description || '')}</td>
                <td data-label="Enabled"><span class="flag-state ${flag.enabled ? 'is-on' : ''}">${flag.enabled ? 'ON' : 'OFF'}</span></td>
                <td data-label="Locked"><span class="flag-state ${flag.locked ? 'is-locked' : ''}">${flag.locked ? 'LOCKED' : 'OPEN'}</span></td>
                <td data-label="Thứ tự">${Number(flag.sort_order) || 0}</td>
                <td data-label="Hành động" class="actions-cell">
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
                        showToast(res.message || 'Không thể xóa flag.', 'error');
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
        showToast(res.message || 'Không thể lưu feature flag.', 'error');
        return false;
    }

    function renderDevices() {
        if (state.moduleErrors.devices) {
            devicesTableBody.innerHTML = tableErrorRow(state.moduleErrors.devices, 10);
            return;
        }
        renderNotificationTargets();
        const query = (deviceSearchInput.value || '').trim().toLowerCase();
        const devices = state.devices.filter(device => {
            if (!query) return true;
            const licenses = (device.licenses || []).map(item => item.key_string).join(' ');
            return `${device.device_name || ''} ${device.project_id || ''} ${device.hwid} ${device.app_version || ''} ${licenses}`.toLowerCase().includes(query);
        });

        if (devices.length === 0) {
            devicesTableBody.innerHTML = '<tr><td colspan="10" class="loading-state">Không tìm thấy thiết bị</td></tr>';
            return;
        }

        devicesTableBody.innerHTML = devices.map(device => {
            const licenses = (device.licenses || []).length
                ? `<div class="license-stack">${device.licenses.map(item => `<span class="license-chip" title="${escapeHTML(item.key_string)}">${escapeHTML(item.key_string)}</span>`).join('')}</div>`
                : '<span class="muted-value">—</span>';
            const banned = device.status === 'banned';
            return `
                <tr>
                    <td data-label="Tên thiết bị"><strong>${escapeHTML(device.device_name || 'Android device')}</strong></td>
                    <td data-label="Project"><span class="project-chip">${escapeHTML(device.project_id || 'legacy')}</span></td>
                    <td data-label="Device ID"><span class="mono-value">${escapeHTML(device.hwid)}</span></td>
                    <td data-label="Version">${escapeHTML(device.app_version || '—')}</td>
                    <td data-label="Licenses">${licenses}</td>
                    <td data-label="Sessions">${Number(device.active_sessions) || 0}</td>
                    <td data-label="Last seen" class="muted-value">${formatDateTime(device.last_seen_at)}</td>
                    <td data-label="Trạng thái"><span class="status-pill ${banned ? 'status-banned' : 'status-active'}">${banned ? 'Banned' : 'Active'}</span></td>
                    <td data-label="Lý do" class="muted-value">${escapeHTML(device.ban_reason || '—')}</td>
                    <td data-label="Hành động" class="actions-cell">
                        <button class="btn btn-outline btn-sm action-device-notify" data-device-id="${device.id}">
                            <i class="fa-solid fa-bell"></i> Thông báo
                        </button>
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
                confirmAction(`${nextStatus === 'banned' ? 'Khóa' : 'Mở khóa'} thiết bị`, `${actionText} <strong>${escapeHTML(device.hwid)}</strong>?`, async (reason = '') => {
                    const res = await apiRequest('/api/admin/device-status', 'POST', {
                        device_id: deviceId,
                        status: nextStatus,
                        reason
                    });
                    if (res.success) {
                        showToast(`Đã ${actionText} thiết bị.`, 'success');
                        loadData();
                    } else {
                        showToast(res.message || `Không thể ${actionText} thiết bị.`, 'error');
                    }
                }, {
                    reasonRequired: nextStatus === 'banned',
                    reasonPlaceholder: 'VD: Vi phạm chính sách sử dụng'
                });
            });
        });
        document.querySelectorAll('.action-device-notify').forEach(button => {
            button.addEventListener('click', () => {
                notificationTargetInput.value = button.dataset.deviceId;
                setActiveView('overview');
                announcementInput.focus();
                document.querySelector('.notification-command-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            });
        });
    }

    function renderNotificationTargets() {
        const selected = notificationTargetInput.value;
        notificationTargetInput.innerHTML = '<option value="">Tất cả client · All clients</option>' +
            state.devices.map(device => {
                const name = device.device_name || 'Android device';
                const shortId = String(device.hwid || '').slice(0, 12);
                return `<option value="${Number(device.id)}">${escapeHTML(name)} · ${escapeHTML(shortId)}…</option>`;
            }).join('');
        if ([...notificationTargetInput.options].some(option => option.value === selected)) {
            notificationTargetInput.value = selected;
        }
    }

    function renderSessions() {
        if (state.moduleErrors.sessions) {
            sessionsTableBody.innerHTML = tableErrorRow(state.moduleErrors.sessions, 8);
            return;
        }
        if (state.sessions.length === 0) {
            sessionsTableBody.innerHTML = '<tr><td colspan="8" class="loading-state">Chưa có client session</td></tr>';
            return;
        }

        sessionsTableBody.innerHTML = state.sessions.map(session => {
            const statusClass = session.status === 'active' ? 'status-active' : session.status === 'revoked' ? 'status-revoked' : 'status-expired';
            return `
                <tr>
                    <td data-label="Session" class="mono-value">#${session.id}</td>
                    <td data-label="Device">
                        <strong>${escapeHTML(session.device?.device_name || 'Android device')}</strong>
                        <span class="project-chip">${escapeHTML(session.device?.project_id || 'legacy')}</span>
                        <span class="mono-value muted-value device-id-secondary">${escapeHTML(session.device?.hwid || '—')}</span>
                    </td>
                    <td data-label="License">${escapeHTML(session.license?.key_string || '—')}</td>
                    <td data-label="Version">${escapeHTML(session.device?.app_version || '—')}</td>
                    <td data-label="Last seen" class="muted-value">${formatDateTime(session.last_seen_at)}</td>
                    <td data-label="Hết hạn">${formatDateTime(session.expires_at)}</td>
                    <td data-label="Trạng thái"><span class="status-pill ${statusClass}">${escapeHTML(session.status)}</span></td>
                    <td data-label="Hành động" class="actions-cell">
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
                        showToast(res.message || 'Không thể thu hồi session.', 'error');
                    }
                });
            });
        });
    }

    // ==========================================
    // EVENT LISTENERS
    // ==========================================

    document.querySelectorAll('.dashboard-nav-item').forEach(button => {
        button.addEventListener('click', () => setActiveView(button.dataset.view));
    });
    document.querySelectorAll('.quick-nav').forEach(button => {
        button.addEventListener('click', () => setActiveView(button.dataset.targetView));
    });

    generateIntegrationBtn.addEventListener('click', async () => {
        const productToken = integrationProductInput.value;
        const projectId = integrationProjectInput.value.trim();
        const appVersion = integrationVersionInput.value.trim();
        if (!productToken) {
            showToast('Hãy chọn sản phẩm cần kết nối.', 'error');
            integrationProductInput.focus();
            return;
        }
        if (!/^[A-Za-z0-9._-]{2,64}$/.test(projectId)) {
            showToast('Project ID cần 2–64 ký tự: chữ, số, dấu chấm, gạch dưới hoặc gạch ngang.', 'error');
            integrationProjectInput.focus();
            return;
        }
        if (!/^\d+\.\d+\.\d+(?:[-+].*)?$/.test(appVersion)) {
            showToast('App Version phải theo semantic version, ví dụ 1.0.0.', 'error');
            integrationVersionInput.focus();
            return;
        }

        generateIntegrationBtn.disabled = true;
        downloadSdkZipBtn.disabled = true;
        state.integrationPackage = null;
        generateIntegrationBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>Đang tạo manifest…</span>';
        const res = await apiRequest('/api/admin/integration-manifest', 'POST', {
            product_token: productToken,
            project_id: projectId,
            app_version: appVersion
        });
        generateIntegrationBtn.disabled = false;
        generateIntegrationBtn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i><span>Tạo kết nối · Generate</span>';
        if (!res.success) {
            showToast(res.message || 'Không thể tạo integration manifest.', 'error');
            return;
        }

        const manifest = res.data.manifest;
        const connectionUri = manifest.connection_uri;
        const androidCode = [
            'import com.serverkey.sdk.ServerKeyPlatform;',
            '',
            '// Run after System.loadLibrary("your_native_library").',
            'ServerKeyPlatform serverKey = ServerKeyPlatform.create(',
            '        getApplicationContext(),',
            `        ${JSON.stringify(connectionUri)},`,
            `        ${JSON.stringify(appVersion)},`,
            '        this);',
            'serverKey.start();'
        ].join('\n');
        const bootstrapQuery = new URLSearchParams({
            project_id: projectId,
            app_version: appVersion
        });
        integrationUriOutput.value = connectionUri;
        integrationCodeOutput.textContent = androidCode;
        integrationBootstrapOutput.textContent =
            `${manifest.server.base_url}${manifest.server.bootstrap}?${bootstrapQuery}`;
        integrationProductLabel.textContent = manifest.project.product_name;
        state.integrationPackage = {
            product_token: productToken,
            project_id: projectId,
            app_version: appVersion
        };
        downloadSdkZipBtn.disabled = false;
        integrationResult.classList.remove('hidden');
        showToast('Connection manifest đã sẵn sàng để tích hợp.', 'success');
    });

    copyIntegrationUriBtn.addEventListener('click', () => {
        copyToClipboard(integrationUriOutput.value).then(() => {
            showToast('Đã sao chép connection URI.', 'success');
        });
    });

    copyIntegrationCodeBtn.addEventListener('click', () => {
        copyToClipboard(integrationCodeOutput.textContent).then(() => {
            showToast('Đã sao chép code tích hợp Android.', 'success');
        });
    });

    downloadSdkZipBtn.addEventListener('click', async () => {
        if (!state.integrationPackage || !state.adminToken) {
            showToast('Hãy Generate kết nối trước khi tải SDK.', 'error');
            return;
        }

        const originalHtml = downloadSdkZipBtn.innerHTML;
        downloadSdkZipBtn.disabled = true;
        downloadSdkZipBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang đóng gói…';
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);
        try {
            const response = await fetch('/api/admin/sdk-package', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${state.adminToken}`
                },
                body: JSON.stringify(state.integrationPackage),
                signal: controller.signal
            });
            if (!response.ok) {
                const raw = await response.text();
                let message = `Không thể tải SDK (HTTP ${response.status}).`;
                try { message = JSON.parse(raw).message || message; } catch {}
                throw new Error(message);
            }
            const blob = await response.blob();
            if (blob.size < 100 || !String(response.headers.get('content-type') || '').includes('application/zip')) {
                throw new Error('Server không trả về một SDK ZIP hợp lệ.');
            }
            const disposition = response.headers.get('content-disposition') || '';
            const serverFilename = disposition.match(/filename="?([^";]+)"?/i)?.[1];
            const fallbackFilename = `serverkey-${state.integrationPackage.project_id}-${state.integrationPackage.app_version}.zip`;
            const objectUrl = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = objectUrl;
            link.download = serverFilename || fallbackFilename;
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
            showToast('Full SDK ZIP đã được tải trực tiếp từ ServerKey.', 'success');
        } catch (error) {
            const message = error.name === 'AbortError'
                ? 'Đóng gói SDK quá thời gian chờ 30 giây.'
                : error.message;
            showToast(message, 'error');
        } finally {
            clearTimeout(timeoutId);
            downloadSdkZipBtn.disabled = !state.integrationPackage;
            downloadSdkZipBtn.innerHTML = originalHtml;
        }
    });

    [maintenanceModeInput, autoUpdateEnabledInput, minimumVersionInput,
        latestVersionInput, updateUrlInput, heartbeatIntervalInput]
        .forEach(input => input.addEventListener('input', () => {
            controlSaveStatus.textContent = 'Có thay đổi chưa lưu';
        }));

    async function persistControlPolicy() {
        const requestedMenuEnabled = menuEnabledInput.checked;
        const heartbeat = Number.parseInt(heartbeatIntervalInput.value, 10);
        if (!Number.isInteger(heartbeat) || heartbeat < 15 || heartbeat > 3600) {
            showToast('Heartbeat phải nằm trong khoảng 15–3600 giây.', 'error');
            heartbeatIntervalInput.focus();
            return false;
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
            heartbeat_interval_seconds: heartbeat
        });
        saveControlBtn.disabled = false;
        saveControlBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i><span>Lưu Remote Policy</span>';

        if (res.success) {
            if (Boolean(res.data.config?.menu_enabled) !== requestedMenuEnabled) {
                showToast('Server không xác nhận đúng trạng thái All Clients. Đang tải lại policy.', 'error');
                await loadData();
                return false;
            }
            state.controlConfig = res.data.config;
            renderControlPlane();
            showToast('Remote policy đã được cập nhật và xác nhận bởi server.', 'success');
            return true;
        }
        showToast(res.message || 'Không thể lưu remote policy.', 'error');
        return false;
    }

    saveControlBtn.addEventListener('click', persistControlPolicy);

    menuEnabledInput.addEventListener('change', async () => {
        const requestedState = menuEnabledInput.checked;
        controlSaveStatus.textContent = requestedState
            ? 'Đang mở khóa toàn bộ client…'
            : 'Đang khóa toàn bộ client…';
        const saved = await persistControlPolicy();
        if (!saved) menuEnabledInput.checked = !requestedState;
    });

    announcementInput.addEventListener('input', () => {
        notificationCharacterCount.textContent = `${announcementInput.value.length} / 700`;
    });

    sendNotificationBtn.addEventListener('click', async () => {
        const message = announcementInput.value.trim();
        if (!message) {
            showToast('Hãy nhập nội dung thông báo trước khi gửi.', 'error');
            announcementInput.focus();
            return;
        }
        const selectedDevice = notificationTargetInput.value;
        sendNotificationBtn.disabled = true;
        notificationSendStatus.textContent = 'Đang chuyển thông báo tới ServerKey…';
        sendNotificationBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>Đang gửi…</span>';
        const res = await apiRequest('/api/admin/notifications', 'POST', {
            device_id: selectedDevice ? Number(selectedDevice) : null,
            title: notificationTitleInput.value.trim() || 'ServerKey',
            message
        });
        sendNotificationBtn.disabled = false;
        sendNotificationBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i><span>Gửi thông báo · Send</span>';
        if (res.success) {
            const targetLabel = selectedDevice
                ? notificationTargetInput.options[notificationTargetInput.selectedIndex].textContent
                : 'tất cả client';
            notificationSendStatus.textContent = `Đã xếp hàng cho ${targetLabel}`;
            announcementInput.value = '';
            notificationCharacterCount.textContent = '0 / 700';
            showToast(`Thông báo đã gửi tới ${targetLabel}; client nhận ở heartbeat kế tiếp.`, 'success');
            return;
        }
        notificationSendStatus.textContent = 'Gửi thất bại · nội dung vẫn được giữ lại';
        showToast(res.message || 'Không thể gửi thông báo.', 'error');
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
        let loginError = '';
        try {
            const response = await fetch('/api/admin/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: pwd })
            });
            const raw = await response.text();
            loginData = raw ? JSON.parse(raw) : null;
            if (!response.ok) loginError = loginData?.message || `Đăng nhập thất bại (HTTP ${response.status}).`;
        } catch (error) {
            console.error('Admin login failed:', error);
            loginError = 'Không thể kết nối đến API đăng nhập.';
        }

        if (loginData?.success && loginData.token) {
            state.adminToken = loginData.token;
            localStorage.setItem('admin_token', loginData.token);
            const result = await loadData();
            showDashboard();
            startAutoRefresh();
            if (!result.success) {
                showToast(result.message || 'Đã đăng nhập nhưng không tải được dữ liệu dashboard.', 'error');
            } else if (result.partial) {
                showToast(`Đăng nhập thành công; chưa tải được: ${result.failedModules.join(', ')}.`, 'warning');
            } else {
                showToast('Đăng nhập và đồng bộ dữ liệu thành công.', 'success');
            }
        } else {
            clearSession();
            showToast(loginError || loginData?.message || 'Đăng nhập không thành công.', 'error');
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
        refreshBtn.disabled = true;
        const result = await loadData();
        refreshBtn.disabled = false;
        refreshBtn.querySelector('i').classList.remove('spin-animation');
        if (result.unauthorized) {
            clearSession();
            showLogin();
            showToast('Phiên quản trị đã hết hạn hoặc không hợp lệ.', 'error');
        } else if (!result.success) {
            showToast(result.message || 'Không thể làm mới dashboard.', 'error');
        } else if (result.partial) {
            showToast(`Đã làm mới một phần; lỗi: ${result.failedModules.join(', ')}.`, 'warning');
        } else {
            showToast('Tất cả module đã được đồng bộ.', 'success');
        }
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
            showToast('Vui lòng nhập tên sản phẩm.', 'error');
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
        createTokenBtn.innerHTML = '<i class="fa-solid fa-plus"></i> <span class="btn-text">Tạo sản phẩm</span>';

        if (res.success && res.data.token) {
            showToast(`Đã tạo sản phẩm "${tokenName}".`, 'success');
            tokenNameInput.value = '';
            tokenMaxDaysInput.value = '';
            tokenDisplayTextInput.value = '';
            tokenDescInput.value = '';
            loadData();
        } else {
            showToast(res.message || 'Không thể tạo package.', 'error');
        }
    });

    // Create key
    createKeyBtn.addEventListener('click', async () => {
        // Validate token selection
        if (!state.selectedTokenId) {
            showToast('Vui lòng chọn sản phẩm trước khi phát hành license.', 'error');
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
            showToast('Thời hạn vượt quá giới hạn của sản phẩm đã chọn.', 'error');
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
        createKeyBtn.innerHTML = '<i class="fa-solid fa-bolt"></i> <span class="btn-text">Phát hành License</span>';

        if (res.success && res.data.keys) {
            const keys = res.data.keys;
            displayGeneratedKeys(keys);
            noteInput.value = '';
            countInput.value = '1';
            maxDevicesInput.value = '1';
            customKeyInput.value = '';
            showToast(`Đã phát hành ${keys.length} license.`, 'success');
            loadData();
        } else {
            showToast(res.message || 'Không thể tạo license.', 'error');
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
            showToast('Đã sao chép tất cả licenses.', 'success');
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
                showToast(res.message || 'Không thể xóa security logs.', 'error');
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
            warning: 'fa-circle-exclamation',
            info: 'fa-info-circle'
        };

        toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
        const icon = document.createElement('i');
        icon.className = `fa-solid ${icons[type] || icons.info}`;
        const text = document.createElement('span');
        text.className = 'toast-message';
        text.textContent = String(message || 'Không có nội dung phản hồi.');
        toast.append(icon, text);
        container.appendChild(toast);
        requestAnimationFrame(() => toast.classList.add('show'));

        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 400);
        }, type === 'error' ? 5500 : 4000);
    }

    function confirmAction(title, message, callback, options = {}) {
        modalTitle.innerText = title;
        modalMessage.innerHTML = message;
        currentModalOptions = options;
        modalReasonInput.value = '';
        modalReasonInput.placeholder = options.reasonPlaceholder || 'Nhập lý do';
        modalReasonGroup.classList.toggle('hidden', !options.reasonRequired);
        confirmModal.classList.remove('hidden');
        state.currentModalAction = callback;
        if (options.reasonRequired) setTimeout(() => modalReasonInput.focus(), 80);
    }

    modalBtnCancel.addEventListener('click', () => {
        confirmModal.classList.add('hidden');
        state.currentModalAction = null;
        currentModalOptions = {};
    });

    modalBtnConfirm.addEventListener('click', () => {
        const reason = modalReasonInput.value.trim();
        if (currentModalOptions.reasonRequired && !reason) {
            showToast('Vui lòng nhập lý do trước khi xác nhận.', 'warning');
            modalReasonInput.focus();
            return;
        }
        confirmModal.classList.add('hidden');
        if (state.currentModalAction) state.currentModalAction(reason);
        state.currentModalAction = null;
        currentModalOptions = {};
    });

    // Close modal on backdrop click
    confirmModal.addEventListener('click', (e) => {
        if (e.target === confirmModal) {
            confirmModal.classList.add('hidden');
            state.currentModalAction = null;
            currentModalOptions = {};
        }
    });

    // Close modal on Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !confirmModal.classList.contains('hidden')) {
            confirmModal.classList.add('hidden');
            state.currentModalAction = null;
            currentModalOptions = {};
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
}, { once: true });
