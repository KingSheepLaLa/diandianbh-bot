const express = require('express');
const axios = require('axios');
const path = require('path');
const qs = require('qs');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

const CONFIG = {
    USER_AGENT: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
    NIM_APP_KEY: '712eb79f6472f09e9d8f19aecba1cf43',
    HEARTBEAT_INTERVAL: 30000,
    MAX_RETRIES: 3,
    API_BASE_URL: 'https://papi.tuwan.com',
    USER_ID: '3286219'  // Your confirmed user ID
};

const globalState = {
    cookie: '',
    roomId: '',
    userId: '',
    nickname: '',
    nimToken: '',
    lastHeartbeat: null,
    lastReport: null,
    isConnected: false,
    startTime: new Date(),
    retryCount: 0,
    heartbeatInterval: null
};

const api = axios.create({
    timeout: 10000,
    validateStatus: status => status >= 200 && status < 300,
    headers: {
        'User-Agent': CONFIG.USER_AGENT,
        'Accept': '*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Sec-Ch-Ua': '"Not A(Brand";v="8", "Chromium";v="132"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"'
    }
});

function generateCallback() {
    return `jQuery${Math.random().toString().slice(2)}_${Date.now()}`;
}

function parseJsonp(response) {
    try {
        if (!response?.data) {
            console.error('Empty JSONP response');
            return null;
        }

        const data = response.data.toString().trim();
        const match = data.match(/jQuery[0-9_]+\((.*)\)/);
        
        if (!match?.[1]) {
            console.error('Invalid JSONP format:', data);
            return null;
        }

        try {
            return JSON.parse(match[1]);
        } catch (e) {
            console.error('JSON parsing failed:', e);
            return null;
        }
    } catch (error) {
        console.error('JSONP parsing error:', error.message);
        console.error('Raw response:', response.data);
        return null;
    }
}

