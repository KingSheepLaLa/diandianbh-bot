const express = require('express');
const axios = require('axios');
const path = require('path');
const qs = require('qs');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

const CONFIG = {
    USER_AGENT: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    NIM_APP_KEY: '712eb79f6472f09e9d8f19aecba1cf43',
    HEARTBEAT_INTERVAL: 30000,
    MAX_RETRIES: 3
};

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

const api = axios.create({
    timeout: 10000,
    headers: {
        'User-Agent': CONFIG.USER_AGENT,
        'Accept': '*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br'
    }
});

function generateCallback() {
    return `jQuery${Math.random().toString().slice(2)}_${Date.now()}`;
}

function parseJsonp(response) {
    try {
        if (!response?.data) {
            console.error('JSONP响应为空');
            return null;
        }

        const data = response.data.trim();
        const match = data.match(/(?:jQuery[0-9_]+\(|\()(.+?)(?:\))?$/);
        if (!match?.[1]) {
            console.error('JSONP格式无效:', data);
            return null;
        }

        const jsonData = JSON.parse(match[1]);
        console.log('解析JSONP数据:', jsonData);
        return jsonData;
    } catch (error) {
        console.error('JSONP解析错误:', error, '原始数据:', response.data);
        return null;
    }
}

async function getUserInfo(headers) {
    try {
        console.log('开始获取用户信息...');
        
        const userInfoResponse = await api.get('https://papi.tuwan.com/Chatroom/getuserinfo', {
            params: {
                requestfrom: 'selflogin',
                callback: generateCallback(),
                _: Date.now(),
                t: Date.now()
            },
            headers: {
                ...headers,
                'Referer': 'https://y.tuwan.com/',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            }
        });

        console.log('用户信息原始响应:', userInfoResponse.data);
        
        const userInfoData = parseJsonp(userInfoResponse);
        if (!userInfoData || userInfoData.error !== 0) {
            throw new Error('用户验证失败');
        }

        if (!userInfoData.data?.[0]?.uid) {
            throw new Error('用户数据格式无效');
        }

        return {
            success: true,
            data: userInfoData.data[0]
        };
    } catch (error) {
        console.error('获取用户信息失败:', error);
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

    const headers = {
        'User-Agent': CONFIG.USER_AGENT,
        'Accept': '*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Cookie': globalState.cookie,
        'Referer': 'https://y.tuwan.com/',
        'Origin': 'https://y.tuwan.com',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
    };

    try {
        // 获取用户信息
        const userResult = await getUserInfo(headers);
        if (!userResult.success) {
            throw new Error('获取用户信息失败: ' + userResult.error);
        }

        globalState.userId = userResult.data.uid;
        globalState.nickname = userResult.data.nickname;

        console.log('用户信息获取成功:', {
            userId: globalState.userId,
            nickname: globalState.nickname
        });

        // 获取房间列表
        await api.get('https://papi.tuwan.com/Chatroom/getPcListV4', {
            params: {
                ver: '14',
                format: 'jsonp',
                navid: '0',
                cid: globalState.roomId,
                callback: generateCallback(),
                _: Date.now()
            },
            headers: {
                ...headers,
                'Referer': `https://y.tuwan.com/chatroom/${globalState.roomId}`
            }
        });

        // 获取NIM Token
        const loginResponse = await api.get('https://u.tuwan.com/Netease/login', {
            params: {
                callback: generateCallback(),
                _: Date.now()
            },
            headers: {
                ...headers,
                'Referer': `https://y.tuwan.com/chatroom/${globalState.roomId}`
            }
        });

        const loginData = parseJsonp(loginResponse);
        if (!loginData?.token) {
            throw new Error('获取登录令牌失败');
        }

        globalState.nimToken = loginData.token;

        // 初始化房间
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
                    ...headers,
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Referer': `https://y.tuwan.com/chatroom/${globalState.roomId}`
                } 
            }
        );

        // 更新在线状态
        await api.post('https://app-diandian-report.tuwan.com/', 
            qs.stringify({
                roomId: globalState.roomId,
                userId: globalState.userId,
                status: 'online',
                timestamp: Date.now()
            }),
            { 
                headers: {
                    ...headers,
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Referer': `https://y.tuwan.com/chatroom/${globalState.roomId}`
                }
            }
        );

        console.log('进房流程完成');
        globalState.isConnected = true;
        globalState.retryCount = 0;
        startHeartbeat();
        return true;

    } catch (error) {
        console.error('进房流程出错:', error);
        throw error;
    }
}

async function sendHeartbeat() {
    if (!globalState.isConnected) {
        return false;
    }

    const headers = {
        'User-Agent': CONFIG.USER_AGENT,
        'Cookie': globalState.cookie,
        'Referer': `https://y.tuwan.com/chatroom/${globalState.roomId}`,
        'Origin': 'https://y.tuwan.com'
    };

    try {
        await api.get('https://activity.tuwan.com/Activitymanagement/activity', {
            params: {
                cid: globalState.roomId,
                from: '1',
                callback: generateCallback(),
                _: Date.now()
            },
            headers
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
                    ...headers,
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );

        globalState.lastHeartbeat = new Date();
        globalState.lastReport = new Date();
        return true;
    } catch (error) {
        console.error('心跳发送失败:', error);
        globalState.retryCount++;
        
        if (globalState.retryCount >= CONFIG.MAX_RETRIES) {
            await reconnect();
        }
        
        return false;
    }
}

async function reconnect() {
    console.log('开始重新连接...');
    globalState.isConnected = false;
    clearInterval(globalState.heartbeatInterval);

    try {
        await joinRoom();
        console.log('重新连接成功');
        globalState.retryCount = 0;
    } catch (error) {
        console.error('重新连接失败:', error);
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