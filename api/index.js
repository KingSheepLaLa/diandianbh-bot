const express = require('express');
const axios = require('axios');
const path = require('path');
const qs = require('qs');

const app = express();

// 中间件配置
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

// 系统配置常量
const CONFIG = {
    USER_AGENT: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
    NIM_APP_KEY: '712eb79f6472f09e9d8f19aecba1cf43',
    HEARTBEAT_INTERVAL: 30000,
    MAX_RETRIES: 3
};

// 全局状态管理
const globalState = {
    cookie: '',
    roomId: '',
    userId: '',
    nickname: '',
    nimToken: '',
    passportValue: '',
    lastHeartbeat: null,
    lastReport: null,
    isConnected: false,
    startTime: new Date(),
    retryCount: 0,
    heartbeatInterval: null
};

// 创建axios实例
const api = axios.create({
    timeout: 10000,
    headers: {
        'User-Agent': CONFIG.USER_AGENT,
        'Accept': '*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br'
    }
});

// 生成回调标识符
function generateCallback() {
    return `jQuery${Math.random().toString().slice(2)}_${Date.now()}`;
}

// 解析JSONP响应
function parseJsonp(response) {
    try {
        if (!response?.data) {
            console.error('Empty JSONP response');
            return null;
        }

        // 处理jQuery回调格式
        const match = response.data.match(/(?:jQuery[0-9_]+\(|\()(.+?)(?:\);?|$)/);
        if (!match?.[1]) {
            console.error('Invalid JSONP format:', response.data);
            return null;
        }

        const jsonData = JSON.parse(match[1]);
        console.log('Parsed JSONP data:', jsonData);
        return jsonData;
    } catch (error) {
        console.error('JSONP parsing error:', error, 'Raw response:', response.data);
        return null;
    }
}

// 从Cookie中提取Passport值
function extractPassportFromCookie(cookie) {
    const match = cookie.match(/Tuwan_Passport=([^;]+)/);
    return match?.[1] || null;
}

// 进房流程实现
async function joinRoom() {
    if (!globalState.cookie || !globalState.roomId) {
        throw new Error('缺少必要的配置信息');
    }

    // 从Cookie中提取Passport
    globalState.passportValue = extractPassportFromCookie(globalState.cookie);
    if (!globalState.passportValue) {
        throw new Error('无法获取登录凭证');
    }

    const headers = {
        'User-Agent': CONFIG.USER_AGENT,
        'Accept': '*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Cookie': globalState.cookie,
        'Referer': `https://y.tuwan.com/chatroom/${globalState.roomId}`,
        'Origin': 'https://y.tuwan.com',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
    };

    try {
        // 1. TGID验证
        console.log('执行TGID验证...');
        await api.get('https://y.tuwan.com/sendTGID.ashx', {
            params: {
                callback: 'console.log',
                _: Date.now()
            },
            headers: {
                ...headers,
                'Referer': 'https://y.tuwan.com/'
            }
        });

        // 2. 获取用户信息
        console.log('获取用户信息...');
        const userInfoResponse = await api.get('https://papi.tuwan.com/Chatroom/getuserinfo', {
            params: {
                requestfrom: 'selflogin',
                callback: generateCallback(),
                _: Date.now()
            },
            headers: {
                ...headers,
                'Referer': 'https://y.tuwan.com/'
            }
        });

        const userInfoData = parseJsonp(userInfoResponse);
        console.log('User info response:', userInfoData);

        if (!userInfoData?.data?.[0]?.uid) {
            console.error('Invalid user information:', userInfoData);
            throw new Error('获取用户信息失败');
        }

        globalState.userId = userInfoData.data[0].uid;
        globalState.nickname = userInfoData.data[0].nickname;

        console.log('用户信息获取成功:', {
            userId: globalState.userId,
            nickname: globalState.nickname
        });

        // 3. 获取房间列表
        console.log('获取房间列表...');
        await api.get('https://papi.tuwan.com/Chatroom/getPcListV4', {
            params: {
                ver: '14',
                format: 'jsonp',
                navid: '0',
                cid: globalState.roomId,
                callback: generateCallback(),
                _: Date.now()
            },
            headers
        });

        // 4. 获取NIM Token
        console.log('获取NIM Token...');
        const loginResponse = await api.get('https://u.tuwan.com/Netease/login', {
            params: {
                callback: generateCallback(),
                _: Date.now()
            },
            headers
        });

        const loginData = parseJsonp(loginResponse);
        if (!loginData?.token) {
            throw new Error('获取NIM Token失败');
        }

        globalState.nimToken = loginData.token;

        // 5. 初始化房间连接
        console.log('初始化房间连接...');
        await api.get('https://papi.tuwan.com/Agora/webinfo', {
            params: {
                apiver: '6',
                channel: globalState.roomId,
                callback: generateCallback(),
                _: Date.now()
            },
            headers
        });

        // 6. 加入房间
        console.log('发送加入房间请求...');
        await api.post('https://app-diandian-report.tuwan.com/', 
            qs.stringify({
                roomId: globalState.roomId,
                userId: globalState.userId,
                action: 'joinRoom',
                platform: 'web',
                timestamp: Date.now(),
                token: globalState.nimToken,
                passportValue: globalState.passportValue
            }),
            { headers }
        );

        // 7. 更新房间成员列表
        await api.get('https://papi.tuwan.com/Chatroom/getuserinfo', {
            params: {
                requestfrom: 'addChannelUsers',
                uids: globalState.userId,
                callback: generateCallback(),
                _: Date.now()
            },
            headers
        });

        // 8. 更新在线状态
        await api.post('https://app-diandian-report.tuwan.com/', 
            qs.stringify({
                roomId: globalState.roomId,
                userId: globalState.userId,
                status: 'online',
                timestamp: Date.now()
            }),
            { headers }
        );

        console.log('进房流程完成');
        globalState.isConnected = true;
        globalState.retryCount = 0;
        startHeartbeat();
        return true;

    } catch (error) {
        console.error('进房流程出错:', error?.response?.data || error.message);
        throw error;
    }
}

// 心跳包实现
async function sendHeartbeat() {
    if (!globalState.isConnected) {
        console.log('未连接，跳过心跳');
        return false;
    }

    const headers = {
        'Cookie': globalState.cookie,
        'Referer': `https://y.tuwan.com/chatroom/${globalState.roomId}`,
        'Origin': 'https://y.tuwan.com'
    };

    try {
        // 1. 活动心跳
        await api.get('https://activity.tuwan.com/Activitymanagement/activity', {
            params: {
                cid: globalState.roomId,
                from: '1',
                callback: generateCallback(),
                _: Date.now()
            },
            headers
        });

        // 2. 状态上报
        await api.post('https://app-diandian-report.tuwan.com/', 
            qs.stringify({
                roomId: globalState.roomId,
                userId: globalState.userId,
                status: 'online',
                timestamp: Date.now()
            }),
            { headers }
        );

        globalState.lastHeartbeat = new Date();
        globalState.lastReport = new Date();
        return true;
    } catch (error) {
        console.error('心跳发送失败:', error.message);
        globalState.retryCount++;
        
        if (globalState.retryCount >= CONFIG.MAX_RETRIES) {
            console.log('心跳失败次数过多，尝试重新进房...');
            await reconnect();
        }
        
        return false;
    }
}

// 重连机制实现
async function reconnect() {
    console.log('开始重新连接...');
    globalState.isConnected = false;
    clearInterval(globalState.heartbeatInterval);

    try {
        await joinRoom();
        console.log('重新连接成功');
        globalState.retryCount = 0;
    } catch (error) {
        console.error('重新连接失败:', error.message);
        throw error;
    }
}

// 启动心跳
function startHeartbeat() {
    if (globalState.heartbeatInterval) {
        clearInterval(globalState.heartbeatInterval);
    }

    sendHeartbeat().catch(console.error);
    globalState.heartbeatInterval = setInterval(() => {
        sendHeartbeat().catch(console.error);
    }, CONFIG.HEARTBEAT_INTERVAL);
}

// API路由实现
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

        globalState.cookie = cookie;
        globalState.roomId = roomId;
        globalState.isConnected = false;
        
        await joinRoom();

        res.json({
            success: true,
            message: '成功进入房间',
            data: {
                roomId: roomId,
                userId: globalState.userId,
                nickname: globalState.nickname,
                timestamp: Date.now()
            }
        });
    } catch (error) {
        console.error('配置更新失败:', error);
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
        retryCount: globalState.retryCount
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