// 获取页面元素引用
const configForm = document.getElementById('configForm');
const roomIdInput = document.getElementById('roomId');
const previewLink = document.getElementById('previewLink');
const userInfo = document.getElementById('userInfo');
const currentRoom = document.getElementById('currentRoom');
const heartbeatStatus = document.getElementById('heartbeatStatus');
const wsStatus = document.getElementById('wsStatus');
const lastHeartbeat = document.getElementById('lastHeartbeat');
const lastReport = document.getElementById('lastReport');
const runningTime = document.getElementById('runningTime');
const systemTime = document.getElementById('systemTime');
const systemStatus = document.getElementById('systemStatus');
const connectionStatus = document.getElementById('connectionStatus');
const logContainer = document.getElementById('logContainer');
const clearLogsButton = document.getElementById('clearLogs');
const reconnectButton = document.getElementById('reconnectButton');
const autoScrollToggle = document.getElementById('autoScrollToggle');
const errorModal = document.getElementById('errorModal');
const errorMessage = document.getElementById('errorMessage');
const closeErrorModal = document.getElementById('closeErrorModal');

// 记录系统启动时间，用于计算运行时长
const startTime = new Date();

// 自动滚动状态
let autoScrollEnabled = true;

/**
 * 显示错误弹窗
 * 当发生重要错误时，以模态框的形式提醒用户
 * @param {string} message - 错误信息内容
 */
function showError(message) {
    errorMessage.textContent = message;
    errorModal.classList.remove('hidden');
}

/**
 * 添加日志条目到日志容器
 * 支持不同类型的日志（info/error/success/warning）并确保日志数量在可控范围内
 * @param {string} message - 日志消息内容
 * @param {string} type - 日志类型，影响显示样式
 */
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
    
    // 将新日志插入到顶部以保持最新日志始终可见
    logContainer.insertBefore(logItem, logContainer.firstChild);

    // 如果启用了自动滚动，则滚动到最新日志
    if (autoScrollEnabled) {
        logContainer.scrollTop = 0;
    }

    // 限制日志数量，避免内存占用过大
    if (logContainer.children.length > 100) {
        logContainer.removeChild(logContainer.lastChild);
    }
}

/**
 * 更新系统时间显示
 * 使用本地时间格式显示当前时间，确保时间显示的一致性
 */
function updateSystemTime() {
    const now = new Date();
    systemTime.textContent = now.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
}

/**
 * 更新运行时长显示
 * 计算并格式化从系统启动到现在的时间差，提供清晰的运行时间信息
 */
function updateRunningTime() {
    const now = new Date();
    const diff = now - startTime;
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    runningTime.textContent = `${hours}小时${minutes}分钟`;
}

/**
 * 更新WebSocket状态显示
 * 将WebSocket的数字状态码转换为用户友好的文本显示
 * @param {number} status - WebSocket的连接状态码
 */
function updateWebSocketStatus(status) {
    const statusMap = {
        '-1': ['未连接', 'text-gray-600'],
        '0': ['正在连接', 'text-yellow-600'],
        '1': ['已连接', 'text-green-600'],
        '2': ['正在关闭', 'text-yellow-600'],
        '3': ['已关闭', 'text-red-600']
    };

    const [text, className] = statusMap[status] || ['未知', 'text-gray-600'];
    wsStatus.textContent = text;
    wsStatus.className = `font-medium ${className}`;

    // 根据连接状态显示或隐藏重连按钮
    if (status === '3' || status === '-1') {
        reconnectButton.classList.remove('hidden');
    } else {
        reconnectButton.classList.add('hidden');
    }
}

/**
 * 更新房间预览链接
 * 根据输入的房间号更新预览链接的状态和地址，提供直观的房间访问入口
 * @param {string} roomId - 房间号
 */
function updatePreviewLink(roomId) {
    if (roomId && /^\d+$/.test(roomId)) {
        previewLink.href = `https://y.tuwan.com/chatroom/${roomId}`;
        previewLink.classList.remove('opacity-50', 'pointer-events-none');
    } else {
        previewLink.href = '#';
        previewLink.classList.add('opacity-50', 'pointer-events-none');
    }
}

/**
 * 更新系统状态显示
 * 从服务器获取最新状态并更新界面各个部分的显示，提供实时的系统运行状态
 */
async function updateStatus() {
    try {
        const response = await fetch('/api/status');
        const status = await response.json();
        
        // 更新用户信息显示区域
        if (status.isLoggedIn && status.userData) {
            userInfo.innerHTML = `
                <p>用户名: <span class="font-medium">${status.userData.nickname || '未知'}</span></p>
                <p>账号 ID: <span class="text-gray-600">${status.userData.accid || '未知'}</span></p>
                <p>状态: <span class="text-green-600 font-medium">已登录</span></p>
                <p>最后更新: <span class="text-gray-600">${new Date(status.userData.lastUpdate).toLocaleString()}</span></p>
            `;
        } else {
            userInfo.innerHTML = `
                <p>状态: <span class="text-red-600 font-medium">未登录</span></p>
                <p>请配置Cookie和房间号</p>
            `;
        }
        
        // 更新房间信息显示
        if (status.roomId) {
            currentRoom.innerHTML = `<a href="https://y.tuwan.com/chatroom/${status.roomId}" target="_blank" class="text-blue-600 hover:text-blue-800">${status.roomId}</a>`;
            roomIdInput.value = status.roomId;
            updatePreviewLink(status.roomId);
        } else {
            currentRoom.textContent = '未设置';
        }
        
        // 更新心跳状态显示
        heartbeatStatus.textContent = status.heartbeatStatus ? '正常' : '异常';
        heartbeatStatus.className = status.heartbeatStatus ? 'text-green-600 font-medium' : 'text-red-600 font-medium';
        
        // 更新WebSocket状态
        updateWebSocketStatus(status.wsStatus.toString());
        
        // 更新最后心跳时间显示
        if (status.lastHeartbeat) {
            lastHeartbeat.textContent = new Date(status.lastHeartbeat).toLocaleString();
        }
        
        // 更新最后状态上报时间显示
        if (status.lastStatusReport) {
            lastReport.textContent = new Date(status.lastStatusReport).toLocaleString();
        }
        
        // 更新运行时长显示
        updateRunningTime();

        // 更新连接状态
        connectionStatus.textContent = status.isLoggedIn ? '已连接' : '未连接';
        connectionStatus.className = status.isLoggedIn ? 'text-green-600 font-medium' : 'text-red-600 font-medium';
    } catch (error) {
        console.error('获取状态失败:', error);
        addLog('获取状态失败: ' + error.message, 'error');
        systemStatus.textContent = '异常';
        systemStatus.className = 'text-red-600 font-medium';
        showError('系统状态更新失败，请检查网络连接');
    }
}

