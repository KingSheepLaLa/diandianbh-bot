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
    lastHeartbeat: null,
    lastReport: null,
    isConnected: false,
    startTime: new Date(),
    connectionQueue: Promise.resolve(),
    retryCount: 0,
    maxRetries: 3
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

// 生成回调函数名
function generateCallback() {
    return `jQuery${Math.random().toString().slice(2)}_${Date.now()}`;
}

// 解析JSONP响应
function parseJsonp(response) {
    try {
        const match = response.match(/\((.*)\)/);
        if (match) {
            return JSON.parse(match[1]);
        }
        return null;
    } catch (error) {
        console.error('解析JSONP响应失败:', error);
        return null;
    }
}

// 完整的进房流程
async function joinRoom() {
    try {
        console.log('开始进房流程...');

        // 1. 获取baseUrl
        const baseUrlResponse = await api.get('https://papi.tuwan.com/Api/getBaseUrl', {
            params: {
                format: 'jsonp',
                callback: generateCallback(),
                _: Date.now()
            },
            headers: {
                'Cookie': globalState.cookie,
                'Referer': `https://y.tuwan.com/chatroom/${globalState.roomId}`
            }
        });

        // 2. 获取房间列表
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
                'Cookie': globalState.cookie,
                'Referer': `https://y.tuwan.com/chatroom/${globalState.roomId}`
            }
        });

        // 3. 获取网页信息
        await api.get('https://papi.tuwan.com/Agora/webinfo', {
            params: {
                apiver: '6',
                channel: globalState.roomId,
                callback: generateCallback(),
                _: Date.now()
            },
            headers: {
                'Cookie': globalState.cookie,
                'Referer': `https://y.tuwan.com/chatroom/${globalState.roomId}`
            }
        });

        // 4. 获取用户信息
        const userInfoResponse = await api.get('https://papi.tuwan.com/Chatroom/getuserinfo', {
            params: {
                requestfrom: 'selflogin',
                callback: generateCallback(),
                _: Date.now()
            },
            headers: {
                'Cookie': globalState.cookie,
                'Referer': `https://y.tuwan.com/chatroom/${globalState.roomId}`
            }
        });

        // 解析用户ID
        const userInfo = parseJsonp(userInfoResponse.data);
        if (userInfo?.data?.[0]?.uid) {
            globalState.userId = userInfo.data[0].uid;
        }

        // 5. 获取登录令牌
        const loginResponse = await api.get('https://u.tuwan.com/Netease/login', {
            params: {
                callback: generateCallback(),
                _: Date.now()
            },
            headers: {
                'Cookie': globalState.cookie,
                'Referer': `https://y.tuwan.com/chatroom/${globalState.roomId}`
            }
        });

        // 6. 关键步骤：加入房间
        const joinRoomResponse = await api.post('https://app-diandian-report.tuwan.com/', 
            qs.stringify({
                roomId: globalState.roomId,
                action: 'joinRoom',
                platform: 'web',
                timestamp: Date.now(),
                userId: globalState.userId,
                requestfrom: 'addChannelUsers'
            }),
            {
                headers: {
                    'Cookie': globalState.cookie,
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Referer': `https://y.tuwan.com/chatroom/${globalState.roomId}`,
                    'Origin': 'https://y.tuwan.com'
                }
            }
        );

        // 7. 触发用户列表更新
        await api.get('https://papi.tuwan.com/Chatroom/getuserinfo', {
            params: {
                requestfrom: 'addChannelUsers',
                uids: globalState.userId,
                callback: generateCallback(),
                _: Date.now()
            },
            headers: {
                'Cookie': globalState.cookie,
                'Referer': `https://y.tuwan.com/chatroom/${globalState.roomId}`
            }
        });

        console.log('进房流程完成');
        globalState.isConnected = true;
        globalState.retryCount = 0;
        return true;
    } catch (error) {
        console.error('进房失败:', error);
        return false;
    }
}

// 心跳包发送
async function sendHeartbeat() {
    if (!globalState.isConnected) return false;

    try {
        // 1. 发送活动心跳
        await api.get('https://activity.tuwan.com/Activitymanagement/activity', {
            params: {
                cid: globalState.roomId,
                from: '1',
                callback: generateCallback(),
                _: Date.now()
            },
            headers: {
                'Cookie': globalState.cookie,
                'Referer': `https://y.tuwan.com/chatroom/${globalState.roomId}`
            }
        });

        // 2. 更新在线状态
        await api.post('https://app-diandian-report.tuwan.com/', 
            qs.stringify({
                roomId: globalState.roomId,
                status: 'online',
                timestamp: Date.now(),
                userId: globalState.userId
            }),
            {
                headers: {
                    'Cookie': globalState.cookie,
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Referer': `https://y.tuwan.com/chatroom/${globalState.roomId}`,
                    'Origin': 'https://y.tuwan.com'
                }
            }
        );

        globalState.lastHeartbeat = new Date();
        globalState.lastReport = new Date();
        return true;
    } catch (error) {
        console.error('心跳发送失败:', error);
        return false;
    }
}

// 配置更新API
app.post('/api/update-config', async (req, res) => {
    const { roomId, cookie } = req.body;
    
    if (!roomId || !cookie) {
        return res.status(400).json({
            success: false,
            message: '请提供房间号和Cookie'
        });
    }

    try {
        // 更新全局配置
        globalState.cookie = cookie;
        globalState.roomId = roomId;
        globalState.isConnected = false;
        
        // 执行进房流程
        const joinResult = await joinRoom();
        if (!joinResult) {
            throw new Error('进入房间失败');
        }

        // 立即发送一次心跳
        await sendHeartbeat();

        res.json({
            success: true,
            message: '成功进入房间',
            data: {
                roomId: roomId,
                timestamp: Date.now()
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// 状态查询API
app.get('/api/status', (req, res) => {
    res.json({
        isConnected: globalState.isConnected,
        lastHeartbeat: globalState.lastHeartbeat,
        lastReport: globalState.lastReport,
        roomId: globalState.roomId,
        userId: globalState.userId,
        startTime: globalState.startTime,
        uptime: Date.now() - globalState.startTime
    });
});

// 健康检查API
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString()
    });
});

// 启动定时任务
setInterval(async () => {
    if (globalState.isConnected) {
        const heartbeatResult = await sendHeartbeat();
        if (!heartbeatResult && globalState.retryCount < globalState.maxRetries) {
            globalState.retryCount++;
            await joinRoom();
        }
    }
}, 30000);

// 启动服务器
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`服务器启动成功，监听端口 ${PORT}`);
});

module.exports = app;