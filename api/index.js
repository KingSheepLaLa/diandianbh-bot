// api/index.js

// 引入必需的模块
const express = require('express');
const axios = require('axios');
const path = require('path');

// 创建Express应用
const app = express();

// 配置Express中间件
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

// 全局状态变量
let currentCookie = '';           // 存储当前使用的Cookie
let lastHeartbeatTime = null;     // 记录最后一次心跳时间
let heartbeatStatus = false;      // 记录心跳状态
let userData = null;              // 存储用户信息
const startTime = new Date();     // 记录系统启动时间

// 创建axios实例，配置通用请求头
const api = axios.create({
    timeout: 10000,  // 10秒超时时间
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
 * 获取用户信息和验证登录状态
 * @param {string} cookie - 用户的Cookie字符串
 * @returns {Promise<Object>} 包含用户信息和登录状态的对象
 */
async function getUserInfo(cookie) {
    try {
        // 首先验证登录状态
        const loginCheckResponse = await api.get('https://y.tuwan.com/ajax/checkLogin', {
            headers: {
                'Cookie': cookie,
                'Referer': 'https://y.tuwan.com/'
            }
        });

        // 如果登录检查失败，直接返回
        if (!loginCheckResponse.data || loginCheckResponse.data.status !== 1) {
            console.log('登录状态检查失败:', loginCheckResponse.data);
            return {
                success: false,
                message: '登录状态验证失败'
            };
        }

        // 获取详细的用户信息
        const timestamp = Date.now();
        const userInfoResponse = await api.get('https://activity.tuwan.com/Activitymanagement/getUserInfo', {
            params: {
                callback: `jQuery${Math.random().toString().slice(2)}_${timestamp}`,
                _: timestamp
            },
            headers: {
                'Cookie': cookie,
                'Referer': 'https://y.tuwan.com/'
            }
        });

        // 解析JSONP响应
        const match = userInfoResponse.data.match(/\((.*?)\)/);
        if (match) {
            const data = JSON.parse(match[1]);
            console.log('用户信息获取成功:', data);
            return {
                success: true,
                data: {
                    ...data,
                    isLoggedIn: true,
                    lastUpdate: new Date().toISOString()
                }
            };
        }

        return {
            success: false,
            message: '用户信息解析失败'
        };
    } catch (error) {
        console.error('获取用户信息失败:', error.message);
        return {
            success: false,
            message: error.message
        };
    }
}

/**
 * 执行心跳检测以保持在线状态
 * @returns {Promise<boolean>} 心跳是否成功
 */
async function heartbeat() {
    if (!currentCookie) {
        console.log('未设置Cookie，跳过心跳检测');
        heartbeatStatus = false;
        return false;
    }

    try {
        const timestamp = Date.now();
        const response = await api.get('https://activity.tuwan.com/Activitymanagement/activity', {
            params: {
                cid: '25293',
                from: '1',
                callback: `jQuery${Math.random().toString().slice(2)}_${timestamp}`,
                _: timestamp
            },
            headers: {
                'Cookie': currentCookie,
                'Referer': 'https://y.tuwan.com/'
            }
        });

        // 检查响应中是否包含错误信息
        if (response.data.includes('登录已过期') || response.data.includes('请先登录')) {
            console.log('心跳检测发现登录已过期');
            heartbeatStatus = false;
            return false;
        }

        lastHeartbeatTime = new Date();
        heartbeatStatus = true;
        console.log('心跳检测成功:', lastHeartbeatTime.toISOString());
        return true;
    } catch (error) {
        console.error('心跳检测失败:', error.message);
        heartbeatStatus = false;
        return false;
    }
}

// API路由：更新Cookie
app.post('/api/update-cookie', async (req, res) => {
    const { cookie } = req.body;
    
    if (!cookie) {
        return res.status(400).json({
            success: false,
            message: '请提供Cookie'
        });
    }

    try {
        // 验证Cookie并获取用户信息
        const userInfoResult = await getUserInfo(cookie);
        
        if (userInfoResult.success) {
            currentCookie = cookie;
            userData = userInfoResult.data;
            
            // 立即执行一次心跳检测
            const heartbeatResult = await heartbeat();
            
            res.json({
                success: true,
                message: '登录成功',
                data: {
                    ...userInfoResult.data,
                    heartbeatStatus: heartbeatResult
                }
            });
        } else {
            res.json({
                success: false,
                message: 'Cookie验证失败: ' + userInfoResult.message
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
                // 如果验证失败，清除Cookie
                currentCookie = '';
                heartbeatStatus = false;
            }
        }

        res.json({
            isLoggedIn: loginStatus,
            lastHeartbeat: lastHeartbeatTime,
            heartbeatStatus: heartbeatStatus,
            userData: userDetails,
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
        uptime: Date.now() - startTime
    });
});

// 设置定时心跳检测（每5分钟执行一次）
setInterval(heartbeat, 5 * 60 * 1000);

// 设置定期检查登录状态（每15分钟执行一次）
setInterval(async () => {
    if (currentCookie) {
        const checkResult = await getUserInfo(currentCookie);
        if (!checkResult.success) {
            console.log('定期检查发现登录状态已失效');
            currentCookie = '';
            heartbeatStatus = false;
        }
    }
}, 15 * 60 * 1000);

// 启动服务器
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`服务器启动成功，运行在端口 ${PORT}`);
    // 如果有Cookie，立即验证并开始心跳
    if (currentCookie) {
        getUserInfo(currentCookie).then(result => {
            if (result.success) {
                userData = result.data;
                return heartbeat();
            }
        }).catch(console.error);
    }
});

module.exports = app;