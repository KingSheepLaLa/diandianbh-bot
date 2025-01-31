// api/index.js
const express = require('express');
const axios = require('axios');
const path = require('path');
const querystring = require('querystring');
const WebSocket = require('ws');

// 创建Express应用
const app = express();

// 配置中间件
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

// 全局状态管理
let currentCookie = '';           // 当前用户Cookie
let currentRoomId = '';          // 当前房间ID
let lastHeartbeatTime = null;     // 最后心跳时间
let lastStatusReportTime = null;  // 最后状态上报时间
let heartbeatStatus = false;      // 心跳状态
let userData = null;              // 用户数据缓存
let wsConnection = null;          // WebSocket连接
let neteaseToken = null;          // 网易通信token
const startTime = new Date();     // 系统启动时间

// 创建axios实例并配置通用请求头
const api = axios.create({
    timeout: 10000,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'sec-ch-ua': '"Not A(Brand";v="8", "Chromium";v="132"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"'
    }
});

/**
 * 获取网易通信token
 * 用于建立WebSocket连接和实现实时通信
 */
async function getNeteaseToken(cookie) {
    try {
        const response = await api.get('https://u.tuwan.com/Netease/login', {
            params: {
                callback: `jQuery${Math.random().toString().slice(2)}_${Date.now()}`,
                _: Date.now()
            },
            headers: {
                'Cookie': cookie,
                'Referer': 'https://y.tuwan.com/',
                'Host': 'u.tuwan.com'
            }
        });

        const match = response.data.match(/\((.*?)\)/);
        if (match) {
            const data = JSON.parse(match[1]);
            if (data.error === 0) {
                neteaseToken = data;
                return {
                    success: true,
                    ...data
                };
            }
        }
        return { success: false, message: '获取token失败' };
    } catch (error) {
        console.error('获取网易token失败:', error);
        return { success: false, message: error.message };
    }
}

/**
 * 获取房间基础信息
 * 获取房间的在线用户列表等信息
 */
async function getRoomInfo(roomId, cookie) {
    try {
        const response = await api.get('https://papi.tuwan.com/Chatroom/getPcListV4', {
            params: {
                ver: '14',
                format: 'jsonp',
                navid: '0',
                cid: roomId,
                callback: `jQuery${Math.random().toString().slice(2)}_${Date.now()}`,
                _: Date.now()
            },
            headers: {
                'Cookie': cookie,
                'Referer': `https://y.tuwan.com/chatroom/${roomId}`,
                'Host': 'papi.tuwan.com'
            }
        });

        const match = response.data.match(/\((.*?)\)/);
        if (match) {
            const data = JSON.parse(match[1]);
            return {
                success: true,
                data: data
            };
        }
        return { success: false, message: '获取房间信息失败' };
    } catch (error) {
        console.error('获取房间信息失败:', error);
        return { success: false, message: error.message };
    }
}

/**
 * 建立WebSocket连接
 * 用于接收和发送实时消息
 */
async function setupWebSocket(token) {
    if (wsConnection) {
        wsConnection.close();
    }

    return new Promise((resolve, reject) => {
        try {
            const ws = new WebSocket('wss://chat.tuwan.com/socket.io/?EIO=3&transport=websocket');

            ws.on('open', () => {
                console.log('WebSocket连接已建立');
                wsConnection = ws;
                // 发送初始连接消息
                ws.send('40/chat,');
                resolve(true);
            });

            ws.on('message', (data) => {
                console.log('收到WebSocket消息:', data.toString());
                // 处理心跳包
                if (data.toString() === '2') {
                    ws.send('3');
                }
            });

            ws.on('error', (error) => {
                console.error('WebSocket错误:', error);
                reject(error);
            });

            ws.on('close', () => {
                console.log('WebSocket连接已关闭');
                wsConnection = null;
            });
        } catch (error) {
            console.error('建立WebSocket连接失败:', error);
            reject(error);
        }
    });
}

/**
 * 获取用户详细信息
 * 验证用户身份并获取详细信息
 */
