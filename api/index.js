// api/index.js

// 引入必需的 Node.js 模块
const express = require('express');         // Web 应用框架
const axios = require('axios');             // HTTP 请求客户端
const path = require('path');               // 文件路径处理

// 创建 Express 应用实例
const app = express();

// 配置中间件以处理不同类型的请求和响应
app.use(express.json());                    // 处理 JSON 格式的请求体
app.use(express.urlencoded({ extended: true })); // 处理 URL 编码的请求体
app.use(express.static(path.join(__dirname, '../public'))); // 提供静态文件服务

// 全局状态变量
let currentCookie = '';           // 存储当前使用的登录凭证
let lastHeartbeatTime = null;     // 记录最后一次心跳时间
let heartbeatStatus = false;      // 记录心跳状态
let userData = null;              // 存储用户信息
const startTime = new Date();     // 记录系统启动时间

// 创建 axios 实例，配置通用的请求头和设置
const api = axios.create({
    timeout: 10000,  // 设置请求超时时间为 10 秒
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
 * 验证用户登录状态并获取用户信息
 * 这个函数使用多重验证来确保用户已正确登录
 * @param {string} cookie - 用户的 Cookie 字符串
 * @returns {Promise<Object>} 包含用户信息和验证状态的对象
 */
async function getUserInfo(cookie) {
    try {
        // 第一步：验证房间访问权限
        const roomCheckResponse = await api.get('https://activity.tuwan.com/Activitymanagement/activity', {
            params: {
                cid: '25293',
                from: '1',
                callback: `jQuery${Math.random().toString().slice(2)}_${Date.now()}`,
                _: Date.now()
            },
            headers: {
                'Cookie': cookie,
                'Referer': 'https://y.tuwan.com/',
                'Host': 'activity.tuwan.com'
            }
        });

        // 检查房间访问响应
        const roomMatch = roomCheckResponse.data.match(/\((.*?)\)/);
        if (!roomMatch || roomCheckResponse.data.includes('请先登录')) {
            console.log('房间验证失败:', roomCheckResponse.data);
            return {
                success: false,
                message: '房间访问验证失败'
            };
        }

        // 第二步：获取用户详细信息
        const userInfoResponse = await api.get('https://papi.tuwan.com/Chatroom/getuserinfo', {
            params: {
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
            const data = JSON.parse(userMatch[1]);
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
        console.error('验证过程出错:', error);
        console.error('错误详情:', error.response?.data);
        return {
            success: false,
            message: `验证失败: ${error.message}`
        };
    }
}

/**
 * 执行心跳检测以保持用户在线状态
 * 这个功能定期向服务器发送请求，模拟用户活动
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
                'Referer': 'https://y.tuwan.com/',
                'Host': 'activity.tuwan.com'
            }
        });

        // 检查响应中是否包含登录失效标识
        if (response.data.includes('请先登录')) {
            console.log('心跳检测发现登录状态已失效');
            heartbeatStatus = false;
            return false;
        }

        // 解析响应数据
        const match = response.data.match(/\((.*?)\)/);
        if (match) {
            const data = JSON.parse(match[1]);
            if (data.status === 1) {
                lastHeartbeatTime = new Date();
                heartbeatStatus = true;
                console.log('心跳检测成功:', lastHeartbeatTime.toISOString());
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
            
            // Cookie验证成功后立即执行一次心跳检测
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

// API路由：获取当前系统状态
app.get('/api/status', async (req, res) => {
    try {
        let loginStatus = false;
        let userDetails = null;

        // 如果存在Cookie，验证其有效性
        if (currentCookie) {
            const checkResult = await getUserInfo(currentCookie);
            if (checkResult.success) {
                loginStatus = true;
                userDetails = checkResult.data;
            } else {
                // 验证失败时清除Cookie
                currentCookie = '';
                heartbeatStatus = false;
            }
        }

        // 返回完整的系统状态信息
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

// 设置定时任务
setInterval(heartbeat, 5 * 60 * 1000);  // 每5分钟执行一次心跳检测

// 设置定期检查登录状态
setInterval(async () => {
    if (currentCookie) {
        const checkResult = await getUserInfo(currentCookie);
        if (!checkResult.success) {
            console.log('定期检查发现登录状态已失效');
            currentCookie = '';
            heartbeatStatus = false;
        }
    }
}, 15 * 60 * 1000);  // 每15分钟检查一次登录状态

// 启动服务器
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`服务器启动成功，运行在端口 ${PORT}`);
    
    // 如果存在Cookie，立即验证并开始心跳
    if (currentCookie) {
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