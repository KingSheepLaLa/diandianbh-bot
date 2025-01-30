// api/index.js

// 引入必要的库
const express = require('express');         // Web服务器框架
const axios = require('axios');             // HTTP请求工具
const path = require('path');               // 文件路径处理工具

// 创建Express应用实例
const app = express();

// 配置中间件
app.use(express.json());                    // 处理JSON格式的请求体
app.use(express.urlencoded({ extended: true })); // 处理表单数据
app.use(express.static(path.join(__dirname, '../public'))); // 提供静态文件服务

// 全局状态变量
let currentCookie = '';           // 当前使用的Cookie
let lastHeartbeatTime = null;     // 最后一次心跳时间
let heartbeatStatus = false;      // 心跳状态
let userData = null;              // 用户信息缓存

// 创建axios实例，设置通用配置
const api = axios.create({
    timeout: 10000,  // 10秒超时
    headers: {
        // 完整的浏览器标识，确保请求看起来像真实浏览器发出的
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
 * 获取用户信息
 * @param {string} cookie - 用户的Cookie字符串
 * @returns {Promise<Object>} 包含用户信息的对象
 */
async function getUserInfo(cookie) {
    try {
        const timestamp = Date.now();
        const jqueryCallback = `jQuery${Math.random().toString().slice(2)}_${timestamp}`;
        
        // 发送请求到用户信息API
        const response = await api.get('https://papi.tuwan.com/Chatroom/getuserinfo', {
            params: {
                uids: '10290613',
                callback: jqueryCallback,
                _: timestamp
            },
            headers: {
                'Cookie': cookie,
                'Referer': 'https://y.tuwan.com/'
            }
        });

        // 解析JSONP响应
        const match = response.data.match(/jQuery.*?\((.*?)\)/);
        if (match) {
            const data = JSON.parse(match[1]);
            console.log('用户信息获取成功:', data);
            return {
                success: true,
                data: data
            };
        }

        return {
            success: false,
            message: '解析用户信息失败'
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
 * 执行心跳检测，保持在线状态
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
                cid: '25293',          // 房间ID
                from: '1',             // 来源标识
                callback: `jQuery${Math.random().toString().slice(2)}_${timestamp}`,
                _: timestamp
            },
            headers: {
                'Cookie': currentCookie,
                'Referer': 'https://y.tuwan.com/'
            }
        });
        
        // 更新心跳状态
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
            
            // 更新Cookie后立即执行一次心跳检测
            await heartbeat();
            
            res.json({
                success: true,
                message: '登录成功',
                data: userInfoResult.data
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
        // 如果已登录，刷新用户信息
        if (currentCookie) {
            const userInfoResult = await getUserInfo(currentCookie);
            if (userInfoResult.success) {
                userData = userInfoResult.data;
            }
        }

        res.json({
            isLoggedIn: !!currentCookie,
            lastHeartbeat: lastHeartbeatTime,
            heartbeatStatus: heartbeatStatus,
            userData: userData
        });
    } catch (error) {
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
        timestamp: new Date().toISOString()
    });
});

// 设置定时心跳检测（每5分钟一次）
setInterval(heartbeat, 5 * 60 * 1000);

// 启动服务器
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`服务器启动成功，运行在端口 ${PORT}`);
    // 服务启动后立即获取一次用户信息（如果有Cookie的话）
    if (currentCookie) {
        getUserInfo(currentCookie).then(result => {
            if (result.success) {
                userData = result.data;
                // 初始化完成后执行第一次心跳
                return heartbeat();
            }
        }).catch(console.error);
    }
});

// 导出app实例供Vercel使用
module.exports = app;