const express = require('express');
const axios = require('axios');
const path = require('path');
const qs = require('qs');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

const CONFIG = {
    USER_AGENT: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
    NIM_APP_KEY: '712eb79f6472f09e9d8f19aecba1cf43',
    HEARTBEAT_INTERVAL: 30000,
    MAX_RETRIES: 3,
    API_BASE_URL: 'https://papi.tuwan.com',
    USER_ID: '3286219'
};

const STEPS = {
    BASE_URL: 'baseUrl',
    USER_INFO: 'userInfo',
    ROOM_INFO: 'roomInfo',
    NIM_TOKEN: 'nimToken',
    ROOM_JOIN: 'roomJoin'
};

const globalState = {
    cookie: '',
    roomId: '',
    userId: '',
    nickname: '',
    nimToken: '',
    lastHeartbeat: null,
    lastReport: null,
    isConnected: false,
    startTime: new Date(),
    retryCount: 0,
    heartbeatInterval: null,
    connectionSteps: {
        [STEPS.BASE_URL]: { status: false, timestamp: null, error: null },
        [STEPS.USER_INFO]: { status: false, timestamp: null, error: null },
        [STEPS.ROOM_INFO]: { status: false, timestamp: null, error: null },
        [STEPS.NIM_TOKEN]: { status: false, timestamp: null, error: null },
        [STEPS.ROOM_JOIN]: { status: false, timestamp: null, error: null }
    },
    logs: [],
    lastError: null
};

const api = axios.create({
    timeout: 10000,
    validateStatus: status => status >= 200 && status < 300,
    headers: {
        'User-Agent': CONFIG.USER_AGENT,
        'Accept': '*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Sec-Ch-Ua': '"Not A(Brand";v="8", "Chromium";v="132"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"'
    }
});

function generateCallback() {
    return `jQuery${Math.random().toString().slice(2)}_${Date.now()}`;
}

function getHeaders(roomId = null) {
    const headers = {
        'Cookie': globalState.cookie,
        'Referer': roomId ? `https://y.tuwan.com/chatroom/${roomId}` : 'https://y.tuwan.com/',
        'Origin': 'https://y.tuwan.com',
        'User-Agent': CONFIG.USER_AGENT,
        'Accept': '*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9'
    };
    return headers;
}

function parseJsonp(response) {
    try {
        if (!response?.data) {
            throw new Error('Empty JSONP response');
        }

        const data = response.data.toString().trim();
        const match = data.match(/jQuery[0-9_]+\((.*)\)/);
        
        if (!match?.[1]) {
            throw new Error('Invalid JSONP format');
        }

        return JSON.parse(match[1]);
    } catch (error) {
        console.error('JSONP parsing error:', error.message);
        console.error('Raw response:', response.data);
        throw error;
    }
}

async function addLog(message, type = 'info', details = null) {
    const timestamp = new Date();
    const log = {
        timestamp,
        type,
        message,
        details: details ? JSON.stringify(details) : null
    };

    globalState.logs.unshift(log);
    if (globalState.logs.length > 100) {
        globalState.logs.pop();
    }

    console.log(`[${timestamp.toLocaleTimeString('zh-CN', { hour12: false })}] ${type.toUpperCase()}: ${message}`);
    if (details) {
        console.log('Details:', details);
    }

    return log;
}

function updateConnectionStep(step, status, error = null) {
    globalState.connectionSteps[step] = {
        status,
        timestamp: new Date(),
        error
    };

    if (error) {
        globalState.lastError = error;
    }
}

async function getUserInfo() {
    try {
        await addLog('开始获取用户信息', 'info');

        const userInfoResponse = await api.get(`${CONFIG.API_BASE_URL}/Chatroom/getuserinfo`, {
            params: {
                requestfrom: 'selflogin',
                uids: CONFIG.USER_ID,
                callback: generateCallback(),
                _: Date.now()
            },
            headers: getHeaders()
        });

        await addLog('用户信息原始响应', 'debug', userInfoResponse.data);

        const userData = parseJsonp(userInfoResponse);
        if (!userData || userData.error !== 0) {
            throw new Error('用户验证失败');
        }

        if (!Array.isArray(userData.data) || !userData.data[0]) {
            throw new Error('用户数据格式无效');
        }

        const user = userData.data[0];
        if (!user.uid || !user.nickname) {
            throw new Error('缺少必要的用户信息');
        }

        await addLog('用户信息获取成功', 'success', {
            userId: user.uid,
            nickname: user.nickname
        });

        return {
            success: true,
            data: user
        };
    } catch (error) {
        await addLog('获取用户信息失败', 'error', error.message);
        return {
            success: false,
            error: error.message
        };
    }
}

