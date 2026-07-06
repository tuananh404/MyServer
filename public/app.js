/**
 * Client-side Controller for Owner Dashboard
 * Integrates Frontend components with Vercel API and handles interactivity
 */

document.addEventListener('DOMContentLoaded', () => {
    // State management
    const state = {
        adminToken: localStorage.getItem('admin_token') || '',
        keysList: [],
        fraudLogs: [],
        selectedDuration: 1, // Default duration preset (1 day)
        currentModalAction: null // For custom modal confirmation callback
    };

    // DOM Elements Cache
    const loginContainer = document.getElementById('login-container');
    const dashboardContainer = document.getElementById('dashboard-container');
    const loginForm = document.getElementById('login-form');
    const adminPasswordInput = document.getElementById('admin-password');
    const apiStatusText = document.getElementById('api-status-text');
    const logoutBtn = document.getElementById('logout-btn');

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

    // Modal elements
    const confirmModal = document.getElementById('confirm-modal');
    const modalTitle = document.getElementById('modal-title');
    const modalMessage = document.getElementById('modal-message');
    const modalBtnCancel = document.getElementById('modal-btn-cancel');
    const modalBtnConfirm = document.getElementById('modal-btn-confirm');

    // Auto-refresh interval (10 seconds)
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
            // Token invalid or network issue
            showToast('Không thể kết nối hoặc mật khẩu sai. Vui lòng đăng nhập lại.', 'error');
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
        adminPasswordInput.focus();
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
        const headers = {
            'Content-Type': 'application/json'
        };
        if (state.adminToken) {
            headers['Authorization'] = `Bearer ${state.adminToken}`;
        }

        const config = {
            method,
            headers
        };

        if (body) {
            config.body = JSON.stringify(body);
        }

        try {
            const response = await fetch(endpoint, config);
            if (response.status === 401 || response.status === 403) {
                if (endpoint !== '/api/admin/get-keys') { // avoid infinite loop if initial check fails
                    showToast('Phiên làm việc hết hạn hoặc mật khẩu sai.', 'error');
                    clearSession();
                    showLogin();
                }
                return { success: false, status: response.status, message: 'Unauthorized' };
            }
            const data = await response.json();
            return { success: response.ok, status: response.status, data };
        } catch (error) {
            console.error(`API request failed [${endpoint}]:`, error);
            return { success: false, error: true, message: 'Network error or offline' };
        }
    }

    async function loadData() {
        // Fetch keys and fraud logs concurrently
        const [keysRes, fraudRes] = await Promise.all([
            apiRequest('/api/admin/get-keys'),
            apiRequest('/api/admin/get-fraud')
        ]);

        if (keysRes.success && fraudRes.success) {
            state.keysList = keysRes.data.keys || [];
            state.fraudLogs = fraudRes.data.logs || [];
            
            updateApiStatus(true);
            renderKeys();
            renderFraudLogs();
            return true;
        } else {
            updateApiStatus(false);
            return false;
        }
    }

    function updateApiStatus(connected) {
        if (connected) {
            apiStatusText.innerText = 'Connected';
            apiStatusText.parentElement.querySelector('.pulse-dot').style.backgroundColor = 'var(--color-success)';
        } else {
            apiStatusText.innerText = 'Offline/Error';
            apiStatusText.parentElement.querySelector('.pulse-dot').style.backgroundColor = 'var(--color-danger)';
        }
    }

    function startAutoRefresh() {
        stopAutoRefresh();
        refreshIntervalId = setInterval(() => {
            loadData();
        }, 10000); // refresh every 10 seconds
    }

    function stopAutoRefresh() {
        if (refreshIntervalId) {
            clearInterval(refreshIntervalId);
            refreshIntervalId = null;
        }
    }

    // ==========================================
    // RENDER FUNCTIONS
    // ==========================================
    function renderKeys() {
        const query = searchKeyInput.value.toLowerCase().trim();
        const filteredKeys = state.keysList.filter(key => {
            const keyMatch = key.key_string.toLowerCase().includes(query);
            const noteMatch = (key.note || '').toLowerCase().includes(query);
            return keyMatch || noteMatch;
        });

        if (filteredKeys.length === 0) {
            keysTableBody.innerHTML = `
                <tr>
                    <td colspan="7" class="loading-state">
                        <i class="fa-solid fa-folder-open"></i> Không tìm thấy keys nào phù hợp
                    </td>
                </tr>
            `;
            return;
        }

        keysTableBody.innerHTML = filteredKeys.map(key => {
            // Expiry display format
            let expiryDisplay = 'N/A';
            if (key.duration_days === -1) {
                expiryDisplay = '<span style="color: var(--color-secondary); font-weight:600;">Lifetime (Vĩnh viễn)</span>';
            } else if (key.expires_at) {
                const date = new Date(key.expires_at);
                expiryDisplay = date.toLocaleString('vi-VN', { timeZone: 'UTC' });
            }

            // Duration display
            const durationDisplay = key.duration_days === -1 ? 'Lifetime' : `${key.duration_days} ngày`;

            // HWID display
            const hwidDisplay = key.hwid 
                ? `<span class="td-hwid">${key.hwid}</span>` 
                : `<span class="td-hwid none">Chưa kích hoạt</span>`;

            // Status badges
            let statusBadge = '';
            switch (key.status) {
                case 'unactivated':
                    statusBadge = '<span class="badge badge-unactivated">Sẵn sàng</span>';
                    break;
                case 'activated':
                    statusBadge = '<span class="badge badge-activated">Đã kích hoạt</span>';
                    break;
                case 'expired':
                    statusBadge = '<span class="badge badge-expired">Hết hạn</span>';
                    break;
                case 'banned':
                    statusBadge = '<span class="badge badge-banned">Khóa</span>';
                    break;
                default:
                    statusBadge = `<span class="badge">${key.status}</span>`;
            }

            return `
                <tr class="fade-in">
                    <td class="key-string-cell">${key.key_string}</td>
                    <td>${durationDisplay}</td>
                    <td>${expiryDisplay}</td>
                    <td>${hwidDisplay}</td>
                    <td>${statusBadge}</td>
                    <td><span style="font-size:13px; color: var(--color-text-muted);">${escapeHTML(key.note || '')}</span></td>
                    <td class="actions-cell text-right">
                        <button class="btn btn-outline btn-sm action-reset-hwid" data-key="${key.key_string}">
                            <i class="fa-solid fa-arrows-rotate"></i> Reset HWID
                        </button>
                        <button class="btn btn-danger-outline btn-sm action-delete-key" data-key="${key.key_string}">
                            <i class="fa-solid fa-trash-can"></i> Xóa
                        </button>
                    </td>
                </tr>
            `;
        }).join('');

        // Attach action listeners
        document.querySelectorAll('.action-reset-hwid').forEach(btn => {
            btn.addEventListener('click', () => {
                const key = btn.getAttribute('data-key');
                confirmAction('Đặt lại HWID', `Bạn có chắc chắn muốn đặt lại Hardware ID cho Key: <strong>${key}</strong>? Khách hàng sẽ kích hoạt được thiết bị mới.`, async () => {
                    const res = await apiRequest('/api/admin/reset-hwid', 'POST', { key_string: key });
                    if (res.success) {
                        showToast(`Reset HWID cho ${key} thành công.`, 'success');
                        loadData();
                    } else {
                        showToast(`Lỗi reset HWID: ${res.data?.message || 'Unknown error'}`, 'error');
                    }
                });
            });
        });

        document.querySelectorAll('.action-delete-key').forEach(btn => {
            btn.addEventListener('click', () => {
                const key = btn.getAttribute('data-key');
                confirmAction('Xóa Key', `Hành động này không thể hoàn tác! Bạn muốn xóa Key: <strong>${key}</strong>?`, async () => {
                    const res = await apiRequest('/api/admin/delete-key', 'DELETE', { key_string: key });
                    if (res.success) {
                        showToast(`Đã xóa Key ${key} thành công.`, 'success');
                        loadData();
                    } else {
                        showToast(`Lỗi xóa key: ${res.data?.message || 'Unknown error'}`, 'error');
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
            fraudSubtitle.innerText = 'Không có vi phạm mới được phát hiện';
            return;
        }

        // Fraud detected! Activate glowing neon danger alerts
        fraudLogsEmpty.classList.add('hidden');
        fraudLogsList.classList.remove('hidden');
        fraudCard.classList.add('has-fraud');
        fraudSubtitle.innerText = `Phát hiện ${state.fraudLogs.length} lần thử đăng nhập đáng ngờ!`;

        fraudLogsList.innerHTML = state.fraudLogs.map(log => {
            const time = new Date(log.logged_at).toLocaleString('vi-VN', { timeZone: 'UTC' });
            return `
                <li class="fraud-log-item fade-in">
                    <div class="fraud-meta">
                        <span class="fraud-reason"><i class="fa-solid fa-triangle-exclamation"></i> ${escapeHTML(log.reason)}</span>
                        <span class="fraud-time">${time}</span>
                    </div>
                    <div>
                        <span style="font-size:11px; color: var(--color-text-muted); display:block; margin-bottom:2px;">Hardware ID (HWID):</span>
                        <span class="fraud-hwid">${escapeHTML(log.hwid)}</span>
                    </div>
                </li>
            `;
        }).join('');
    }

    // ==========================================
    // INTERACTION & LISTENERS
    // ==========================================
    
    // Login form submission
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const pwd = adminPasswordInput.value.trim();
        if (!pwd) return;

        state.adminToken = pwd;
        showLoadingState();

        const check = await apiRequest('/api/admin/get-keys');
        if (check.success) {
            localStorage.setItem('admin_token', pwd);
            state.keysList = check.data.keys || [];
            
            // fetch fraud logs too
            const fraudCheck = await apiRequest('/api/admin/get-fraud');
            if (fraudCheck.success) {
                state.fraudLogs = fraudCheck.data.logs || [];
            }
            
            showDashboard();
            renderKeys();
            renderFraudLogs();
            updateApiStatus(true);
            startAutoRefresh();
            showToast('Đăng nhập quản trị thành công!', 'success');
        } else {
            clearSession();
            showToast('Mật khẩu Admin không đúng hoặc lỗi kết nối api.', 'error');
            showLogin();
        }
    });

    // Logout
    logoutBtn.addEventListener('click', () => {
        clearSession();
        showLogin();
        showToast('Đã đăng xuất.', 'info');
    });

    // Preset buttons click handlers
    presetButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            presetButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            const days = parseInt(btn.getAttribute('data-days'));
            state.selectedDuration = days;
            durationInput.value = days;
        });
    });

    // Handle manual input in custom duration field
    durationInput.addEventListener('input', () => {
        const val = parseInt(durationInput.value);
        state.selectedDuration = isNaN(val) ? 1 : val;

        // Sync visual presets
        presetButtons.forEach(btn => {
            const btnDays = parseInt(btn.getAttribute('data-days'));
            if (btnDays === val) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    });

    // Key creation button handler
    createKeyBtn.addEventListener('click', async () => {
        const note = noteInput.value.trim();
        const duration = state.selectedDuration;

        createKeyBtn.disabled = true;
        createKeyBtn.querySelector('.btn-text')?.setAttribute('style', 'opacity: 0.5');

        const res = await apiRequest('/api/admin/create-key', 'POST', {
            duration_days: duration,
            note: note
        });

        createKeyBtn.disabled = false;
        createKeyBtn.querySelector('.btn-text')?.removeAttribute('style');

        if (res.success && res.data.key) {
            const keyString = res.data.key.key_string;
            generatedKeyString.innerText = keyString;
            generatedKeyBox.classList.remove('hidden');
            noteInput.value = ''; // Reset note input
            
            showToast('Tạo License Key thành công!', 'success');
            loadData(); // Reload table
        } else {
            showToast(`Không thể tạo key: ${res.message || res.data?.message || 'Error'}`, 'error');
        }
    });

    // Copy to clipboard
    copyKeyBtn.addEventListener('click', () => {
        const key = generatedKeyString.innerText;
        navigator.clipboard.writeText(key).then(() => {
            const originalHTML = copyKeyBtn.innerHTML;
            copyKeyBtn.innerHTML = `<i class="fa-solid fa-check"></i> <span>Copied!</span>`;
            copyKeyBtn.classList.add('btn-success');
            
            showToast('Đã copy Key vào bộ nhớ tạm!', 'success');
            
            setTimeout(() => {
                copyKeyBtn.innerHTML = originalHTML;
                copyKeyBtn.classList.remove('btn-success');
            }, 2000);
        }).catch(err => {
            console.error('Copy failure:', err);
            showToast('Không thể sao chép tự động.', 'error');
        });
    });

    // Local Search Filter
    searchKeyInput.addEventListener('input', () => {
        renderKeys();
    });

    // ==========================================
    // UTILS: TOAST SYSTEM & MODAL
    // ==========================================
    function showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        
        let iconClass = 'fa-info-circle';
        if (type === 'success') iconClass = 'fa-circle-check';
        if (type === 'error') iconClass = 'fa-triangle-exclamation';

        toast.innerHTML = `
            <i class="fa-solid ${iconClass}"></i>
            <span class="toast-message">${message}</span>
        `;
        
        container.appendChild(toast);
        
        // Trigger show animation
        setTimeout(() => toast.classList.add('show'), 50);
        
        // Remove after 4 seconds
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 400);
        }, 4000);
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
        if (state.currentModalAction) {
            state.currentModalAction();
        }
        state.currentModalAction = null;
    });

    // Escape HTML helpers to prevent XSS
    function escapeHTML(str) {
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
