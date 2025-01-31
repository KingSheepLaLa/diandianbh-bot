// Utility functions
function formatTimestamp(timestamp) {
    return new Date(timestamp).toLocaleString('zh-CN', {
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

// DOM Elements
const configForm = document.getElementById('configForm');
const roomIdInput = document.getElementById('roomId');
const previewLink = document.getElementById('previewLink');
const userInfo = document.getElementById('userInfo');
const currentRoom = document.getElementById('currentRoom');
const heartbeatStatus = document.getElementById('heartbeatStatus');
const lastHeartbeat = document.getElementById('lastHeartbeat');
const lastReport = document.getElementById('lastReport');
const runningTime = document.getElementById('runningTime');
const systemStatus = document.getElementById('systemStatus');
const connectionStatus = document.getElementById('connectionStatus');
const logContainer = document.getElementById('logContainer');
const clearLogsButton = document.getElementById('clearLogs');
const reconnectButton = document.getElementById('reconnectButton');
const autoScrollToggle = document.getElementById('autoScrollToggle');
const errorModal = document.getElementById('errorModal');
const errorMessage = document.getElementById('errorMessage');
const closeErrorModal = document.getElementById('closeErrorModal');

// State
const startTime = new Date();
let autoScrollEnabled = true;
let statusCheckInterval = null;

function showError(message) {
    errorMessage.textContent = message;
    errorModal.classList.remove('hidden');
}

function addLog(message, type = 'info') {
    const logItem = document.createElement('div');
    logItem.className = `log-item ${type === 'error' ? 'log-error' : 
                                   type === 'success' ? 'log-success' : 
                                   type === 'warning' ? 'log-warning' : ''}`;
    
    const time = document.createElement('span');
    time.className = 'log-time';
    time.textContent = new Date().toLocaleTimeString();
    
    const content = document.createElement('span');
    content.className = 'log-content';
    content.textContent = message;
    
    logItem.appendChild(time);
    logItem.appendChild(content);
    
    logContainer.insertBefore(logItem, logContainer.firstChild);

    if (autoScrollEnabled) {
        logContainer.scrollTop = 0;
    }

    if (logContainer.children.length > 100) {
        logContainer.removeChild(logContainer.lastChild);
    }
}

function updateRunningTime() {
    const now = new Date();
    const diff = now - startTime;
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    runningTime.textContent = `${hours}小时${minutes}分钟`;
}

function updatePreviewLink(roomId) {
    if (roomId && /^\d+$/.test(roomId)) {
        previewLink.href = `https://y.tuwan.com/chatroom/${roomId}`;
        previewLink.classList.remove('opacity-50', 'pointer-events-none');
    } else {
        previewLink.href = '#';
        previewLink.classList.add('opacity-50', 'pointer-events-none');
    }
}

function updateConnectionStatus(isConnected) {
    connectionStatus.textContent = isConnected ? '已连接' : '未连接';
    connectionStatus.className = isConnected ? 'text-green-600 font-medium' : 'text-red-600 font-medium';
    
    if (!isConnected) {
        reconnectButton.classList.remove('hidden');
    } else {
        reconnectButton.classList.add('hidden');
    }
}

async function checkRoomStatus() {
    try {
        const roomId = roomIdInput.value;
        if (!roomId) return;

        const response = await fetch('https://papi.tuwan.com/Chatroom/getPcListV4', {
            method: 'GET',
            headers: {
                'Referer': `https://y.tuwan.com/chatroom/${roomId}`
            }
        });
        
        const data = await response.json();
        if (data.error === 0) {
            addLog(`房间 ${roomId} 状态正常`, 'success');
        } else {
            addLog(`房间 ${roomId} 状态异常: ${data.message}`, 'warning');
        }
    } catch (error) {
        console.error('检查房间状态失败:', error);
    }
}

async function updateStatus() {
    try {
        const response = await fetch('/api/status');
        const status = await response.json();
        
        if (status.isLoggedIn && status.userData) {
            userInfo.innerHTML = `
                <p>用户名: <span class="font-medium">${status.userData.nickname || '未知'}</span></p>
                <p>账号 ID: <span class="text-gray-600">${status.userData.accid || '未知'}</span></p>
                <p>状态: <span class="text-green-600 font-medium">已登录</span></p>
                <p>最后更新: <span class="text-gray-600">${formatTimestamp(status.userData.lastUpdate)}</span></p>
            `;
        } else {
            userInfo.innerHTML = `
                <p>状态: <span class="text-red-600 font-medium">未登录</span></p>
                <p>请配置Cookie和房间号</p>
            `;
        }
        
        if (status.roomId) {
            currentRoom.innerHTML = `<a href="https://y.tuwan.com/chatroom/${status.roomId}" target="_blank" class="text-blue-600 hover:text-blue-800">${status.roomId}</a>`;
            updatePreviewLink(status.roomId);
        } else {
            currentRoom.textContent = '未设置';
        }
        
        heartbeatStatus.textContent = status.heartbeatStatus ? '正常' : '异常';
        heartbeatStatus.className = status.heartbeatStatus ? 'text-green-600 font-medium' : 'text-red-600 font-medium';
        
        if (status.lastHeartbeat) {
            lastHeartbeat.textContent = formatTimestamp(status.lastHeartbeat);
        }
        
        if (status.lastStatusReport) {
            lastReport.textContent = formatTimestamp(status.lastStatusReport);
        }
        
        updateRunningTime();
        updateConnectionStatus(status.isLoggedIn);

        if (!status.heartbeatStatus && status.isLoggedIn) {
            addLog('检测到心跳异常，准备重连...', 'warning');
            await attemptReconnect();
        }
    } catch (error) {
        console.error('获取状态失败:', error);
        addLog('获取状态失败: ' + error.message, 'error');
        systemStatus.textContent = '异常';
        systemStatus.className = 'text-red-600 font-medium';
    }
}

async function attemptReconnect() {
    try {
        reconnectButton.disabled = true;
        reconnectButton.textContent = '正在重连...';
        addLog('正在尝试重新连接...', 'info');

        const response = await fetch('/api/update-config', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                roomId: roomIdInput.value,
                cookie: document.getElementById('cookie').value
            })
        });

        const result = await response.json();
        
        if (result.success) {
            addLog('重新连接成功！', 'success');
            if (result.data.joinStatus) {
                addLog('成功进入房间！', 'success');
            }
            await updateStatus();
            startStatusCheck();
        } else {
            addLog('重新连接失败: ' + result.message, 'error');
            showError('重新连接失败: ' + result.message);
        }
    } catch (error) {
        console.error('重新连接失败:', error);
        addLog('重新连接失败: ' + error.message, 'error');
        showError('重新连接失败，请检查网络连接');
    } finally {
        reconnectButton.disabled = false;
        reconnectButton.textContent = '重新连接';
    }
}

