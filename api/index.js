// api/index.js - 系统核心服务文件

// 引入必需的Node.js模块
const express = require('express');
const axios = require('axios');
const path = require('path');
const winston = require('winston'); // 引入日志库

// 创建Express应用实例
const app = express();

// 配置中间件
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

// 日志配置
const logger = winston.createLogger({
    level: 'info',
    transports: [
        new winston.transports.Console({ format: winston.format.simple() }),
        new winston.transports.File({ filename: 'combined.log' })
    ]
});

// 配置文件
const config = {
    heartbeatInterval: 5 * 60 * 1000,  // 5分钟
    loginCheckInterval: 15 * 60 * 1000, // 15分钟
    requestTimeout: 10000, // 请求超时时间 10秒
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36'
};

// 全局状态变量
let currentCookie = '';
let currentRoomId = '';
let lastHeartbeatTime = null;
let heartbeatStatus = false;
let userData = null;
const startTime = new Date();

// 创建axios实例，配置通用的请求设置
const api = axios.create({
    timeout: config.requestTimeout,
    headers: {
        'User-Agent': config.userAgent,
        'Accept': '*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'sec-ch-ua': '"Not A(Brand";v="8", "Chromium";v="132", "Microsoft Edge";v="132"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'script',
        'sec-fetch-mode': 'no-cors',
        'sec-fetch-site': 'same-site'
    }
});

// 获取登录token
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

        const match = response.data.match(/\((.*?)\)/);
        if (match) {
            const data = JSON.parse(match[1]);
            if (data.error === 0) {
                return {
                    success: true,
                    token: data.token,
                    accid: data.accid
                };
            }
        }

        return { success: false };
    } catch (error) {
        logger.error('获取token失败:', error);
        return { success: false };
    }
}

// 获取并验证用户信息
async function getUserInfo(cookie) {
    try {
        const tokenResult = await getLoginToken(cookie);
        if (!tokenResult.success) {
            return { success: false, message: '登录token获取失败' };
        }

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

        const userMatch = userInfoResponse.data.match(/\((.*?)\)/);
        if (userMatch) {
            const userData = JSON.parse(userMatch[1]);
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

        return { success: false, message: '用户信息获取失败' };
    } catch (error) {
        logger.error('验证过程出错:', error);
        return { success: false, message: `验证失败: ${error.message}` };
    }
}

// 执行心跳检测
async function heartbeat() {
    if (!currentCookie || !currentRoomId) {
        logger.warn('未设置Cookie或房间号，跳过心跳检测');
        heartbeatStatus = false;
        return false;
    }

    try {
        const tokenResult = await getLoginToken(currentCookie);
        if (!tokenResult.success) {
            logger.warn('心跳前token获取失败');
            heartbeatStatus = false;
            return false;
        }

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
                'Host': 'activity.tuwan.com',
                'Origin': 'https://y.tuwan.com'
            }
        });

        if (response.data.includes('请先登录')) {
            logger.warn('心跳检测发现登录状态已失效');
            heartbeatStatus = false;
            return false;
        }

        const match = response.data.match(/\((.*?)\)/);
        if (match) {
            const data = JSON.parse(match[1]);
            if (data.status === 1 || data.error === 0) {
                lastHeartbeatTime = new Date();
                heartbeatStatus = true;
                logger.info('心跳检测成功:', lastHeartbeatTime.toISOString(), '房间号:', currentRoomId);
                return true;
            }
        }

        logger.error('心跳检测返回异常数据:', response.data);
        heartbeatStatus = false;
        return false;
    } catch (error) {
        logger.error('心跳检测失败:', error.message);
        heartbeatStatus = false;
        return false;
    }
}

// API路由：更新运行配置
app.post('/api/update-config', async (req, res) => {
    const { roomId, cookie } = req.body;

    if (!roomId || !cookie) {
        return res.status(400).json({ success: false, message: '请提供房间号和Cookie' });
    }

    try {
        const userInfoResult = await getUserInfo(cookie);

        if (userInfoResult.success) {
            currentCookie = cookie;
            currentRoomId = roomId;
            userData = userInfoResult.data;

            const heartbeatResult = await heartbeat();

            res.json({
                success: true,
                message: '配置成功',
                data: { ...userInfoResult.data, heartbeatStatus: heartbeatResult, roomId }
            });
        } else {
            res.json({ success: false, message: '验证失败: ' + userInfoResult.message });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: '服务器处理请求时出错', error: error.message });
    }
});

// API路由：获取当前状态
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
            heartbeatStatus,
            userData: userDetails,
            roomId: currentRoomId,
            systemStatus: {
                startTime,
                uptime: Date.now() - startTime,
                currentTime: new Date().toISOString()
            }
        });
    } catch (error) {
        logger.error('状态获取失败:', error);
        res.status(500).json({ success: false, message: '获取状态失败', error: error.message });
    }
});

// 主页路由
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// 健康检查路由
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: Date.now() - startTime,
        roomId: currentRoomId
    });
});

// 设置定时任务：心跳检测
setInterval(heartbeat, config.heartbeatInterval);

// 设置定时任务：登录状态检查
setInterval(async () => {
    if (currentCookie) {
        const checkResult = await getUserInfo(currentCookie);
        if (!checkResult.success) {
            logger.warn('定期检查发现登录状态已失效');
            currentCookie = '';
            currentRoomId = '';
            heartbeatStatus = false;
        }
    }
}, config.loginCheckInterval);

// 启动服务器
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    logger.info(`服务器启动成功，运行在端口 ${PORT}`);
    if (currentCookie && currentRoomId) {
        getUserInfo(currentCookie).then(result => {
            if (result.success) {
                userData = result.data;
                return heartbeat();
            }
        }).catch(logger.error);
    }
});

// 导出app实例供Vercel使用
module.exports = app;
