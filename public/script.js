// 获取页面元素
const cookieForm = document.getElementById('cookieForm');
const userInfo = document.getElementById('userInfo');
const heartbeatStatus = document.getElementById('heartbeatStatus');
const lastHeartbeat = document.getElementById('lastHeartbeat');
const runningTime = document.getElementById('runningTime');
const systemTime = document.getElementById('systemTime');
const logContainer = document.getElementById('logContainer');
const clearLogsButton = document.getElementById('clearLogs');

// 系统启动时间
const startTime = new Date();

// 添加日志的函数
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

    // 保持日志数量在合理范围
    if (logContainer.children.length > 100) {
        logContainer.removeChild(logContainer.lastChild);
    }
}

// 更新系统时间
function updateSystemTime() {
    systemTime.textContent = new Date().toLocaleString();
}

// 更新运行时间
function updateRunningTime() {
    const now = new Date();
    const diff = now - startTime;
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    runningTime.textContent = `${hours}小时${minutes}分钟`;
}

// 更新状态的函数
async function updateStatus() {
    try {
        const response = await fetch('/api/status');
        const status = await response.json();
        
        // 更新用户信息
        if (status.userData) {
            userInfo.innerHTML = `
                <p>用户名: <span class="font-medium">${status.userData.nickname || '未知'}</span></p>
                <p>状态: <span class="text-green-600 font-medium">已登录</span></p>
                <p>最后更新: <span class="text-gray-600">${new Date(status.userData.lastUpdate).toLocaleString()}</span></p>
            `;
        } else {
            userInfo.innerHTML = `
                <p>状态: <span class="text-red-600 font-medium">未登录</span></p>
                <p>请更新Cookie</p>
            `;
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
    }
}

// 处理Cookie提交
cookieForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const formData = new FormData(cookieForm);
    const cookie = formData.get('cookie');

    try {
        const response = await fetch('/api/update-cookie', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ cookie }),
        });

        const result = await response.json();
        
        if (result.success) {
            addLog('Cookie更新成功！', 'success');
            updateStatus();
        } else {
            addLog('Cookie更新失败: ' + result.message, 'error');
        }
    } catch (error) {
        addLog('请求失败: ' + error.message, 'error');
    }
});

// 清除日志
clearLogsButton.addEventListener('click', () => {
    logContainer.innerHTML = '';
    addLog('日志已清除', 'info');
});

// 定期更新
setInterval(updateStatus, 30000);    // 每30秒更新一次状态
setInterval(updateSystemTime, 1000); // 每秒更新系统时间
setInterval(updateRunningTime, 60000); // 每分钟更新运行时间

// 页面加载时初始化
updateSystemTime();
updateStatus();
addLog('控制台启动完成', 'success');