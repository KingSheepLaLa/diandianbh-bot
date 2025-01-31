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

// 记录系统启动时间
const startTime = new Date();

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
    
    logContainer.insertBefore(logItem, logContainer.firstChild);

    if (logContainer.children.length > 100) {
        logContainer.removeChild(logContainer.lastChild);
    }
}

function updateSystemTime() {
    systemTime.textContent = new Date().toLocaleString();
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

async function updateStatus() {
    try {
        const response = await fetch('/api/status');
        const status = await response.json();
        
        if (status.isLoggedIn && status.userData) {
            userInfo.innerHTML = `
                <p>用户名: <span class="font-medium">${status.userData.nickname || '未知'}</span></p>
                <p>账号 ID: <span class="text-gray-600">${status.userData.accid || '未知'}</span></p>
                <p>状态: <span class="text-green-600 font-medium">已登录</span></p>
                <p>最后更新: <span class="text-gray-600">${new Date().toLocaleString()}</span></p>
            `;
        } else {
            userInfo.innerHTML = `
                <p>状态: <span class="text-red-600 font-medium">未登录</span></p>
                <p>请配置Cookie和房间号</p>
            `;
        }
        
        if (status.roomId) {
            currentRoom.innerHTML = `<a href="https://y.tuwan.com/chatroom/${status.roomId}" target="_blank" class="text-blue-600 hover:text-blue-800">${status.roomId}</a>`;
            roomIdInput.value = status.roomId;
            updatePreviewLink(status.roomId);
        } else {
            currentRoom.textContent = '未设置';
        }
        
        heartbeatStatus.textContent = status.heartbeatStatus ? '正常' : '异常';
        heartbeatStatus.className = status.heartbeatStatus ? 'text-green-600 font-medium' : 'text-red-600 font-medium';
        
        if (status.lastHeartbeat) {
            lastHeartbeat.textContent = new Date(status.lastHeartbeat).toLocaleString();
        }
        
        if (status.lastStatusReport) {
            lastReport.textContent = new Date(status.lastStatusReport).toLocaleString();
        }
        
        updateRunningTime();
    } catch (error) {
        console.error('获取状态失败:', error);
        addLog('获取状态失败: ' + error.message, 'error');
        systemStatus.textContent = '异常';
        systemStatus.className = 'text-red-600 font-medium';
    }
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
            
            updatePreviewLink(config.roomId);
            await updateStatus();
        } else {
            addLog('配置更新失败: ' + result.message, 'error');
        }
    } catch (error) {
        console.error('配置更新失败:', error);
        addLog('配置更新失败: ' + error.message, 'error');
    } finally {
        const submitButton = configForm.querySelector('button[type="submit"]');
        submitButton.disabled = false;
        submitButton.textContent = '启动挂机';
    }
});

roomIdInput.addEventListener('input', (e) => {
    updatePreviewLink(e.target.value);
});

clearLogsButton.addEventListener('click', () => {
    logContainer.innerHTML = '';
    addLog('日志已清除', 'info');
});

document.addEventListener('DOMContentLoaded', async () => {
    updateSystemTime();
    setInterval(updateSystemTime, 1000);
    
    updateRunningTime();
    setInterval(updateRunningTime, 60000);
    
    await updateStatus();
    setInterval(updateStatus, 30000);
    
    addLog('系统初始化完成', 'success');
});

window.addEventListener('error', (event) => {
    console.error('全局错误:', event.error);
    addLog('系统错误: ' + event.error.message, 'error');
});

window.addEventListener('unhandledrejection', (event) => {
    console.error('未处理的Promise错误:', event.reason);
    addLog('系统错误: ' + event.reason.message, 'error');
});

window.addEventListener('beforeunload', () => {
    addLog('系统正在关闭...', 'info');
});