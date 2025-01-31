const express = require('express');
const axios = require('axios');
const querystring = require('querystring');

const api = axios.create({
    timeout: 10000,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br'
    }
});

// 全局状态
const globalState = new Map();

const handler = async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    // 获取或创建会话状态
    const sessionId = req.headers['x-session-id'] || 'default';
    if (!globalState.has(sessionId)) {
        globalState.set(sessionId, {
            currentCookie: '',
            currentRoomId: '',
            lastHeartbeatTime: null,
            lastStatusReportTime: null,
            heartbeatStatus: false,
            userData: null,
            startTime: new Date()
        });
    }
    const state = globalState.get(sessionId);

    // API路由处理
    if (req.method === 'POST' && req.url === '/api/update-config') {
        try {
            const { roomId, cookie } = req.body;
            if (!roomId || !cookie) {
                return res.status(400).json({
                    success: false,
                    message: '请提供房间号和Cookie'
                });
            }

            const userInfo = await getUserInfo(cookie);
            if (userInfo.success) {
                state.currentCookie = cookie;
                state.currentRoomId = roomId;
                state.userData = userInfo.data;

                await joinRoom(roomId, cookie);
                const heartbeatResult = await heartbeat(state);

                return res.json({
                    success: true,
                    data: {
                        ...userInfo.data,
                        heartbeatStatus: heartbeatResult,
                        roomId: roomId
                    }
                });
            } else {
                return res.json({
                    success: false,
                    message: '验证失败'
                });
            }
        } catch (error) {
            return res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }

    if (req.method === 'GET' && req.url === '/api/status') {
        return res.json({
            isLoggedIn: Boolean(state.currentCookie),
            lastHeartbeat: state.lastHeartbeatTime,
            lastStatusReport: state.lastStatusReportTime,
            heartbeatStatus: state.heartbeatStatus,
            userData: state.userData,
            roomId: state.currentRoomId,
            systemStatus: {
                startTime: state.startTime,
                uptime: Date.now() - state.startTime
            }
        });
    }

    // 默认返回404
    return res.status(404).json({ success: false, message: '未找到请求的接口' });
};

async function getUserInfo(cookie) {
    try {
        const tokenResult = await getNeteaseToken(cookie);
        if (!tokenResult.success) {
            return { success: false };
        }

        const response = await api.get('https://papi.tuwan.com/Chatroom/getuserinfo', {
            params: {
                requestfrom: 'selflogin',
                uids: tokenResult.accid,
                callback: `jQuery${Math.random().toString().slice(2)}_${Date.now()}`,
                _: Date.now()
            },
            headers: {
                'Cookie': cookie,
                'Referer': 'https://y.tuwan.com/'
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
        return { success: false };
    } catch (error) {
        return { success: false };
    }
}

async function getNeteaseToken(cookie) {
    try {
        const response = await api.get('https://u.tuwan.com/Netease/login', {
            params: {
                callback: `jQuery${Math.random().toString().slice(2)}_${Date.now()}`,
                _: Date.now()
            },
            headers: {
                'Cookie': cookie,
                'Referer': 'https://y.tuwan.com/'
            }
        });

        const match = response.data.match(/\((.*?)\)/);
        if (match) {
            const data = JSON.parse(match[1]);
            if (data.error === 0) {
                return { success: true, ...data };
            }
        }
        return { success: false };
    } catch (error) {
        return { success: false };
    }
}

async function joinRoom(roomId, cookie) {
    try {
        // 获取房间信息
        await api.get('https://papi.tuwan.com/Chatroom/getPcListV4', {
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
                'Referer': `https://y.tuwan.com/chatroom/${roomId}`
            }
        });

        // 获取房间状态
        await api.get('https://papi.tuwan.com/Game/getGameStatus', {
            params: {
                format: 'jsonp',
                cid: roomId,
                callback: `jQuery${Math.random().toString().slice(2)}_${Date.now()}`,
                _: Date.now()
            },
            headers: {
                'Cookie': cookie,
                'Referer': `https://y.tuwan.com/chatroom/${roomId}`
            }
        });

        await reportOnlineStatus(roomId, cookie);
        return true;
    } catch (error) {
        return false;
    }
}

async function sendActivityHeartbeat(roomId, cookie) {
    try {
        const response = await api.get('https://activity.tuwan.com/Activitymanagement/activity', {
            params: {
                cid: roomId,
                from: '1',
                callback: `jQuery${Math.random().toString().slice(2)}_${Date.now()}`,
                _: Date.now()
            },
            headers: {
                'Cookie': cookie,
                'Referer': `https://y.tuwan.com/chatroom/${roomId}`
            }
        });
        return !response.data.includes('请先登录');
    } catch {
        return false;
    }
}

async function reportOnlineStatus(roomId, cookie) {
    try {
        await api.post('https://app-diandian-report.tuwan.com/',
            querystring.stringify({
                roomId: roomId,
                status: 'online',
                timestamp: Date.now()
            }),
            {
                headers: {
                    'Cookie': cookie,
                    'Referer': `https://y.tuwan.com/chatroom/${roomId}`,
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Origin': 'https://y.tuwan.com'
                }
            }
        );
        return true;
    } catch {
        return false;
    }
}

async function heartbeat(state) {
    if (!state.currentCookie || !state.currentRoomId) {
        state.heartbeatStatus = false;
        return false;
    }

    try {
        const userCheck = await getUserInfo(state.currentCookie);
        if (!userCheck.success) {
            state.heartbeatStatus = false;
            return false;
        }

        const activityResult = await sendActivityHeartbeat(state.currentRoomId, state.currentCookie);
        if (!activityResult) {
            state.heartbeatStatus = false;
            return false;
        }

        await reportOnlineStatus(state.currentRoomId, state.currentCookie);
        
        state.lastHeartbeatTime = new Date();
        state.heartbeatStatus = true;
        return true;
    } catch {
        state.heartbeatStatus = false;
        return false;
    }
}

// 定时任务处理
const sessions = new Map();

setInterval(() => {
    globalState.forEach((state, sessionId) => {
        if (state.currentCookie && state.currentRoomId) {
            heartbeat(state).catch(() => {});
        }
    });
}, 2 * 60 * 1000);

setInterval(() => {
    globalState.forEach((state, sessionId) => {
        if (state.currentCookie && state.currentRoomId) {
            reportOnlineStatus(state.currentRoomId, state.currentCookie).catch(() => {});
        }
    });
}, 60 * 1000);

module.exports = handler;