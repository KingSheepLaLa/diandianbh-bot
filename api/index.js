const axios = require('axios');
const querystring = require('querystring');

const api = axios.create({
    timeout: process.env.API_TIMEOUT || 15000,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'X-Requested-With': 'XMLHttpRequest',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-Mode': 'cors'
    }
});

const globalState = new Map();

function generateRandomIP() {
    return `117.136.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}`;
}

function generateFakeUserIDs() {
    return Array.from({length: 20}, () => Math.floor(1000000 + Math.random()*9000000)).join(',');
}

async function verifyUserIdentity(cookie, roomId) {
    try {
        const response = await api.get('https://papi.tuwan.com/Chatroom/getuserinfo', {
            params: {
                requestfrom: 'sms',
                uids: 'tuwan_yuwan',
                callback: `jQuery${Math.random().toString().slice(2)}_${Date.now()}`,
                _: Date.now()
            },
            headers: {
                'Cookie': cookie,
                'Referer': `https://y.tuwan.com/chatroom/${roomId}`,
                'X-Requested-With': 'XMLHttpRequest'
            }
        });
        return response.data;
    } catch (error) {
        console.error('验证用户身份失败:', error);
        return null;
    }
}

async function updateMemberList(roomId, cookie, accid) {
    try {
        const userIds = `${accid},${generateFakeUserIDs()}`;
        await api.get('https://papi.tuwan.com/Chatroom/getuserinfo', {
            params: {
                requestfrom: 'addChannelUsers',
                uids: userIds,
                callback: `jQuery${Math.random().toString().slice(2)}_${Date.now()}`,
                _: Date.now()
            },
            headers: {
                'Cookie': cookie,
                'Origin': 'https://y.tuwan.com',
                'Referer': `https://y.tuwan.com/chatroom/${roomId}`,
                'Sec-Fetch-Dest': 'script'
            }
        });
        return true;
    } catch (error) {
        console.error('更新成员列表失败:', error);
        return false;
    }
}

async function triggerSystemBroadcast(roomId, cookie) {
    try {
        await api.post('https://app-diandian-report.tuwan.com/', 
            querystring.stringify({
                roomId: roomId,
                status: 'online',
                timestamp: Date.now(),
                actionType: 'enter',
                deviceId: 'WEB_' + Math.random().toString(36).substr(2, 9)
            }),
            {
                headers: {
                    'Cookie': cookie,
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Origin': 'https://y.tuwan.com',
                    'Referer': `https://y.tuwan.com/chatroom/${roomId}`,
                    'X-Forwarded-For': generateRandomIP()
                }
            }
        );
        return true;
    } catch (error) {
        console.error('触发系统广播失败:', error);
        return false;
    }
}

async function sendActivityHeartbeat(roomId, cookie) {
    try {
        const params = {
            cid: roomId,
            from: '1',
            callback: `jQuery${Math.random().toString().slice(2)}_${Date.now()}`,
            _: Date.now(),
            r: Math.random().toString(36).substr(2, 5)
        };

        const response = await api.get('https://activity.tuwan.com/Activitymanagement/activity', {
            params: params,
            headers: {
                'Cookie': cookie,
                'Referer': `https://y.tuwan.com/chatroom/${roomId}`,
                'X-Forwarded-For': generateRandomIP()
            }
        });
        return !response.data.includes('请先登录');
    } catch (error) {
        console.error('心跳发送失败:', error);
        return false;
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
        console.error('获取Netease token失败:', error);
        return { success: false };
    }
}

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
        console.error('获取用户信息失败:', error);
        return { success: false };
    }
}

async function joinRoom(roomId, cookie, accid) {
    try {
        // 1. 身份验证
        await verifyUserIdentity(cookie, roomId);
        
        // 2. 更新成员列表
        await updateMemberList(roomId, cookie, accid);
        
        // 必要的延迟
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // 3. 触发系统广播
        await triggerSystemBroadcast(roomId, cookie);
        
        // 4. 发送活动心跳
        await sendActivityHeartbeat(roomId, cookie);
        
        // 5. 最终确认延迟
        await new Promise(resolve => setTimeout(resolve, 1000));

        return true;
    } catch (error) {
        console.error('进入房间失败:', error);
        return false;
    }
}

const handler = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

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

    if (req.method === 'POST' && req.url.startsWith('/api/update-config')) {
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

                const joinResult = await joinRoom(roomId, cookie, userInfo.data.accid);
                const heartbeatResult = await sendActivityHeartbeat(roomId, cookie);
                
                return res.json({
                    success: true,
                    data: {
                        ...userInfo.data,
                        heartbeatStatus: heartbeatResult,
                        roomId: roomId,
                        joinStatus: joinResult
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

    if (req.method === 'GET' && req.url.startsWith('/api/status')) {
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

    return res.status(404).json({ success: false, message: '未找到请求的接口' });
};

// 心跳定时任务
setInterval(() => {
    globalState.forEach((state) => {
        if(state.currentCookie && state.currentRoomId) {
            sendActivityHeartbeat(state.currentRoomId, state.currentCookie)
                .catch(err => console.error('Enhanced heartbeat failed:', err));
        }
    });
}, process.env.HEARTBEAT_INTERVAL || 120000);

// 状态上报定时任务
setInterval(() => {
    globalState.forEach((state) => {
        if(state.currentCookie && state.currentRoomId) {
            triggerSystemBroadcast(state.currentRoomId, state.currentCookie)
                .catch(err => console.error('Status report failed:', err));
        }
    });
}, 60000);

module.exports = handler;