// 状态管理和工具函数
const state = {
    isConnected: false,
    lastUpdate: null,
    updateInterval: null,
    retryAttempts: 0,
    maxRetries: 3
};

// 格式化时间显示
function formatTime(date) {
    if (!date) return '-';
    return new Date(date).toLocaleString('zh-CN', {
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

// 格式化运行时长
function formatUptime(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
        return `${days}天${hours % 24}小时`;
    }
    if (hours > 0) {
        return `${hours}小时${minutes % 60}分钟`;
    }
    return `${minutes}分钟`;
}

// 日志管理
class LogManager {
    constructor(containerId, maxEntries = 100) {
        this.container = document.getElementById(containerId);
        this.maxEntries = maxEntries;
    }

    add(message, type = 'info') {
        const entry = document.createElement('div');
        entry.className = `log-entry ${type === 'error' ? 'log-error' : type === 'success' ? 'log-success' : ''}`;

        const timestamp = document.createElement('span');
        timestamp.className = 'log-timestamp';
        timestamp.textContent = new Date().toLocaleTimeString('zh-CN', { hour12: false });

        const content = document.createElement('span');
        content.className = 'log-content';
        content.textContent = message;

        entry.appendChild(timestamp);
        entry.appendChild(content);

        this.container.insertBefore(entry, this.container.firstChild);

        while (this.container.children.length > this.maxEntries) {
            this.container.removeChild(this.container.lastChild);
        }

        return entry;
    }

    clear() {
        this.container.innerHTML = '';
        this.add('日志已清除');
    }
}

// UI元素管理
class UIManager {
    constructor() {
        this.elements = {
            currentRoom: document.getElementById('currentRoom'),
            connectionStatus: document.getElementById('connectionStatus'),
            connectionIndicator: document.getElementById('connectionIndicator'),
            lastHeartbeat: document.getElementById('lastHeartbeat'),
            lastReport: document.getElementById('lastReport'),
            uptime: document.getElementById('uptime'),
            systemTime: document.getElementById('systemTime'),
            systemStatus: document.getElementById('systemStatus'),
            configForm: document.getElementById('configForm'),
            clearLogsButton: document.getElementById('clearLogs')
        };
        this.logger = new LogManager('logContainer');
    }

    updateStatus(status) {
        this.elements.currentRoom.textContent = status.roomId || '未设置';
        this.elements.connectionStatus.textContent = status.isConnected ? '已连接' : '未连接';
        this.elements.connectionIndicator.className = `status-indicator ${status.isConnected ? 'status-connected' : 'status-disconnected'}`;
        this.elements.lastHeartbeat.textContent = formatTime(status.lastHeartbeat);
        this.elements.lastReport.textContent = formatTime(status.lastReport);
        this.elements.uptime.textContent = formatUptime(Date.now() - new Date(status.startTime).getTime());
    }

    updateSystemTime() {
        this.elements.systemTime.textContent = new Date().toLocaleString('zh-CN', { hour12: false });
    }

    showError(message) {
        this.logger.add(message, 'error');
    }

    showSuccess(message) {
        this.logger.add(message, 'success');
    }
}

// API请求管理
class APIManager {
    constructor(baseUrl = '') {
        this.baseUrl = baseUrl;
    }

    async updateConfig(config) {
        const response = await fetch(`${this.baseUrl}/api/update-config`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(config)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || '配置更新失败');
        }

        return response.json();
    }

    async getStatus() {
        const response = await fetch(`${this.baseUrl}/api/status`);
        if (!response.ok) {
            throw new Error('获取状态失败');
        }
        return response.json();
    }
}

// 应用主逻辑
class App {
    constructor() {
        this.ui = new UIManager();
        this.api = new APIManager();
        this.setupEventListeners();
        this.startStatusUpdates();
    }

    setupEventListeners() {
        // 配置表单提交
        this.ui.elements.configForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const form = e.target;
            const submitButton = form.querySelector('button[type="submit"]');
            const originalText = submitButton.textContent;

            try {
                submitButton.disabled = true;
                submitButton.textContent = '连接中...';
                submitButton.classList.add('loading');

                const formData = new FormData(form);
                const config = {
                    roomId: formData.get('roomId'),
                    cookie: formData.get('cookie')
                };

                const result = await this.api.updateConfig(config);
                this.ui.showSuccess('连接成功：' + result.message);
                state.isConnected = true;

                // 立即更新状态显示
                await this.updateStatus();
            } catch (error) {
                this.ui.showError('连接失败：' + error.message);
                state.isConnected = false;
            } finally {
                submitButton.disabled = false;
                submitButton.textContent = originalText;
                submitButton.classList.remove('loading');
            }
        });

        // 清除日志按钮
        this.ui.elements.clearLogsButton.addEventListener('click', () => {
            this.ui.logger.clear();
        });
    }

    async updateStatus() {
        try {
            const status = await this.api.getStatus();
            this.ui.updateStatus(status);
            state.lastUpdate = new Date();
            state.retryAttempts = 0;
        } catch (error) {
            console.error('状态更新失败:', error);
            if (++state.retryAttempts >= state.maxRetries) {
                this.ui.showError('状态更新失败，连接可能已断开');
                state.isConnected = false;
            }
        }
    }

    startStatusUpdates() {
        // 更新系统时间
        this.ui.updateSystemTime();
        setInterval(() => this.ui.updateSystemTime(), 1000);

        // 更新状态信息
        this.updateStatus();
        setInterval(() => this.updateStatus(), 30000);
    }
}

// 启动应用
document.addEventListener('DOMContentLoaded', () => {
    const app = new App();
    // 初始状态更新
    app.updateStatus().catch(console.error);
});