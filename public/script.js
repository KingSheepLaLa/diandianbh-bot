class Logger {
    constructor(containerId, maxEntries = 100) {
        this.container = document.getElementById(containerId);
        this.maxEntries = maxEntries;
    }

    add(message, type = 'info', details = null) {
        const entry = document.createElement('div');
        entry.className = 'log-entry';

        const timestamp = document.createElement('span');
        timestamp.className = 'log-timestamp';
        timestamp.textContent = new Date().toLocaleTimeString('zh-CN', { hour12: false });

        const typeIndicator = document.createElement('span');
        typeIndicator.className = `log-type log-type-${type}`;
        typeIndicator.textContent = type.toUpperCase();

        const content = document.createElement('span');
        content.className = 'log-content';
        content.textContent = message;

        entry.appendChild(timestamp);
        entry.appendChild(typeIndicator);
        entry.appendChild(content);

        if (details) {
            const detailsElement = document.createElement('pre');
            detailsElement.className = 'log-details';
            detailsElement.textContent = typeof details === 'string' ? details : JSON.stringify(details, null, 2);
            entry.appendChild(detailsElement);
        }

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

class ConnectionStepsManager {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.steps = {
            baseUrl: '获取基础配置',
            userInfo: '获取用户信息',
            roomInfo: '获取房间信息',
            nimToken: '获取登录令牌',
            roomJoin: '加入房间'
        };
    }

    updateStep(stepId, status, error = null) {
        const stepElement = this.container.querySelector(`[data-step="${stepId}"]`) || this.createStepElement(stepId);
        
        stepElement.className = `connection-step step-${status}`;
        const statusText = status === 'complete' ? '完成' : status === 'error' ? '失败' : '等待中';
        stepElement.querySelector('.step-status').textContent = statusText;
        
        if (error) {
            const errorElement = document.createElement('div');
            errorElement.className = 'text-red-600 text-sm mt-1';
            errorElement.textContent = error;
            stepElement.appendChild(errorElement);
        }
    }

    createStepElement(stepId) {
        const element = document.createElement('div');
        element.className = 'connection-step';
        element.dataset.step = stepId;

        const content = document.createElement('div');
        content.className = 'flex items-center justify-between w-full';

        const nameSpan = document.createElement('span');
        nameSpan.textContent = this.steps[stepId];

        const statusSpan = document.createElement('span');
        statusSpan.className = 'step-status';
        statusSpan.textContent = '等待中';

        content.appendChild(nameSpan);
        content.appendChild(statusSpan);
        element.appendChild(content);

        this.container.appendChild(element);
        return element;
    }

    reset() {
        this.container.innerHTML = '';
        Object.keys(this.steps).forEach(stepId => {
            this.updateStep(stepId, 'pending');
        });
    }
}

class UIManager {
    constructor() {
        this.elements = {
            currentRoom: document.getElementById('currentRoom'),
            nickname: document.getElementById('nickname'),
            userId: document.getElementById('userId'),
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

        this.logger = new Logger('logContainer');
        this.stepsManager = new ConnectionStepsManager('connectionSteps');
    }

    updateConnectionStatus(status) {
        this.elements.connectionIndicator.className = `status-indicator status-${status}`;
        this.elements.connectionStatus.textContent = 
            status === 'connected' ? '已连接' : 
            status === 'connecting' ? '连接中' : '未连接';
        
        this.elements.systemStatus.textContent = status === 'connected' ? '正常' : '异常';
        this.elements.systemStatus.className = 
            `font-medium ${status === 'connected' ? 'text-green-600' : 'text-red-600'}`;
    }

    updateStatus(status) {
        if (!status) return;

        this.elements.currentRoom.textContent = status.roomId || '-';
        this.elements.nickname.textContent = status.nickname || '-';
        this.elements.userId.textContent = status.userId || '-';
        this.elements.lastHeartbeat.textContent = this.formatTime(status.lastHeartbeat);
        this.elements.lastReport.textContent = this.formatTime(status.lastReport);
        this.elements.uptime.textContent = this.formatUptime(Date.now() - new Date(status.startTime).getTime());
        this.elements.retryCount.textContent = status.retryCount;
        this.elements.startTime.textContent = this.formatTime(status.startTime);

        this.updateConnectionStatus(status.isConnected ? 'connected' : 'disconnected');

        if (status.connectionSteps) {
            Object.entries(status.connectionSteps).forEach(([step, stepStatus]) => {
                this.stepsManager.updateStep(step, stepStatus.status ? 'complete' : stepStatus.error ? 'error' : 'pending', stepStatus.error);
            });
        }

        if (status.logs) {
            status.logs.forEach(log => {
                this.logger.add(log.message, log.type, log.details);
            });
        }
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
        const hours = Math.floor(milliseconds / (1000 * 60 * 60));
        const minutes = Math.floor((milliseconds % (1000 * 60 * 60)) / (1000 * 60));
        return `${hours}小时${minutes}分钟`;
    }

    updateSystemTime() {
        this.elements.systemTime.textContent = new Date().toLocaleString('zh-CN', { hour12: false });
    }

    showLoading(isLoading) {
        const submitButton = this.elements.configForm.querySelector('button[type="submit"]');
        submitButton.disabled = isLoading;
        submitButton.textContent = isLoading ? '连接中...' : '启动连接';
        submitButton.classList.toggle('loading', isLoading);
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
        const response = await fetch(`${this.baseUrl}/api/status`);
        if (!response.ok) {
            throw new Error('获取状态失败');
        }
        return response.json();
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

                this.ui.stepsManager.reset();
                this.ui.updateConnectionStatus('connecting');
                
                const result = await this.api.updateConfig(config);
                this.ui.logger.add('连接成功: ' + result.message, 'success');
                
                await this.updateStatus();
            } catch (error) {
                this.ui.logger.add('连接失败: ' + error.message, 'error');
                this.ui.updateConnectionStatus('disconnected');
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
        } catch (error) {
            console.error('状态更新失败:', error);
            this.ui.updateConnectionStatus('disconnected');
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
});