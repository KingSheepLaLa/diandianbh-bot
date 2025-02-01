// 状态管理
const state = {
    isConnected: false,
    lastUpdate: null,
    updateInterval: null,
    retryAttempts: 0,
    maxRetries: 3,
    roomId: null,
    userId: null
};

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
        this.add('日志已清除', 'info');
    }
}

class UIManager {
    constructor() {
        this.elements = {
            currentRoom: document.getElementById('currentRoom'),
            userId: document.getElementById('userId'),
            nickname: document.getElementById('nickname'),
            connectionStatus: document.getElementById('connectionStatus'),
            connectionIndicator: document.getElementById('connectionIndicator'),
            lastHeartbeat: document.getElementById('lastHeartbeat'),
            lastReport: document.getElementById('lastReport'),
            uptime: document.getElementById('uptime'),
            systemTime: document.getElementById('systemTime'),
            systemStatus: document.getElementById('systemStatus'),
            retryCount: document.getElementById('retryCount'),
            startTime: document.getElementById('startTime'),
            configForm: document.getElementById('configForm'),
            clearLogsButton: document.getElementById('clearLogs')
        };

        this.logger = new LogManager('logContainer');
    }

    formatTime(date) {
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

    formatUptime(milliseconds) {
        const seconds = Math.floor(milliseconds / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) {
            return `${days}天${hours % 24}小时${minutes % 60}分钟`;
        }
        if (hours > 0) {
            return `${hours}小时${minutes % 60}分钟`;
        }
        return `${minutes}分钟`;
    }

    updateConnectionStatus(isConnected, message = '') {
        this.elements.connectionStatus.textContent = isConnected ? '已连接' : '未连接';
        this.elements.connectionIndicator.className = 
            `w-3 h-3 rounded-full ${isConnected ? 'status-connected' : 'status-disconnected'}`;
        
        if (message) {
            this.logger.add(message, isConnected ? 'success' : 'error');
        }
    }

    updateStatus(status) {
        if (!status) return;

        this.elements.currentRoom.textContent = status.roomId || '-';
        this.elements.userId.textContent = status.userId || '-';
        this.elements.nickname.textContent = status.nickname || '-';
        this.elements.lastHeartbeat.textContent = this.formatTime(status.lastHeartbeat);
        this.elements.lastReport.textContent = this.formatTime(status.lastReport);
        this.elements.uptime.textContent = this.formatUptime(Date.now() - new Date(status.startTime).getTime());
        this.elements.retryCount.textContent = status.retryCount;
        this.elements.startTime.textContent = this.formatTime(status.startTime);

        this.updateConnectionStatus(status.isConnected);

        const systemStatusClass = status.isConnected ? 'system-status-normal' : 'system-status-error';
        this.elements.systemStatus.className = `system-status ${systemStatusClass}`;
        this.elements.systemStatus.textContent = status.isConnected ? '正常' : '异常';
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

    showLoading(isLoading = true) {
        const submitButton = this.elements.configForm.querySelector('button[type="submit"]');
        if (isLoading) {
            submitButton.disabled = true;
            submitButton.classList.add('loading');
            submitButton.textContent = '连接中...';
        } else {
            submitButton.disabled = false;
            submitButton.classList.remove('loading');
            submitButton.textContent = '启动连接';
        }
    }
}

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
        try {
            const response = await fetch(`${this.baseUrl}/api/status`);
            if (!response.ok) {
                throw new Error('获取状态失败');
            }
            return response.json();
        } catch (error) {
            console.error('状态获取失败:', error);
            throw error;
        }
    }
}

class App {
    constructor() {
        this.ui = new UIManager();
        this.api = new APIManager();
        this.setupEventListeners();
        this.startStatusUpdates();
    }

    setupEventListeners() {
        this.ui.elements.configForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            this.ui.showLoading(true);

            try {
                const formData = new FormData(e.target);
                const config = {
                    roomId: formData.get('roomId'),
                    cookie: formData.get('cookie')
                };

                state.roomId = config.roomId;

                const result = await this.api.updateConfig(config);
                this.ui.showSuccess(`连接成功: ${result.message}`);
                state.isConnected = true;

                await this.updateStatus();
            } catch (error) {
                this.ui.showError(`连接失败: ${error.message}`);
                state.isConnected = false;
            } finally {
                this.ui.showLoading(false);
            }
        });

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
                this.ui.updateConnectionStatus(false);
            }
        }
    }

    startStatusUpdates() {
        this.ui.updateSystemTime();
        setInterval(() => this.ui.updateSystemTime(), 1000);

        this.updateStatus();
        setInterval(() => this.updateStatus(), 30000);
    }
}

// 初始化应用
document.addEventListener('DOMContentLoaded', () => {
    const app = new App();
    app.updateStatus().catch(console.error);
});