// public/script.js

// 获取页面上的所有重要元素引用
const configForm = document.getElementById('configForm');
const roomIdInput = document.getElementById('roomId');
const previewLink = document.getElementById('previewLink');
const userInfo = document.getElementById('userInfo');
const currentRoom = document.getElementById('currentRoom');
const heartbeatStatus = document.getElementById('heartbeatStatus');
const lastHeartbeat = document.getElementById('lastHeartbeat');
const runningTime = document.getElementById('runningTime');
const systemTime = document.getElementById('systemTime');
const systemStatus = document.getElementById('systemStatus');
const logContainer = document.getElementById('logContainer');
const clearLogsButton = document.getElementById('clearLogs');

// 记录系统启动时间
const startTime = new Date();

// 添加日志的函数，用于在界面上显示运行状态和重要信息
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
    
    // 将新日志插入到顶部
    logContainer.insertBefore(logItem, logContainer.firstChild);

    // 保持日志数量在合理范围内（最多显示100条）
    if (logContainer.children.length > 100) {
        logContainer.removeChild(logContainer.lastChild);
    }
}

// 更新系统时间显示
function updateSystemTime() {
    systemTime.textContent = new Date().toLocaleString();
}

// 更新运行时长显示
function updateRunningTime() {
    const now = new Date();
    const diff = now - startTime;
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    runningTime.textContent = `${hours}小时${minutes}分钟`;
}

// 更新房间预览链接
function updatePreviewLink(roomId) {
    if (roomId && /^\d+$/.test(roomId)) {
        previewLink.href = `https://y.tuwan.com/chatroom/${roomId}`;
        previewLink.classList.remove('opacity-50', 'pointer-events-none');
    } else {
        previewLink.href = '#';
        previewLink.classList.add('opacity-50', 'pointer-events-none');
    }
}

// 更新系统状态显示的函数
async function updateStatus() {
    try {
        const response = await fetch('/api/status');
        const status = await response.json();
        
        // 更新用户信息显示
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
        
        // 更新房间信息
        if (status.roomId) {
            currentRoom.innerHTML = `<a href="https://y.tuwan.com/chatroom/${status.roomId}" target="_blank" class="text-blue-600 hover:text-blue-800">${status.roomId}</a>`;
            roomIdInput.value = status.roomId;
            updatePreviewLink(status.roomId);
        } else {
            currentRoom.textContent = '未设置';
        }
        
        // 更新心跳状态
        heartbeatStatus.textContent = status.heartbeatStatus ? '正常' : '异常';
        heartbeatStatus.className = status.heartbeatStatus ? 'text-green-600 font-medium' : 'text-red-600 font-medium';
        
        // 更新最后心跳时间
        if (status.lastHeartbeat) {
            lastHeartbeat.textContent = new Date(status.lastHeartbeat).toLocaleString();
        }
        
        updateRunningTime();
    } catch (error) {
        console.error('获取状态失败:', error);
        addLog('获取状态失败: ' + error.message, 'error');
        systemStatus.textContent = '异常';
        systemStatus.className = 'text-red-600 font-medium';
    }
}

// 处理配置表单提交
configForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const formData = new FormData(configForm);
    const config = {
        roomId: formData.get('roomId'),
        cookie: formData.get('cookie')
    };

    try {
        const response = await fetch('/api/update-config', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(config),
        });

        const result = await response.json();
        
        if (result.success) {
            addLog('配置更新成功！开始挂机', 'success');
            updateStatus();
        } else {
            addLog('配置更新失败: ' + result.message, 'error');
        }
    } catch (error) {
        addLog('请求失败: ' + error.message, 'error');
    }
});

// 监听房间号输入，更新预览链接
roomIdInput.addEventListener('input', (e) => {
    const roomId = e.target.value.trim();
    updatePreviewLink(roomId);
});

// 清除日志按钮点击处理
clearLogsButton.addEventListener('click', () => {
    logContainer.innerHTML = '';
    addLog('日志已清除', 'info');
});

// 设置定时任务
setInterval(updateStatus, 30000);     // 每30秒更新一次状态
setInterval(updateSystemTime, 1000);  // 每秒更新系统时间
setInterval(updateRunningTime, 60000); // 每分钟更新运行时间

// 页面加载完成后的初始化
updateSystemTime();
updateStatus();
addLog('控制台启动完成', 'success');