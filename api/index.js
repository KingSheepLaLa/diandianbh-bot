// api/index.js

// 引入需要使用的工具包
const express = require('express');
const axios = require('axios');
const { CookieJar } = require('tough-cookie');
const { HttpsCookieAgent } = require('https-proxy-agent');
const path = require('path');

// 创建网络服务器应用
const app = express();

// 设置服务器可以处理 JSON 数据和网页文件
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

// 存储运行状态的变量
let currentCookie = process.env.TUWAN_COOKIE || '';
let lastHeartbeatTime = null;
let heartbeatStatus = false;
let userInfo = null;

// 创建用于发送网络请求的工具，配置所有必要的请求头
const api = axios.create({
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 Edg/132.0.0.0',
        'Accept': '*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Cookie': currentCookie,
        'Referer': 'https://y.tuwan.com/',
        'sec-ch-ua': '"Not A(Brand";v="8", "Chromium";v="132", "Microsoft Edge";v="132"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"'
    }
});

// 获取用户信息的功能
async function fetchUserInfo() {
    try {
        const response = await api.get('https://activity.tuwan.com/Activitymanagement/getUserInfo', {
            headers: { 'Cookie': currentCookie }
        });
        
        // 解析返回的数据
        const match = response.data.match(/\((.*?)\)/);
        if (match) {
            const data = JSON.parse(match[1]);
            userInfo = data;
            return data;
        }
        return null;
    } catch (error) {
        console.error('获取用户信息失败:', error.message);
        return null;
    }
}

// 心跳检测功能：定期发送请求保持在线状态
async function heartbeat() {
    if (!currentCookie) {
        console.log('未设置Cookie，跳过心跳检测');
        heartbeatStatus = false;
        return false;
    }

    try {
        const response = await api.get('https://activity.tuwan.com/Activitymanagement/activity', {
            params: {
                cid: '25293',
                from: '1',
                callback: `jQuery${Date.now()}`,
                _: Date.now()
            },
            headers: {
                'Cookie': currentCookie
            }
        });
        
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

// 更新Cookie的接口
app.post('/api/update-cookie', async (req, res) => {
    const { cookie } = req.body;
    if (!cookie) {
        return res.status(400).json({ success: false, message: '请提供Cookie' });
    }

    currentCookie = cookie;
    api.defaults.headers.Cookie = cookie;

    // 获取用户信息来验证Cookie
    const user = await fetchUserInfo();
    if (user) {
        res.json({ success: true, message: '更新成功', user });
    } else {
        res.json({ success: false, message: 'Cookie无效或已过期' });
    }
});

// 获取状态信息的接口
app.get('/api/status', async (req, res) => {
    const user = await fetchUserInfo();
    res.json({
        isLoggedIn: !!currentCookie,
        lastHeartbeat: lastHeartbeatTime,
        heartbeatStatus: heartbeatStatus,
        userInfo: user
    });
});

// 设置定时器，每5分钟执行一次心跳检测
setInterval(heartbeat, 5 * 60 * 1000);

// 启动服务器
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`服务器启动成功，运行在端口 ${PORT}`);
    // 服务启动后立即执行一次心跳检测
    heartbeat();
    // 获取初始用户信息
    fetchUserInfo();
});

module.exports = app;