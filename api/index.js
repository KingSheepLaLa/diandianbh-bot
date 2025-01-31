// api/index.js - 系统核心服务文件

// 引入必需的Node.js模块
const express = require('express');         // Web应用框架，用于创建服务器和处理HTTP请求
const axios = require('axios');             // HTTP客户端，用于发送网络请求
const path = require('path');               // 文件路径处理工具

// 创建Express应用实例
const app = express();

// 配置中间件
app.use(express.json());                    // 使服务器能够解析JSON格式的请求体
app.use(express.urlencoded({ extended: true })); // 处理URL编码的表单数据
app.use(express.static(path.join(__dirname, '../public'))); // 提供静态文件服务

// 全局状态变量，用于存储运行时的重要信息
let currentCookie = '';           // 当前用户的登录凭证
let currentRoomId = '';          // 当前挂机的房间号
let lastHeartbeatTime = null;     // 最后一次心跳成功的时间
let heartbeatStatus = false;      // 当前心跳状态
let userData = null;              // 用户信息缓存
const startTime = new Date();     // 系统启动时间

// 创建axios实例，配置通用的请求设置
const api = axios.create({
    timeout: 10000,  // 请求超时时间：10秒
    headers: {
        // 设置浏览器标识，模拟真实的浏览器环境
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
 * 获取登录token
 * 这是一个辅助函数，用于获取用户的认证token
 * @param {string} cookie - 用户的Cookie
 * @returns {Promise<Object>} 包含token信息的对象
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
        console.error('获取token失败:', error);
        return { success: false };
    }
}

/**
 * 获取并验证用户信息
 * 此函数执行完整的用户验证流程
 * @param {string} cookie - 用户的Cookie字符串
 * @returns {Promise<Object>} 包含用户信息和验证状态的对象
 */
async function getUserInfo(cookie) {
    try {
        // 第一步：获取登录token
        const tokenResult = await getLoginToken(cookie);
        if (!tokenResult.success) {
            return {
                success: false,
                message: '登录token获取失败'
            };
        }

        // 第二步：获取用户详细信息
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
        console.error('验证过程出错:', error);
        return {
            success: false,
            message: `验证失败: ${error.message}`
        };
    }
}

/**
 * 执行心跳检测
 * 通过定期发送请求来维持用户在房间中的在线状态
 * @returns {Promise<boolean>} 心跳是否成功
 */
async function heartbeat() {
    if (!currentCookie || !currentRoomId) {
        console.log('未设置Cookie或房间号，跳过心跳检测');
        heartbeatStatus = false;
        return false;
    }

    try {
        // 首先获取最新的token
        const tokenResult = await getLoginToken(currentCookie);
        if (!tokenResult.success) {
            console.log('心跳前token获取失败');
            heartbeatStatus = false;
            return false;
        }

        // 发送心跳请求
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

        // 检查响应是否包含错误信息
        if (response.data.includes('请先登录')) {
            console.log('心跳检测发现登录状态已失效');
            heartbeatStatus = false;
            return false;
        }

        // 尝试解析响应数据
        const match = response.data.match(/\((.*?)\)/);
        if (match) {
            const data = JSON.parse(match[1]);
            if (data.status === 1 || data.error === 0) {
                lastHeartbeatTime = new Date();
                heartbeatStatus = true;
                console.log('心跳检测成功:', lastHeartbeatTime.toISOString(), '房间号:', currentRoomId);
                return true;
            }
        }

        console.log('心跳检测返回异常数据:', response.data);
        heartbeatStatus = false;
        return false;
    } catch (error) {
        console.error('心跳检测失败:', error.message);
        heartbeatStatus = false;
        return false;
    }
}

// API路由：更新运行配置
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
            message: '服务器处理请求时出错',
            error: error.message
        });
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
                // 验证失败时清除配置
                currentCookie = '';
                currentRoomId = '';
                heartbeatStatus = false;
            }
        }

        res.json({
            isLoggedIn: loginStatus,
            lastHeartbeat: lastHeartbeatTime,
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

// 健康检查路由
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: Date.now() - startTime,
        roomId: currentRoomId
    });
});

// 设置定时任务：心跳检测（每5分钟执行一次）
setInterval(heartbeat, 5 * 60 * 1000);

// 设置定时任务：登录状态检查（每15分钟执行一次）
setInterval(async () => {
    if (currentCookie) {
        const checkResult = await getUserInfo(currentCookie);
        if (!checkResult.success) {
            console.log('定期检查发现登录状态已失效');
            currentCookie = '';
            currentRoomId = '';
            heartbeatStatus = false;
        }
    }
}, 15 * 60 * 1000);

// 启动服务器
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`服务器启动成功，运行在端口 ${PORT}`);
    
    // 如果存在配置，立即验证并开始心跳
    if (currentCookie && currentRoomId) {
        getUserInfo(currentCookie).then(result => {
            if (result.success) {
                userData = result.data;
                return heartbeat();
            }
        }).catch(console.error);
    }
});

// 导出app实例供Vercel使用
module.exports = app;