async function getUserInfo(cookie) {
    try {
        // 先获取网易token
        const tokenResult = await getNeteaseToken(cookie);
        if (!tokenResult.success) {
            return {
                success: false,
                message: '获取网易token失败'
            };
        }

        // 获取用户详细信息
        const response = await api.get('https://papi.tuwan.com/Chatroom/getuserinfo', {
            params: {
                requestfrom: 'selflogin',
                uids: tokenResult.accid,
                callback: `jQuery${Math.random().toString().slice(2)}_${Date.now()}`,
                _: Date.now()
            },
            headers: {
                'Cookie': cookie,
                'Referer': 'https://y.tuwan.com/',
                'Host': 'papi.tuwan.com'
            }
        });

        const match = response.data.match(/\((.*?)\)/);
        if (match) {
            const userData = JSON.parse(match[1]);
            if (userData.error === 0 && userData.data && userData.data.length > 0) {
                return {
                    success: true,
                    data: {
                        ...userData.data[0],
                        accid: tokenResult.accid,
                        token: tokenResult.token,
                        isLoggedIn: true,
                        lastUpdate: new Date().toISOString()
                    }
                };
            }
        }

        return {
            success: false,
            message: '用户信息获取失败'
        };
    } catch (error) {
        console.error('获取用户信息失败:', error);
        return {
            success: false,
            message: error.message
        };
    }
}

/**
 * 进入房间
 * 发送进入房间请求并初始化房间状态
 */
async function joinRoom(roomId, cookie) {
    try {
        // 1. 获取房间基础信息
        const roomInfo = await getRoomInfo(roomId, cookie);
        if (!roomInfo.success) {
            return false;
        }

        // 2. 发送房间初始化请求
        const response = await api.get('https://papi.tuwan.com/Game/getGameStatus', {
            params: {
                format: 'jsonp',
                cid: roomId,
                callback: `jQuery${Math.random().toString().slice(2)}_${Date.now()}`,
                _: Date.now()
            },
            headers: {
                'Cookie': cookie,
                'Referer': `https://y.tuwan.com/chatroom/${roomId}`,
                'Host': 'papi.tuwan.com'
            }
        });

        // 3. 通过WebSocket发送进入房间消息
        if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
            wsConnection.send(JSON.stringify({
                type: 'join',
                roomId: roomId,
                userId: userData.accid
            }));
        }

        return true;
    } catch (error) {
        console.error('进入房间失败:', error);
        return false;
    }
}

/**
 * 发送活动状态心跳
 */
async function sendActivityHeartbeat() {
    if (!currentCookie || !currentRoomId) {
        return false;
    }

    try {
        const response = await api.get('https://activity.tuwan.com/Activitymanagement/activity', {
            params: {
                cid: currentRoomId,
                from: '1',
                callback: `jQuery${Math.random().toString().slice(2)}_${Date.now()}`,
                _: Date.now()
            },
            headers: {
                'Cookie': currentCookie,
                'Referer': `https://y.tuwan.com/chatroom/${currentRoomId}`,
                'Host': 'activity.tuwan.com'
            }
        });

        if (response.data.includes('请先登录')) {
            return false;
        }

        return true;
    } catch (error) {
        console.error('活动心跳发送失败:', error);
        return false;
    }
}

/**
 * 上报在线状态
 */
async function reportOnlineStatus() {
    if (!currentCookie || !currentRoomId) {
        return false;
    }

    try {
        await api.post('https://app-diandian-report.tuwan.com/', 
            querystring.stringify({
                roomId: currentRoomId,
                status: 'online',
                timestamp: Date.now()
            }),
            {
                headers: {
                    'Cookie': currentCookie,
                    'Referer': `https://y.tuwan.com/chatroom/${currentRoomId}`,
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Origin': 'https://y.tuwan.com'
                }
            }
        );

        lastStatusReportTime = new Date();
        return true;
    } catch (error) {
        console.error('状态上报失败:', error);
        return false;
    }
}

/**
 * 复合心跳检测
 */