function startStatusCheck() {
    if (statusCheckInterval) {
        clearInterval(statusCheckInterval);
    }
    statusCheckInterval = setInterval(updateStatus, 30000);
    addLog('已启动状态监控', 'success');
}

function stopStatusCheck() {
    if (statusCheckInterval) {
        clearInterval(statusCheckInterval);
        statusCheckInterval = null;
    }
    addLog('已停止状态监控', 'info');
}

configForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const formData = new FormData(configForm);
    const config = {
        roomId: formData.get('roomId'),
        cookie: formData.get('cookie')
    };

    try {
        const submitButton = configForm.querySelector('button[type="submit"]');
        submitButton.disabled = true;
        submitButton.innerHTML = '<span class="loading">配置更新中...</span>';
        
        const response = await fetch('/api/update-config', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(config)
        });
        
        const result = await response.json();
        
        if (result.success) {
            addLog('配置更新成功！', 'success');
            addLog(`用户 ${result.data.nickname} 已连接到房间 ${config.roomId}`, 'success');
            
            // 检查进房状态
            if (result.data.joinStatus) {
                addLog('成功进入房间！', 'success');
            } else {
                addLog('进入房间可能不完整，尝试重连...', 'warning');
                await attemptReconnect();
            }
            
            updatePreviewLink(config.roomId);
            await updateStatus();
            startStatusCheck();
            await checkRoomStatus();
        } else {
            addLog('配置更新失败: ' + result.message, 'error');
            showError('配置更新失败: ' + result.message);
            stopStatusCheck();
        }
    } catch (error) {
        console.error('配置更新失败:', error);
        addLog('配置更新失败: ' + error.message, 'error');
        showError('配置更新失败，请检查网络连接');
        stopStatusCheck();
    } finally {
        const submitButton = configForm.querySelector('button[type="submit"]');
        submitButton.disabled = false;
        submitButton.textContent = '启动挂机';
    }
});

// Event Listeners
roomIdInput.addEventListener('input', (e) => {
    updatePreviewLink(e.target.value);
});

reconnectButton.addEventListener('click', attemptReconnect);

clearLogsButton.addEventListener('click', () => {
    logContainer.innerHTML = '';
    addLog('日志已清除', 'info');
});

autoScrollToggle.addEventListener('click', () => {
    autoScrollEnabled = !autoScrollEnabled;
    autoScrollToggle.textContent = `自动滚动: ${autoScrollEnabled ? '开启' : '关闭'}`;
    addLog(`自动滚动已${autoScrollEnabled ? '开启' : '关闭'}`, 'info');
});

closeErrorModal.addEventListener('click', () => {
    errorModal.classList.add('hidden');
});

document.addEventListener('DOMContentLoaded', async () => {
    updateRunningTime();
    setInterval(updateRunningTime, 60000);
    await updateStatus();
    startStatusCheck();
    addLog('系统初始化完成', 'success');
});

window.addEventListener('beforeunload', () => {
    stopStatusCheck();
});

window.addEventListener('online', () => {
    addLog('网络连接已恢复', 'success');
    attemptReconnect();
});

window.addEventListener('offline', () => {
    addLog('网络连接已断开', 'error');
    showError('网络连接已断开，请检查网络设置');
    stopStatusCheck();
});