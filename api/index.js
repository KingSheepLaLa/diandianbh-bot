const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const api = require('axios');
const querystring = require('querystring');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));
app.use(bodyParser.json());

let currentCookie = '';
let currentRoomId = '';
let userData = null;
let lastHeartbeat = null;
let lastStatusReport = null;

async function getUserInfo(cookie) {
    try {
        const response = await api.get('https://u.tuwan.com/Netease/getuserinfo', {
            headers: { 'Cookie': cookie }
        });

        if (response.data && response.data.code === 0) {
            return {
                success: true,
                data: {
                    nickname: response.data.data.nickname,
                    accid: response.data.data.accid
                }
            };
        } else {
            return {
                success: false,
                message: response.data.msg || '获取用户信息失败'
            };
        }
    } catch (error) {
        return {
            success: false,
            message: error.message
        };
    }
}

async function joinRoom(roomId, cookie) {
    try {
        const roomInfoResponse = await api.get(`https://papi.tuwan.com/Chatroom/getPcListV4?roomId=${roomId}`, {
            headers: {
                'Cookie': cookie,
                'Referer': `https://y.tuwan.com/chatroom/${roomId}`
            }
        });

        const joinResponse = await api.post('https://papi.tuwan.com/Chatroom/joinroom',
            querystring.stringify({
                roomId: roomId,
                channel: roomInfoResponse.data.data.channelId
            }),
            {
                headers: {
                    'Cookie': cookie,
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Referer': `https://y.tuwan.com/chatroom/${roomId}`
                }
            }
        );

        return joinResponse.data.code === 0;
    } catch (error) {
        console.error('加入房间失败:', error);
        return false;
    }
}

async function heartbeat() {
    if (!currentCookie || !currentRoomId) return false;

    try {
        const response = await api.get('https://activity.tuwan.com/activity/checkActivity', {
            headers: { 'Cookie': currentCookie }
        });

        lastHeartbeat = new Date();
        return response.data.code === 0;
    } catch (error) {
        console.error('心跳请求失败:', error);
        return false;
    }
}

async function reportStatus() {
    if (!currentCookie || !currentRoomId) return false;

    try {
        const response = await api.post('https://app-diandian-report.tuwan.com/api/live/report',
            { roomId: currentRoomId },
            {
                headers: {
                    'Cookie': currentCookie,
                    'Content-Type': 'application/json'
                }
            }
        );

        lastStatusReport = new Date();
        return response.data.code === 0;
    } catch (error) {
        console.error('状态上报失败:', error);
        return false;
    }
}

app.post('/api/update-config', async (req, res) => {
    const { roomId, cookie } = req.body;
    
    try {
        const userInfoResult = await getUserInfo(cookie);
        
        if (userInfoResult.success) {
            const joinResult = await joinRoom(roomId, cookie);
            if (!joinResult) {
                return res.json({
                    success: false,
                    message: '加入房间失败'
                });
            }

            currentCookie = cookie;
            currentRoomId = roomId;
            userData = userInfoResult.data;
            
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
    res.json({
        isLoggedIn: !!currentCookie && !!userData,
        userData: userData,
        roomId: currentRoomId,
        heartbeatStatus: lastHeartbeat && (Date.now() - lastHeartbeat.getTime() < 60000),
        lastHeartbeat: lastHeartbeat,
        lastStatusReport: lastStatusReport
    });
});

setInterval(heartbeat, 30000);
setInterval(reportStatus, 60000);

app.listen(PORT, () => {
    console.log(`服务器运行在 http://localhost:${PORT}`);
});