async function heartbeat() {
    if (!currentCookie || !currentRoomId) {
        heartbeatStatus = false;
        return false;
    }

    try {
        // 验证用户信息
        const userCheck = await getUserInfo(currentCookie);
        if (!userCheck.success) {
            heartbeatStatus = false;
            return false;
        }

        // 确保WebSocket连接
        if (!wsConnection || wsConnection.readyState !== WebSocket.OPEN) {
            await setupWebSocket(neteaseToken);
        }

        // 发送活动心跳
        const activityResult = await sendActivityHeartbeat();
        if (!activityResult) {
            heartbeatStatus = false;
            return false;
        }

        // 上报在线状态
        const reportResult = await reportOnlineStatus();
        if (!reportResult) {
            heartbeatStatus = false;
            return false;
        }

        lastHeartbeatTime = new Date();
        heartbeatStatus = true;
        return true;
    } catch (error) {
        console.error('心跳检测失败:', error);
        heartbeatStatus = false;
        return false;
    }
}

// API路由处理
app.post('/api/update-config', async (req, res) => {
    const { roomId, cookie } = req.body;
    
    if (!roomId || !cookie) {
        return res.status(400).json({
            success: false,
            message: '请提供房间号和Cookie'
        });
    }

    try {
        // 验证用户信息
        const userInfoResult = await getUserInfo(cookie);
        
        if (userInfoResult.success) {
            // 更新全局配置
            currentCookie = cookie;
            currentRoomId = roomId;
            userData = userInfoResult.data;

            // 建立WebSocket连接
            await setupWebSocket(neteaseToken);
            
            // 加入房间
            const joinResult = await joinRoom(roomId, cookie);
            if (!joinResult) {
                return res.json({
                    success: false,
                    message: '加入房间失败'
                });
            }
            
            // 执行心跳检测
            const heartbeatResult = await heartbeat();
            
            res.json({
                success: true,
                message: '配置成功',
                data: {
                    ...userInfoResult.data,
                    heartbeatStatus: heartbeatResult,
                    roomId: roomId
                }
            });
        } else {
            res.json({
                success: false,
                message: '验证失败: ' + userInfoResult.message
            });
        }
    } catch (error) {
        res.status(500).json({
            success: false,
            message: '服务器处理请求出错',
            error: error.message
        });
    }
});

app.get('/api/status', async (req, res) => {
    try {
        let loginStatus = false;
        let userDetails = null;

        if (currentCookie) {
            const checkResult = await getUserInfo(currentCookie);
            if (checkResult.success) {
                loginStatus = true;
                userDetails = checkResult.data;
            } else {
                currentCookie = '';
                currentRoomId = '';
                heartbeatStatus = false;
            }
        }

        res.json({
            isLoggedIn: loginStatus,
            lastHeartbeat: lastHeartbeatTime,
            lastStatusReport: lastStatusReportTime,
            heartbeatStatus: heartbeatStatus,
            userData: userDetails,
            roomId: currentRoomId,
            wsStatus: wsConnection ? wsConnection.readyState : -1,
            systemStatus: {
                startTime: startTime,
                uptime: Date.now() - startTime,
                currentTime: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('状态获取失败:', error);
        res.status(500).json({
            success: false,
            message: '获取状态失败',
            error: error.message
        });
    }
});

// 健康检查接口
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: Date.now() - startTime,
        roomId: currentRoomId,
        wsStatus: wsConnection ? wsConnection.readyState : -1
    });
});

// 主页路由
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// 设置定时任务
// 心跳检测：每2分钟
setInterval(heartbeat, 2 * 60 * 1000);

// 状态上报：每1分钟
setInterval(reportOnlineStatus, 60 * 1000);

// 自动重连WebSocket：每5分钟检查一次
setInterval(async () => {
    if (!wsConnection || wsConnection.readyState !== WebSocket.OPEN) {
        if (currentCookie && neteaseToken) {
            try {
                await setupWebSocket(neteaseToken);
                if (currentRoomId) {
                    await joinRoom(currentRoomId, currentCookie);
                }
            } catch (error) {
                console.error('WebSocket自动重连失败:', error);
            }
        }
    }
}, 5 * 60 * 1000);

// 启动服务器
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`服务器启动成功，运行在端口 ${PORT}`);
    
    // 如果存在配置，立即开始心跳
    if (currentCookie && currentRoomId) {
        getUserInfo(currentCookie).then(async result => {
            if (result.success) {
                userData = result.data;
                await setupWebSocket(neteaseToken);
                await joinRoom(currentRoomId, currentCookie);
                await heartbeat();
            }
        }).catch(console.error);
    }
});

module.exports = app;