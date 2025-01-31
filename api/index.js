// api/index.js
// 这个文件实现了点点开黑的自动挂机系统，通过模拟多层次的在线状态维护机制

const express = require('express');
const axios = require('axios');
const path = require('path');
const querystring = require('querystring');

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
const startTime = new Date();     // 系统启动时间

// 创建axios实例并配置通用请求头
const api = axios.create({
    timeout: 10000,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 Edg/132.0.0.0',
        'Accept': '*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        'sec-ch-ua': '"Not A(Brand";v="8", "Chromium";v="132", "Microsoft Edge";v="132"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'script',
        'sec-fetch-mode': 'no-cors',
        'sec-fetch-site': 'same-site'
    }
});

/**
 * 获取用户登录token
 * 这是在线状态维护的第一层：获取基础认证信息
 */
async function getLoginToken(cookie) {
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

        // 解析JSONP响应
        const match = response.data.match(/\((.*?)\)/);
        if (match) {
            const data = JSON.parse(match[1]);
            if (data.error === 0) {
                return {
                    success: true,
                    token: data.token,
                    accid: data.accid,
                    appkey: data.appkey
                };
            }
        }

        return { success: false };
    } catch (error) {
        console.error('获取token失败:', error);
        return { success: false };
    }
}

/**
 * 获取用户详细信息
 * 这是在线状态维护的第二层：验证用户身份并获取详细信息
 */
async function getUserInfo(cookie) {
    try {
        // 先获取登录token
        const tokenResult = await getLoginToken(cookie);
        if (!tokenResult.success) {
            return {
                success: false,
                message: '登录token获取失败'
            };
        }

        // 获取用户详细信息
        const userInfoResponse = await api.get('https://papi.tuwan.com/Chatroom/getuserinfo', {
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

        // 解析用户信息响应
        const userMatch = userInfoResponse.data.match(/\((.*?)\)/);
        if (userMatch) {
            const userData = JSON.parse(userMatch[1]);
            if (userData.error === 0 && userData.data && userData.data.length > 0) {
                console.log('用户信息获取成功:', userData.data[0]);
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
        console.error('用户信息获取失败:', error);
        return {
            success: false,
            message: error.message
        };
    }
}

/**
 * 发送活动状态心跳
 * 这是在线状态维护的第三层：房间活动状态保持
 */
async function sendActivityHeartbeat() {
    if (!currentCookie || !currentRoomId) {
        console.log('缺少Cookie或房间ID，跳过活动心跳');
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

        // 检查响应状态
        if (response.data.includes('请先登录')) {
            console.log('活动心跳检测到登录失效');
            return false;
        }

        return true;
    } catch (error) {
        console.error('活动心跳发送失败:', error.message);
        return false;
    }
}

/**
 * 上报在线状态
 * 这是在线状态维护的第四层：状态上报系统
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
        console.error('状态上报失败:', error.message);
        return false;
    }
}

/**
 * 复合心跳检测
 * 整合所有层次的在线状态维护机制
 */
async function heartbeat() {
    if (!currentCookie || !currentRoomId) {
        console.log('未设置Cookie或房间ID，跳过心跳');
        heartbeatStatus = false;
        return false;
    }

    try {
        // 验证用户信息
        const userCheck = await getUserInfo(currentCookie);
        if (!userCheck.success) {
            console.log('用户信息验证失败');
            heartbeatStatus = false;
            return false;
        }

        // 发送活动心跳
        const activityResult = await sendActivityHeartbeat();
        if (!activityResult) {
            console.log('活动心跳失败');
            heartbeatStatus = false;
            return false;
        }

        // 上报在线状态
        const reportResult = await reportOnlineStatus();
        if (!reportResult) {
            console.log('状态上报失败');
            heartbeatStatus = false;
            return false;
        }

        lastHeartbeatTime = new Date();
        heartbeatStatus = true;
        console.log('心跳检测完成:', lastHeartbeatTime.toISOString());
        return true;
    } catch (error) {
        console.error('心跳检测失败:', error.message);
        heartbeatStatus = false;
        return false;
    }
}

/**
 * 更新配置的API接口
 */
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
            
            // 立即执行一次心跳检测
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

/**
 * 获取当前状态的API接口
 */
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

// 主页路由
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// 健康检查接口
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: Date.now() - startTime,
        roomId: currentRoomId
    });
});

// 设置定时任务
// 心跳检测：每2分钟
setInterval(heartbeat, 2 * 60 * 1000);

// 状态上报：每1分钟
setInterval(reportOnlineStatus, 60 * 1000);

// 启动服务器
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`服务器启动成功，运行在端口 ${PORT}`);
    
    // 如果存在配置，立即开始心跳
    if (currentCookie && currentRoomId) {
        getUserInfo(currentCookie).then(result => {
            if (result.success) {
                userData = result.data;
                return heartbeat();
            }
        }).catch(console.error);
    }
});

module.exports = app;