async function getUserInfo() {
    try {
        // Initial base URL request
        await api.get(`${CONFIG.API_BASE_URL}/Api/getBaseUrl`, {
            params: {
                format: 'jsonp',
                callback: generateCallback(),
                _: Date.now()
            },
            headers: {
                'Cookie': globalState.cookie,
                'Referer': 'https://y.tuwan.com/',
                'Origin': 'https://y.tuwan.com'
            }
        });

        // Get user information
        const userInfoResponse = await api.get(`${CONFIG.API_BASE_URL}/Chatroom/getuserinfo`, {
            params: {
                requestfrom: 'selflogin',
                uids: CONFIG.USER_ID,
                callback: generateCallback(),
                _: Date.now()
            },
            headers: {
                'Cookie': globalState.cookie,
                'Referer': 'https://y.tuwan.com/',
                'Origin': 'https://y.tuwan.com'
            }
        });

        console.log('User info response:', userInfoResponse.data);
        const userData = parseJsonp(userInfoResponse);

        if (!userData || userData.error !== 0) {
            throw new Error('User verification failed');
        }

        if (!Array.isArray(userData.data) || !userData.data[0]) {
            throw new Error('Invalid user data format');
        }

        const user = userData.data[0];
        if (!user.uid || !user.nickname) {
            throw new Error('Missing required user information');
        }

        return {
            success: true,
            data: user
        };
    } catch (error) {
        console.error('Failed to get user info:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

async function joinRoom() {
    if (!globalState.cookie || !globalState.roomId) {
        throw new Error('Missing required configuration');
    }

    const headers = {
        'User-Agent': CONFIG.USER_AGENT,
        'Accept': '*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Cookie': globalState.cookie,
        'Referer': 'https://y.tuwan.com/',
        'Origin': 'https://y.tuwan.com'
    };

    try {
        // Get user information
        const userResult = await getUserInfo();
        if (!userResult.success) {
            throw new Error('Failed to get user info: ' + userResult.error);
        }

        globalState.userId = userResult.data.uid;
        globalState.nickname = userResult.data.nickname;

        console.log('User info retrieved successfully:', {
            userId: globalState.userId,
            nickname: globalState.nickname
        });

        // Get room list
        await api.get(`${CONFIG.API_BASE_URL}/Chatroom/getPcListV4`, {
            params: {
                ver: '14',
                format: 'jsonp',
                navid: '0',
                cid: globalState.roomId,
                callback: generateCallback(),
                _: Date.now()
            },
            headers: {
                ...headers,
                'Referer': `https://y.tuwan.com/chatroom/${globalState.roomId}`
            }
        });

        // Get web info
        await api.get(`${CONFIG.API_BASE_URL}/Agora/webinfo`, {
            params: {
                apiver: '6',
                channel: globalState.roomId,
                callback: generateCallback(),
                _: Date.now()
            },
            headers: {
                ...headers,
                'Referer': `https://y.tuwan.com/chatroom/${globalState.roomId}`
            }
        });

        // Get NIM token
        const loginResponse = await api.get('https://u.tuwan.com/Netease/login', {
            params: {
                callback: generateCallback(),
                _: Date.now()
            },
            headers: {
                ...headers,
                'Referer': `https://y.tuwan.com/chatroom/${globalState.roomId}`
            }
        });

        const loginData = parseJsonp(loginResponse);
        if (!loginData?.token) {
            throw new Error('Failed to get login token');
        }

        globalState.nimToken = loginData.token;

        // Join room
        await api.post('https://app-diandian-report.tuwan.com/', 
            qs.stringify({
                roomId: globalState.roomId,
                userId: globalState.userId,
                action: 'joinRoom',
                platform: 'web',
                timestamp: Date.now(),
                token: globalState.nimToken
            }),
            { 
                headers: {
                    ...headers,
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Referer': `https://y.tuwan.com/chatroom/${globalState.roomId}`
                }
            }
        );

        // Update room user list
        await api.get(`${CONFIG.API_BASE_URL}/Chatroom/getuserinfo`, {
            params: {
                requestfrom: 'addChannelUsers',
                uids: globalState.userId,
                callback: generateCallback(),
                _: Date.now()
            },
            headers: {
                ...headers,
                'Referer': `https://y.tuwan.com/chatroom/${globalState.roomId}`
            }
        });

        // Update online status
        await api.post('https://app-diandian-report.tuwan.com/', 
            qs.stringify({
                roomId: globalState.roomId,
                userId: globalState.userId,
                status: 'online',
                timestamp: Date.now()
            }),
            { 
                headers: {
                    ...headers,
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Referer': `https://y.tuwan.com/chatroom/${globalState.roomId}`
                }
            }
        );

        console.log('Room join process completed');
        globalState.isConnected = true;
        globalState.retryCount = 0;
        startHeartbeat();
        return true;

    } catch (error) {
        console.error('Room join process failed:', error);
        throw error;
    }
}

async function sendHeartbeat() {
    if (!globalState.isConnected) {
        return false;
    }

    const headers = {
        'User-Agent': CONFIG.USER_AGENT,
        'Cookie': globalState.cookie,
        'Referer': `https://y.tuwan.com/chatroom/${globalState.roomId}`,
        'Origin': 'https://y.tuwan.com'
    };

    try {
        await api.get('https://activity.tuwan.com/Activitymanagement/activity', {
            params: {
                cid: globalState.roomId,
                from: '1',
                callback: generateCallback(),
                _: Date.now()
            },
            headers
        });

        await api.post('https://app-diandian-report.tuwan.com/', 
            qs.stringify({
                roomId: globalState.roomId,
                userId: globalState.userId,
                status: 'online',
                timestamp: Date.now()
            }),
            { 
                headers: {
                    ...headers,
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );

        globalState.lastHeartbeat = new Date();
        globalState.lastReport = new Date();
        return true;
    } catch (error) {
        console.error('Heartbeat failed:', error);
        globalState.retryCount++;
        
        if (globalState.retryCount >= CONFIG.MAX_RETRIES) {
            await reconnect();
        }
        
        return false;
    }
}

async function reconnect() {
    console.log('Starting reconnection...');
    globalState.isConnected = false;
    clearInterval(globalState.heartbeatInterval);

    try {
        await joinRoom();
        console.log('Reconnection successful');
        globalState.retryCount = 0;
    } catch (error) {
        console.error('Reconnection failed:', error);
        throw error;
    }
}

function startHeartbeat() {
    if (globalState.heartbeatInterval) {
        clearInterval(globalState.heartbeatInterval);
    }

    sendHeartbeat().catch(console.error);
    globalState.heartbeatInterval = setInterval(() => {
        sendHeartbeat().catch(console.error);
    }, CONFIG.HEARTBEAT_INTERVAL);
}

app.post('/api/update-config', async (req, res) => {
    const { roomId, cookie } = req.body;
    
    if (!roomId || !cookie) {
        return res.status(400).json({
            success: false,
            message: 'Please provide complete configuration information'
        });
    }

    try {
        if (globalState.heartbeatInterval) {
            clearInterval(globalState.heartbeatInterval);
        }

        globalState.cookie = cookie;
        globalState.roomId = roomId;
        globalState.isConnected = false;
        
        await joinRoom();

        res.json({
            success: true,
            message: 'Successfully joined room',
            data: {
                roomId,
                userId: globalState.userId,
                nickname: globalState.nickname,
                timestamp: Date.now()
            }
        });
    } catch (error) {
        console.error('Configuration update failed:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

app.get('/api/status', (req, res) => {
    res.json({
        isConnected: globalState.isConnected,
        lastHeartbeat: globalState.lastHeartbeat,
        lastReport: globalState.lastReport,
        roomId: globalState.roomId,
        userId: globalState.userId,
        nickname: globalState.nickname,
        startTime: globalState.startTime,
        uptime: Date.now() - globalState.startTime,
        retryCount: globalState.retryCount
    });
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString()
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server started successfully, listening on port ${PORT}`);
});

module.exports = app;