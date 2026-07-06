/**
 * Client-side Controller for Owner Dashboard v2.0
 * Enhanced with stats, ban/unban, clear fraud, animated counters
 */

document.addEventListener('DOMContentLoaded', () => {
    // State management
    const state = {
        adminToken: localStorage.getItem('admin_token') || '',
        keysList: [],
        fraudLogs: [],
        stats: { total: 0, unactivated: 0, activated: 0, expired: 0, banned: 0, fraudAlerts: 0 },
        selectedDuration: 1,
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

    // Generator elements
    const presetButtons = document.querySelectorAll('.btn-preset');
    const durationInput = document.getElementById('duration-input');
    const noteInput = document.getElementById('note-input');
    const createKeyBtn = document.getElementById('create-key-btn');
    const generatedKeyBox = document.getElementById('generated-key-box');
    const generatedKeyString = document.getElementById('generated-key-string');
    const copyKeyBtn = document.getElementById('copy-key-btn');

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
                <td colspan="7" class="loading-state">
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
                if (endpoint.includes('/get-keys') || endpoint.includes('/stats')) {
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
        const [keysRes, fraudRes, statsRes] = await Promise.all([
            apiRequest('/api/admin/get-keys'),
            apiRequest('/api/admin/get-fraud'),
            apiRequest('/api/admin/stats')
        ]);

        if (keysRes.success && fraudRes.success) {
            state.keysList = keysRes.data.keys || [];
            state.fraudLogs = fraudRes.data.logs || [];
            if (statsRes.success) {
                state.stats = statsRes.data.stats;
            }

            updateApiStatus(true);
            renderStats();
            renderKeys();
            renderFraudLogs();
            return true;
        } else {
            updateApiStatus(false);
            return false;
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

    function renderKeys() {
        const query = searchKeyInput.value.toLowerCase().trim();
        const filteredKeys = state.keysList.filter(key => {
            const keyMatch = key.key_string.toLowerCase().includes(query);
            const noteMatch = (key.note || '').toLowerCase().includes(query);
            const hwidMatch = (key.hwid || '').toLowerCase().includes(query);
            return keyMatch || noteMatch || hwidMatch;
        });

        if (filteredKeys.length === 0) {
            keysTableBody.innerHTML = `
                <tr>
                    <td colspan="7" class="loading-state">
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
                expiryDisplay = date.toLocaleString('vi-VN', { timeZone: 'UTC' });
            }

            // Duration display
            const durationDisplay = key.duration_days === -1
                ? '<span style="color:var(--color-warning)">∞</span>'
                : `${key.duration_days} ngày`;

            // HWID display
            const hwidDisplay = key.hwid
                ? `<span class="td-hwid">${escapeHTML(key.hwid)}</span>`
                : `<span class="td-hwid none">Chưa kích hoạt</span>`;

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
                    <td>${durationDisplay}</td>
                    <td style="font-size:12px;">${expiryDisplay}</td>
                    <td>${hwidDisplay}</td>
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
            const time = new Date(log.logged_at).toLocaleString('vi-VN', { timeZone: 'UTC' });
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
    // EVENT LISTENERS
    // ==========================================

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

        state.adminToken = pwd;
        loginBtn.disabled = true;
        loginBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>Đang kiểm tra...</span>';

        const check = await apiRequest('/api/admin/get-keys');
        if (check.success) {
            localStorage.setItem('admin_token', pwd);
            state.keysList = check.data.keys || [];

            // Load remaining data
            const [fraudCheck, statsCheck] = await Promise.all([
                apiRequest('/api/admin/get-fraud'),
                apiRequest('/api/admin/stats')
            ]);
            if (fraudCheck.success) state.fraudLogs = fraudCheck.data.logs || [];
            if (statsCheck.success) state.stats = statsCheck.data.stats;

            showDashboard();
            renderStats();
            renderKeys();
            renderFraudLogs();
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

    // Preset buttons
    presetButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            presetButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const days = parseInt(btn.getAttribute('data-days'));
            state.selectedDuration = days;
            durationInput.value = days;
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
    });

    // Create key
    createKeyBtn.addEventListener('click', async () => {
        const note = noteInput.value.trim();
        const duration = state.selectedDuration;

        createKeyBtn.disabled = true;
        createKeyBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>Đang tạo...</span>';

        const res = await apiRequest('/api/admin/create-key', 'POST', {
            duration_days: duration,
            note: note
        });

        createKeyBtn.disabled = false;
        createKeyBtn.innerHTML = '<i class="fa-solid fa-bolt"></i> <span class="btn-text">Tạo Key Ngay</span>';

        if (res.success && res.data.key) {
            const keyString = res.data.key.key_string;
            generatedKeyString.innerText = keyString;
            generatedKeyBox.classList.remove('hidden');
            noteInput.value = '';
            showToast('Tạo Key thành công!', 'success');
            loadData();
        } else {
            showToast(`Lỗi tạo key: ${res.data?.message || 'Unknown'}`, 'error');
        }
    });

    // Copy to clipboard
    copyKeyBtn.addEventListener('click', () => {
        const key = generatedKeyString.innerText;
        navigator.clipboard.writeText(key).then(() => {
            const orig = copyKeyBtn.innerHTML;
            copyKeyBtn.innerHTML = '<i class="fa-solid fa-check"></i> <span>Copied!</span>';
            copyKeyBtn.classList.add('btn-success');
            showToast('Đã copy Key!', 'success');
            setTimeout(() => {
                copyKeyBtn.innerHTML = orig;
                copyKeyBtn.classList.remove('btn-success');
            }, 2000);
        }).catch(() => {
            // Fallback for older browsers
            const textarea = document.createElement('textarea');
            textarea.value = key;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            showToast('Đã copy Key!', 'success');
        });
    });

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
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // Launch
    init();
});
