// 获取页面元素引用
const configForm = document.getElementById('configForm');
const roomIdInput = document.getElementById('roomId');
const previewLink = document.getElementById('previewLink');
const userInfo = document.getElementById('userInfo');
const currentRoom = document.getElementById('currentRoom');
const heartbeatStatus = document.getElementById('heartbeatStatus');
const lastHeartbeat = document.getElementById('lastHeartbeat');
const lastReport = document.getElementById('lastReport');
const runningTime = document.getElementById('runningTime');
const systemTime = document.getElementById('systemTime');
const systemStatus = document.getElementById('systemStatus');
const logContainer = document.getElementById('logContainer');
const clearLogsButton = document.getElementById('clearLogs');

// 记录系统启动时间，用于计算运行时长
const startTime = new Date();

/**
 * 添加日志条目到日志容器
 * 支持不同类型的日志（info/error/success）并确保日志数量在可控范围内
 * @param {string} message - 日志消息内容
 * @param {string} type - 日志类型，影响显示样式
 */
function addLog(message, type = 'info') {
    const logItem = document.createElement('div');
    logItem.className = `log-item ${type === 'error' ? 'log-error' : type === 'success' ? 'log-success' : ''}`;
    
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

    // 限制日志数量，避免内存占用过大
    if (logContainer.children.length > 100) {
        logContainer.removeChild(logContainer.lastChild);
    }
}

/**
 * 更新系统时间显示
 * 使用本地时间格式显示当前时间
 */
function updateSystemTime() {
    systemTime.textContent = new Date().toLocaleString();
}

/**
 * 更新运行时长显示
 * 计算并格式化从系统启动到现在的时间差
 */
function updateRunningTime() {
    const now = new Date();
    const diff = now - startTime;
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    runningTime.textContent = `${hours}小时${minutes}分钟`;
}

/**
 * 更新房间预览链接
 * 根据输入的房间号更新预览链接的状态和地址
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
 * 从服务器获取最新状态并更新界面各个部分的显示
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
    } catch (error) {
        console.error('获取状态失败:', error);
        addLog('获取状态失败: ' + error.message, 'error');
        systemStatus.textContent = '异常';
        systemStatus.className = 'text-red-600 font-medium';
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
        }
    } catch (error) {
        console.error('配置更新失败:', error);
        addLog('配置更新失败: ' + error.message, 'error');
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

// 清除日志按钮点击处理
clearLogsButton.addEventListener('click', () => {
    logContainer.innerHTML = '';
    addLog('日志已清除', 'info');
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
});

// 添加未处理的Promise错误处理
window.addEventListener('unhandledrejection', (event) => {
    console.error('未处理的Promise错误:', event.reason);
    addLog('系统错误: ' + event.reason.message, 'error');
});

// 页面关闭前的清理工作
window.addEventListener('beforeunload', () => {
    addLog('系统正在关闭...', 'info');
});