/**
 * 尝试重新连接
 * 当连接断开时，尝试重新建立连接并恢复运行状态
 */
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
            await updateStatus();
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

// 配置表单提交处理
configForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const formData = new FormData(configForm);
    const config = {
        roomId: formData.get('roomId'),
        cookie: formData.get('cookie')
    };

    try {
        // 禁用提交按钮并显示加载状态
        const submitButton = configForm.querySelector('button[type="submit"]');
        submitButton.disabled = true;
        submitButton.innerHTML = '<span class="loading">配置更新中...</span>';
        
        // 发送配置更新请求
        const response = await fetch('/api/update-config', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(config)
        });
        
        const result = await response.json();
        
        // 处理配置更新结果
        if (result.success) {
            addLog('配置更新成功！', 'success');
            addLog(`用户 ${result.data.nickname} 已连接到房间 ${config.roomId}`, 'success');
            
            // 更新预览链接
            updatePreviewLink(config.roomId);
            
            // 立即更新状态显示
            await updateStatus();
        } else {
            addLog('配置更新失败: ' + result.message, 'error');
            showError('配置更新失败: ' + result.message);
        }
    } catch (error) {
        console.error('配置更新失败:', error);
        addLog('配置更新失败: ' + error.message, 'error');
        showError('配置更新失败，请检查网络连接');
    } finally {
        // 恢复提交按钮状态
        const submitButton = configForm.querySelector('button[type="submit"]');
        submitButton.disabled = false;
        submitButton.textContent = '启动挂机';
    }
});

// 房间号输入监听，实时更新预览链接
roomIdInput.addEventListener('input', (e) => {
    updatePreviewLink(e.target.value);
});

// 重连按钮点击处理
reconnectButton.addEventListener('click', attemptReconnect);

// 清除日志按钮点击处理
clearLogsButton.addEventListener('click', () => {
    logContainer.innerHTML = '';
    addLog('日志已清除', 'info');
});

// 自动滚动开关处理
autoScrollToggle.addEventListener('click', () => {
    autoScrollEnabled = !autoScrollEnabled;
    autoScrollToggle.textContent = `自动滚动: ${autoScrollEnabled ? '开启' : '关闭'}`;
    addLog(`自动滚动已${autoScrollEnabled ? '开启' : '关闭'}`, 'info');
});

// 关闭错误弹窗
closeErrorModal.addEventListener('click', () => {
    errorModal.classList.add('hidden');
});

// 页面加载完成后的初始化
document.addEventListener('DOMContentLoaded', async () => {
    // 初始化系统时间显示并设置定时更新
    updateSystemTime();
    setInterval(updateSystemTime, 1000);
    
    // 初始化运行时长显示并设置定时更新
    updateRunningTime();
    setInterval(updateRunningTime, 60000);
    
    // 初始化状态显示
    await updateStatus();
    
    // 设置定时状态更新（每30秒更新一次）
    setInterval(updateStatus, 30000);
    
    addLog('系统初始化完成', 'success');
});

// 添加全局错误处理
window.addEventListener('error', (event) => {
    console.error('全局错误:', event.error);
    addLog('系统错误: ' + event.error.message, 'error');
    showError('发生系统错误: ' + event.error.message);
});

// 添加未处理的Promise错误处理
window.addEventListener('unhandledrejection', (event) => {
    console.error('未处理的Promise错误:', event.reason);
    addLog('系统错误: ' + event.reason.message, 'error');
    showError('发生系统错误: ' + event.reason.message);
});

// 页面关闭前的清理工作
window.addEventListener('beforeunload', () => {
    // 记录关闭状态
    addLog('系统正在关闭...', 'info');
    
    // 尝试优雅地关闭连接
    try {
        fetch('/api/status', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                action: 'shutdown',
                timestamp: new Date().toISOString()
            })
        }).catch(() => {}); // 忽略可能的错误，因为页面正在关闭
    } catch (error) {
        console.error('关闭清理失败:', error);
    }
});

// 添加心跳超时检测
let lastHeartbeatCheck = Date.now();
setInterval(() => {
    const now = Date.now();
    if (now - lastHeartbeatCheck > 5 * 60 * 1000) { // 5分钟没有心跳
        addLog('检测到心跳超时，尝试重新连接...', 'warning');
        attemptReconnect();
    }
    lastHeartbeatCheck = now;
}, 60 * 1000); // 每分钟检查一次

// 添加网络状态监听
window.addEventListener('online', () => {
    addLog('网络连接已恢复', 'success');
    attemptReconnect();
});

window.addEventListener('offline', () => {
    addLog('网络连接已断开', 'error');
    showError('网络连接已断开，请检查网络设置');
    updateWebSocketStatus('3'); // 显示断开状态
});