async function joinRoom() {
    if (!globalState.cookie || !globalState.roomId) {
        throw new Error('缺少必要的配置信息');
    }

    try {
        await addLog('开始执行进房流程', 'info');

        // 1. 获取基础URL配置
        await addLog('获取基础URL配置...', 'info');
        await api.get(`${CONFIG.API_BASE_URL}/Api/getBaseUrl`, {
            params: {
                format: 'jsonp',
                callback: generateCallback(),
                _: Date.now()
            },
            headers: getHeaders()
        });
        updateConnectionStep(STEPS.BASE_URL, true);
        await addLog('基础URL配置获取成功', 'success');

        // 2. 获取用户信息
        const userResult = await getUserInfo();
        if (!userResult.success) {
            throw new Error(`获取用户信息失败: ${userResult.error}`);
        }
        updateConnectionStep(STEPS.USER_INFO, true);

        globalState.userId = userResult.data.uid;
        globalState.nickname = userResult.data.nickname;

        // 3. 获取房间信息
        await addLog('获取房间信息...', 'info');
        await api.get(`${CONFIG.API_BASE_URL}/Chatroom/getPcListV4`, {
            params: {
                ver: '14',
                format: 'jsonp',
                navid: '0',
                cid: globalState.roomId,
                callback: generateCallback(),
                _: Date.now()
            },
            headers: getHeaders(globalState.roomId)
        });
        updateConnectionStep(STEPS.ROOM_INFO, true);
        await addLog('房间信息获取成功', 'success');

        // 4. 获取NIM Token
        await addLog('获取NIM Token...', 'info');
        const loginResponse = await api.get('https://u.tuwan.com/Netease/login', {
            params: {
                callback: generateCallback(),
                _: Date.now()
            },
            headers: getHeaders(globalState.roomId)
        });

        const loginData = parseJsonp(loginResponse);
        if (!loginData?.token) {
            throw new Error('获取登录令牌失败');
        }

        globalState.nimToken = loginData.token;
        updateConnectionStep(STEPS.NIM_TOKEN, true);
        await addLog('NIM Token获取成功', 'success');

        // 5. 加入房间
        await addLog('发送加入房间请求...', 'info');
        await api.post('https://app-diandian-report.tuwan.com/', 
            qs.stringify({
                roomId: globalState.roomId,
                userId: globalState.userId,
                action: 'joinRoom',
                platform: 'web',
                timestamp: Date.now(),
                token: globalState.nimToken
            }),
            { 
                headers: {
                    ...getHeaders(globalState.roomId),
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );

        // 6. 更新在线状态
        await api.post('https://app-diandian-report.tuwan.com/', 
            qs.stringify({
                roomId: globalState.roomId,
                userId: globalState.userId,
                status: 'online',
                timestamp: Date.now()
            }),
            { 
                headers: {
                    ...getHeaders(globalState.roomId),
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );

        updateConnectionStep(STEPS.ROOM_JOIN, true);
        await addLog('进房流程完成', 'success');

        globalState.isConnected = true;
        globalState.retryCount = 0;
        startHeartbeat();
        return true;

    } catch (error) {
        const errorMessage = error.message || '未知错误';
        await addLog('进房流程失败', 'error', errorMessage);
        globalState.lastError = errorMessage;
        throw error;
    }
}

async function sendHeartbeat() {
    if (!globalState.isConnected) {
        return false;
    }

    try {
        await api.get('https://activity.tuwan.com/Activitymanagement/activity', {
            params: {
                cid: globalState.roomId,
                from: '1',
                callback: generateCallback(),
                _: Date.now()
            },
            headers: getHeaders(globalState.roomId)
        });

        await api.post('https://app-diandian-report.tuwan.com/', 
            qs.stringify({
                roomId: globalState.roomId,
                userId: globalState.userId,
                status: 'online',
                timestamp: Date.now()
            }),
            { 
                headers: {
                    ...getHeaders(globalState.roomId),
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );

        globalState.lastHeartbeat = new Date();
        globalState.lastReport = new Date();
        await addLog('心跳包发送成功', 'info');
        return true;
    } catch (error) {
        await addLog('心跳包发送失败', 'error', error.message);
        globalState.retryCount++;
        
        if (globalState.retryCount >= CONFIG.MAX_RETRIES) {
            await reconnect();
        }
        
        return false;
    }
}

async function reconnect() {
    await addLog('开始重新连接...', 'info');
    globalState.isConnected = false;
    clearInterval(globalState.heartbeatInterval);

    try {
        await joinRoom();
        await addLog('重新连接成功', 'success');
        globalState.retryCount = 0;
    } catch (error) {
        await addLog('重新连接失败', 'error', error.message);
        throw error;
    }
}

function startHeartbeat() {
    if (globalState.heartbeatInterval) {
        clearInterval(globalState.heartbeatInterval);
    }

    sendHeartbeat().catch(console.error);
    globalState.heartbeatInterval = setInterval(() => {
        sendHeartbeat().catch(console.error);
    }, CONFIG.HEARTBEAT_INTERVAL);
}

app.post('/api/update-config', async (req, res) => {
    const { roomId, cookie } = req.body;
    
    if (!roomId || !cookie) {
        return res.status(400).json({
            success: false,
            message: '请提供完整的配置信息'
        });
    }

    try {
        if (globalState.heartbeatInterval) {
            clearInterval(globalState.heartbeatInterval);
        }

        await addLog('更新配置信息...', 'info');
        globalState.cookie = cookie;
        globalState.roomId = roomId;
        globalState.isConnected = false;
        
        // 重置连接步骤状态
        Object.keys(globalState.connectionSteps).forEach(step => {
            globalState.connectionSteps[step] = {
                status: false,
                timestamp: null,
                error: null
            };
        });
        
        await joinRoom();

        res.json({
            success: true,
            message: '成功进入房间',
            data: {
                roomId,
                userId: globalState.userId,
                nickname: globalState.nickname,
                timestamp: Date.now()
            }
        });
    } catch (error) {
        await addLog('配置更新失败', 'error', error.message);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

app.get('/api/status', (req, res) => {
    res.json({
        isConnected: globalState.isConnected,
        lastHeartbeat: globalState.lastHeartbeat,
        lastReport: globalState.lastReport,
        roomId: globalState.roomId,
        userId: globalState.userId,
        nickname: globalState.nickname,
        startTime: globalState.startTime,
        uptime: Date.now() - globalState.startTime,
        retryCount: globalState.retryCount,
        connectionSteps: globalState.connectionSteps,
        lastError: globalState.lastError,
        logs: globalState.logs.slice(0, 20)
    });
});

app.get('/api/logs', (req, res) => {
    const limit = parseInt(req.query.limit) || 100;
    res.json({
        logs: globalState.logs.slice(0, limit)
    });
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString()
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`服务器启动成功，监听端口 ${PORT}`);
});

module.exports = app;

// 辅助函数：生成 API 响应格式
function generateApiResponse(success, message, data = null) {
    return {
        success,
        message,
        timestamp: new Date().toISOString(),
        data
    };
}

// 辅助函数：格式化时间显示
function formatDateTime(date) {
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

// 辅助函数：计算运行时长
function calculateUptime() {
    const diff = Date.now() - globalState.startTime.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}小时${minutes}分钟`;
}

// 辅助函数：生成状态摘要
function generateStatusSummary() {
    return {
        currentStatus: {
            connected: globalState.isConnected,
            roomStatus: globalState.roomId ? `已进入房间 ${globalState.roomId}` : '未进入房间',
            userStatus: globalState.userId ? `已登录 (${globalState.nickname})` : '未登录',
            lastHeartbeat: formatDateTime(globalState.lastHeartbeat),
            lastReport: formatDateTime(globalState.lastReport)
        },
        systemInfo: {
            uptime: calculateUptime(),
            startTime: formatDateTime(globalState.startTime),
            retryCount: globalState.retryCount,
            systemStatus: globalState.isConnected ? '正常' : '异常'
        },
        connectionProgress: {
            steps: globalState.connectionSteps,
            currentStep: getCurrentConnectionStep(),
            lastError: globalState.lastError
        }
    };
}

// 辅助函数：获取当前连接步骤
function getCurrentConnectionStep() {
    const steps = Object.entries(globalState.connectionSteps);
    const currentStep = steps.find(([_, status]) => !status.status);
    return currentStep ? currentStep[0] : 'complete';
}

// 错误处理中间件
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    const errorResponse = generateApiResponse(false, '服务器内部错误', {
        error: err.message,
        timestamp: new Date().toISOString()
    });
    res.status(500).json(errorResponse);
});

// 未找到路由处理
app.use((req, res) => {
    res.status(404).json(generateApiResponse(false, '请求的资源不存在'));
});

// 进程异常处理
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
    addLog('系统发生致命错误', 'error', err.message).catch(console.error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Promise Rejection:', reason);
    addLog('系统发生未处理的 Promise 错误', 'error', reason).catch(console.error);
});

// 优雅关闭
process.on('SIGTERM', async () => {
    console.log('Received SIGTERM signal, starting graceful shutdown...');
    await addLog('系统正在关闭...', 'info');
    
    // 清理定时器
    if (globalState.heartbeatInterval) {
        clearInterval(globalState.heartbeatInterval);
    }

    // 如果需要，可以在这里添加其他清理工作
    
    process.exit(0);
});