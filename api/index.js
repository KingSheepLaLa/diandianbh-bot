const express = require('express');
const axios = require('axios');
const path = require('path');
const qs = require('qs');

const app = express();

// 中间件配置
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

// 全局状态管理
const globalState = {
    cookie: '',
    roomId: '',
    userId: '',
    nickname: '',
    neteaseToken: '',
    lastHeartbeat: null,
    lastReport: null,
    isConnected: false,
    startTime: new Date(),
    retryCount: 0,
    maxRetries: 3,
    heartbeatInterval: null
};

// 创建axios实例
const api = axios.create({
    timeout: 10000,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'sec-ch-ua': '"Not A(Brand";v="8", "Chromium";v="132"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"'
    }
});

// 生成jQuery回调标识符
function generateCallback() {
    return `jQuery${Math.random().toString().slice(2)}_${Date.now()}`;
}

// JSONP响应解析
function parseJsonp(response) {
    try {
        if (!response || !response.data) {
            console.error('JSONP响应为空');
            return null;
        }

        const match = response.data.match(/\((.*)\)/);
        if (!match || !match[1]) {
            console.error('JSONP格式解析失败');
            return null;
        }

        const jsonData = JSON.parse(match[1]);
        if (typeof jsonData !== 'object') {
            console.error('JSONP响应不是有效的对象');
            return null;
        }

        return jsonData;
    } catch (error) {
        console.error('JSONP解析错误:', error);
        return null;
    }
}

// 完整的进房流程实现
async function joinRoom() {
    if (!globalState.cookie || !globalState.roomId) {
        throw new Error('缺少必要的配置信息');
    }

    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Cookie': globalState.cookie,
        'Referer': `https://y.tuwan.com/chatroom/${globalState.roomId}`,
        'Origin': 'https://y.tuwan.com'
    };

    try {
        // 1. 获取用户信息
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
        console.log('用户信息响应:', userInfoData);

        if (!userInfoData || userInfoData.error !== 0 || !userInfoData.data || !userInfoData.data[0]) {
            console.error('用户信息解析失败:', userInfoData);
            throw new Error('获取用户信息失败');
        }

        const userData = userInfoData.data[0];
        globalState.userId = userData.uid;
        globalState.nickname = userData.nickname;

        console.log('成功获取用户信息:', {
            userId: globalState.userId,
            nickname: globalState.nickname
        });

        // 2. 获取房间信息
        console.log('获取房间信息...');
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

        // 3. 获取声网配置
        console.log('获取声网配置...');
        await api.get('https://papi.tuwan.com/Agora/webinfo', {
            params: {
                apiver: '6',
                channel: globalState.roomId,
                callback: generateCallback(),
                _: Date.now()
            },
            headers
        });

        // 4. 获取登录令牌
        console.log('获取登录令牌...');
        const loginResponse = await api.get('https://u.tuwan.com/Netease/login', {
            params: {
                callback: generateCallback(),
                _: Date.now()
            },
            headers
        });

        const loginData = parseJsonp(loginResponse);
        if (!loginData || loginData.error !== 0 || !loginData.token) {
            throw new Error('登录令牌获取失败');
        }

        globalState.neteaseToken = loginData.token;
        console.log('登录令牌获取成功:', globalState.neteaseToken);

        // 5. 加入房间
        console.log('发送加入房间请求...');
        await api.post('https://app-diandian-report.tuwan.com/', 
            qs.stringify({
                roomId: globalState.roomId,
                userId: globalState.userId,
                action: 'joinRoom',
                platform: 'web',
                timestamp: Date.now(),
                token: globalState.neteaseToken
            }),
            { headers }
        );

        // 6. 触发用户列表更新
        await api.get('https://papi.tuwan.com/Chatroom/getuserinfo', {
            params: {
                requestfrom: 'addChannelUsers',
                uids: globalState.userId,
                callback: generateCallback(),
                _: Date.now()
            },
            headers
        });

        // 7. 更新在线状态
        console.log('更新在线状态...');
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
        console.error('进房流程出错:', error);
        throw error;
    }
}

// 心跳包发送实现
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
        // 1. 发送活动心跳
        await api.get('https://activity.tuwan.com/Activitymanagement/activity', {
            params: {
                cid: globalState.roomId,
                from: '1',
                callback: generateCallback(),
                _: Date.now()
            },
            headers
        });

        // 2. 更新在线状态
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
        console.error('心跳发送失败:', error);
        globalState.retryCount++;
        
        if (globalState.retryCount >= globalState.maxRetries) {
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
        console.error('重新连接失败:', error);
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
    }, 30000);
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