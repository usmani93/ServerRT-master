const outgoingVideo = document.getElementById('outgoingVideo');
const incomingVideo = document.getElementById('incomingVideo');
const userInput = document.getElementById('userName');
const messageInput = document.getElementById('message');
const showMessage = document.getElementById('messageReceived');
const connectionId = document.getElementById('connectionId');
const connectedUsers = document.getElementById('connectedUsers');
const callButton = document.getElementById('callButton');
const hangupButton = document.getElementById('hangupButton');
let localPeerConnection;
var connections = {};

const errorHandler = (error) => {
    if (error.message)
        console.log(JSON.stringify(error.message));
    else
        console.log(JSON.stringify(error));
};

const onStreamRemoved = (connection, streamId) => {
    console.log("WebRTC: onStreamRemoved -> Removing stream: ");
}

const mediaStreamConstraints = {
    video: true,
    audio: true
};

let localStream;

const configuration = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

function getMediaDevices() {
    //get video stream and show it to as outgoing video
    return navigator.mediaDevices.getUserMedia(mediaStreamConstraints)
        .then(ms => { getLocalMediaStream(ms); return ms; })
        .catch(err => { handleLocalMediaStreamError(err); throw err; });
}

function getLocalMediaStream(mediaStream) {
    localStream = mediaStream;
    outgoingVideo.srcObject = mediaStream;
}

async function ensureLocalMedia() {
    if (localStream) return localStream;
    try {
        const ms = await getMediaDevices();
        return ms;
    } catch (e) {
        throw e;
    }
}

function handleLocalMediaStreamError(error) {
    console.log('navigator.getUserMedia error:', error);
}

// build hub connection but do NOT start yet. We'll start on Connect click so user can enter name first.
const hubConnection = new signalR.HubConnectionBuilder()
    .configureLogging(signalR.LogLevel.Debug)
    .withUrl("https://serverrt.azurewebsites.net/hub/rthub")
    .build();

let isConnected = false;
let inCall = false;

function setUIState() {
    const connectButton = document.getElementById('connectButton');
    const sendMessageButton = document.getElementById('sendMessageButton');
    const disconnectButton = document.getElementById('disconnectButton');
    callButton.disabled = !isConnected || inCall;
    hangupButton.disabled = !isConnected || !inCall;
    if (connectButton) connectButton.disabled = isConnected;
    if (sendMessageButton) sendMessageButton.disabled = !isConnected;
    if (disconnectButton) disconnectButton.disabled = !isConnected;

    // Update per-user Call buttons based on global state and per-user incall flags
    const userCallButtons = document.querySelectorAll('.userCallButton');
    userCallButtons.forEach(btn => {
        const userInCall = btn.dataset.incall === '1';
        btn.disabled = !isConnected || inCall || userInCall;
    });
}

async function startConnection() {
    try {
        await hubConnection.start();
        isConnected = true;
        console.log("SignalR Connected.");
        // show connected name if available
        const name = (userInput && userInput.value && userInput.value.trim()) ? userInput.value.trim() : 'Anonymous';
        const connectedNameEl = document.getElementById('connectedName');
        if (connectedNameEl) connectedNameEl.textContent = name;
        connectionId.innerHTML = name;
        // Join the hub with the entered name
        hubConnection.invoke("Join", name).then(() => getMediaDevices()).catch(err => console.log(err));
        setUIState();
    } catch (err) {
        console.log(err);
        setTimeout(startConnection, 5000);
    }
};

hubConnection.onclose(async () => {
    isConnected = false;
    const connectedNameEl = document.getElementById('connectedName');
    if (connectedNameEl) connectedNameEl.textContent = '(not connected)';
    // attempt reconnect
    setUIState();
    await startConnection();
})

// Wire Connect button
const connectButton = document.getElementById('connectButton');
if (connectButton) {
    connectButton.addEventListener('click', async () => {
        connectButton.disabled = true;
        await startConnection();
        connectButton.disabled = false;
        setUIState();
    });
}

// Wire send message button
const sendMessageButton = document.getElementById('sendMessageButton');
if (sendMessageButton) {
    sendMessageButton.addEventListener('click', () => sendMessage());
}

// Wire disconnect button
const disconnectButton = document.getElementById('disconnectButton');
if (disconnectButton) {
    disconnectButton.addEventListener('click', () => onDisconnect());
}

// Backwards compatible getId() — used by the existing Get Id button if clicked manually
function getId() {
    const name = (userInput && userInput.value && userInput.value.trim()) ? userInput.value.trim() : 'Anonymous';
    if (!isConnected) {
        // start connection and join
        startConnection();
        return;
    }
    hubConnection.invoke("Join", name)
        .then(function () {
            console.log("join", name);
            getMediaDevices();
        }).catch(function (err) {
            return console.log(err.toString());
        });
}

hubConnection.on('updateUserList', (userList) => {
    connectedUsers.innerHTML = "";
    console.log('SignalR: called updateUserList' + JSON.stringify(userList));
    userList.forEach((item) => {
        let li = document.createElement("li");
        li.className = "user-item";

        let callBtn = document.createElement('button');
        callBtn.textContent = 'Call';
        callBtn.className = 'userCallButton btn-primary';
        callBtn.dataset.incall = item.inCall ? '1' : '0';

        callBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const target = item;
            if (target.connectionId != connectionId.innerText) {
                hubConnection.invoke('CallUser', { "connectionId": target.connectionId });
            } else {
                console.log("Ah, nope.  Can't call yourself.");
            }
        }, false);

        let userInfo = document.createElement('div');
        userInfo.className = 'user-info';

        let userName = document.createElement('div');
        userName.className = 'user-name';
        userName.textContent = item.username;

        let userId = document.createElement('div');
        userId.className = 'user-id';
        userId.textContent = item.connectionId;

        userInfo.appendChild(userName);
        userInfo.appendChild(userId);

        li.appendChild(callBtn);
        li.appendChild(userInfo);

        if (item.inCall) {
            let inCallLabel = document.createElement('span');
            inCallLabel.textContent = 'In Call';
            inCallLabel.className = 'inCallLabel';
            li.appendChild(inCallLabel);
        }

        connectedUsers.appendChild(li);
    });
    setUIState();
});

function onDisconnect() {
    // Prefer calling the server-side Disconnect() method which will HangUp() and abort the connection server-side.
    (async () => {
        try {
            if (isConnected) {
                // Try to call server Disconnect which will perform server-side HangUp and Context.Abort()
                await hubConnection.invoke('Disconnect').catch(async (e) => {
                    console.log('Server Disconnect failed, falling back to HangUp+stop', e);
                    // Fallback: attempt to hang up then stop locally
                    await hubConnection.invoke('HangUp').catch(e2 => console.log('HangUp failed', e2));
                    try { await hubConnection.stop(); } catch (stopErr) { console.log('stop failed', stopErr); }
                });
            }
        } catch (err) {
            console.log('Error while disconnecting', err);
        } finally {
            isConnected = false;
            inCall = false;
            setUIState();
            const connectedNameEl = document.getElementById('connectedName');
            if (connectedNameEl) connectedNameEl.textContent = '(not connected)';
        }
    })();
}

function onclickUser(item) {
    console.log('calling user... ');
    const targetConnectionId = item.currentTarget.myValue;
    console.log("to: " + targetConnectionId.connectionId);
    console.log("from: " + connectionId.innerText);
    // Then make sure we aren't calling ourselves.
    if (targetConnectionId.connectionId != connectionId.innerText) {
        // Initiate a call
        hubConnection.invoke('CallUser', { "connectionId": targetConnectionId.connectionId });
        // UI in calling mode
    } else {
        console.log("Ah, nope.  Can't call yourself.");
    }
}

// incoming call: show modal and wait for user accept/decline
let pendingIncomingCaller = null;
let incomingModal = null;
let incomingText = null;
let acceptCallButton = null;
let declineCallButton = null;
let incomingModalInitialized = false;

function showIncomingModal(caller) {
    pendingIncomingCaller = caller;
    // lazy-init elements and handlers (handles case where modal markup is after the script)
    incomingModal = incomingModal || document.getElementById('incomingModal');
    incomingText = incomingText || document.getElementById('incomingText');
    acceptCallButton = acceptCallButton || document.getElementById('acceptCallButton');
    declineCallButton = declineCallButton || document.getElementById('declineCallButton');

    if (!incomingModalInitialized) {
        if (acceptCallButton) {
            acceptCallButton.addEventListener('click', async () => {
                if (!pendingIncomingCaller) return;
                try {
                    if (!localStream) {
                        // request media permissions before accepting
                        await ensureLocalMedia();
                        setUIState();
                    }
                    await hubConnection.invoke('AnswerCall', true, pendingIncomingCaller);
                } catch (err) {
                    console.log('Could not get local media', err);
                    // If no device is found, offer to accept as receive-only (no local tracks)
                    const errName = err && err.name ? err.name : '';
                    if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError' || errName === 'OverconstrainedError') {
                        const acceptNoMedia = confirm('No camera or microphone found or accessible. Accept call as receive-only (you will receive audio/video but not send)? Press OK to accept without sending media, Cancel to decline.');
                        if (acceptNoMedia) {
                            try { await hubConnection.invoke('AnswerCall', true, pendingIncomingCaller); } catch (e) { console.log(e); }
                        } else {
                            try { await hubConnection.invoke('AnswerCall', false, pendingIncomingCaller); } catch (e) { console.log(e); }
                        }
                    } else {
                        try { await hubConnection.invoke('AnswerCall', false, pendingIncomingCaller); } catch (e) { console.log(e); }
                    }
                } finally {
                    hideIncomingModal();
                }
            });
        }
        if (declineCallButton) {
            declineCallButton.addEventListener('click', () => {
                if (!pendingIncomingCaller) return;
                hubConnection.invoke('AnswerCall', false, pendingIncomingCaller).catch(err => console.log(err));
                hideIncomingModal();
            });
        }
        incomingModalInitialized = true;
    }

    if (incomingText) incomingText.textContent = `Incoming call from ${caller.username || caller.connectionId}`;
    if (incomingModal) incomingModal.style.display = 'block';
}

function hideIncomingModal() {
    pendingIncomingCaller = null;
    incomingModal = incomingModal || document.getElementById('incomingModal');
    if (incomingModal) incomingModal.style.display = 'none';
}

hubConnection.on('incomingCall', (callingUser) => {
    console.log('SignalR: incoming call from: ' + JSON.stringify(callingUser));
    showIncomingModal(callingUser);
});

// Add handler for the hangup button
hangupButton.onclick = (function () {
    console.log('hangup....');
    // Only allow hangup if we are not idle
    hubConnection.invoke('hangUp');
    // Close all peer connections locally
    closeAllConnections();
    inCall = false;
    setUIState();
});

// Close all of our connections and stop associated tracks
const closeAllConnections = () => {
    console.log("WebRTC: call closeAllConnections ");
    for (var connectionId in connections) {
        closeConnection(connectionId);
    }
    // Stop local stream tracks
    if (localStream) {
        localStream.getTracks().forEach(t => {
            try { t.stop(); } catch (e) { }
        });
        localStream = null;
        if (outgoingVideo) outgoingVideo.srcObject = null;
    }
}

hubConnection.on('callAccepted', (acceptingUser) => {
    console.log('SignalR: call accepted from: ' + JSON.stringify(acceptingUser) + '.  Initiating WebRTC call and offering my stream up...');
    // Callee accepted our call, let's send them an offer with our video stream
    inCall = true;
    setUIState();
    initiateOffer(acceptingUser.connectionId, localStream); // Will use driver email in production
});

const initiateOffer = (partnerClientId, stream) => {
    console.log('WebRTC: called initiateoffer: ');
    var connection = getConnection(partnerClientId); // // get a connection for the given partner
    // Add tracks from local stream
    if (localStream) {
        localStream.getTracks().forEach(track => connection.addTrack(track, localStream));
        console.log("WebRTC: Added local tracks");
    }

    connection.createOffer().then(offer => {
        console.log('WebRTC: created Offer: ', offer);
        return connection.setLocalDescription(offer);
    }).then(() => {
        console.log('WebRTC: set Local Description: ', connection.localDescription);
        // send the SDP to peer
        sendHubSignal(JSON.stringify({ "sdp": connection.localDescription }), partnerClientId);
    }).catch(err => console.error('WebRTC: Error while creating or setting local description', err));
}

const getConnection = (partnerClientId) => {
    console.log("WebRTC: called getConnection");
    if (connections[partnerClientId]) {
        console.log("WebRTC: connections partner client exist");
        return connections[partnerClientId];
    }
    else {
        console.log("WebRTC: initialize new connection");
        return initializeConnection(partnerClientId)
    }
}

const initializeConnection = (partnerClientId) => {
    console.log('WebRTC: Initializing connection...');
    var connection = new RTCPeerConnection(configuration);
    connection.onicecandidate = evt => callbackIceCandidate(evt, connection, partnerClientId); // ICE Candidate Callback
    // Modern API: ontrack
    connection.ontrack = (evt) => {
        console.log('WebRTC: ontrack', evt);
        // Attach the first stream found
        if (evt.streams && evt.streams[0]) {
            attachMediaStream(evt.streams[0]);
        } else if (evt.track) {
            // create a stream from track
            const inboundStream = new MediaStream();
            inboundStream.addTrack(evt.track);
            attachMediaStream(inboundStream);
        }
    };
    connections[partnerClientId] = connection; // Store away the connection based on username
    return connection;
}

// Hub Callback: Call Declined
hubConnection.on('callDeclined', (decliningUser, reason) => {
    console.log('SignalR: call declined from: ' + decliningUser.connectionId);
});

hubConnection.on('callEnded', (signalingUser, signal) => {
    console.log('SignalR: call with ' + signalingUser.connectionId + ' has ended: ' + signal);
    // Close the WebRTC connection
    closeConnection(signalingUser.connectionId);
});

// Close the connection between myself and the given partner
const closeConnection = (partnerClientId) => {
    console.log("WebRTC: called closeConnection ");
    var connection = connections[partnerClientId];
    if (connection) {
        // Let the user know which streams are leaving
        // todo: foreach connection.remoteStreams -> onStreamRemoved(stream.id)
        onStreamRemoved(null, null);
        // Stop remote tracks
        try {
            const receivers = connection.getReceivers ? connection.getReceivers() : [];
            receivers.forEach(r => {
                if (r.track) {
                    try { r.track.stop(); } catch (e) { }
                }
            });
        } catch (e) { }
        // Remove local senders
        try {
            const senders = connection.getSenders ? connection.getSenders() : [];
            senders.forEach(s => {
                try { connection.removeTrack(s); } catch (e) { }
            });
        } catch (e) { }
        // Close the connection
        try { connection.close(); } catch (e) { }
        delete connections[partnerClientId]; // Remove the property
        setUIState();
    }
}

sendHubSignal = (candidate, partnerClientId) => {
    console.log('candidate', candidate);
    console.log('SignalR: called sendhubsignal ');
    hubConnection.invoke('sendSignal', candidate, partnerClientId).catch(errorHandler);
};

function sendMessage() {
    hubConnection.invoke("SendMessage", userInput.value, messageInput.value)
        .then(function () {
            //console.log(userInput.value + messageInput.value);
        }).catch(function (err) {
            return console.log(err.toString());
        })
}

// Hub Callback: WebRTC Signal Received
hubConnection.on('receiveSignal', (signalingUser, signal) => {
    newSignal(signalingUser.connectionId, signal);
});

// Hand off a new signal from the signaler to the connection
const newSignal = (partnerClientId, data) => {
    console.log('WebRTC: called newSignal');
    var signal = JSON.parse(data);
    var connection = getConnection(partnerClientId);
    console.log("connection: ", connection);

    // Route signal based on type
    if (signal.sdp) {
        console.log('WebRTC: sdp signal');
        receivedSdpSignal(connection, partnerClientId, signal.sdp);
    } else if (signal.candidate) {
        console.log('WebRTC: candidate signal');
        receivedCandidateSignal(connection, partnerClientId, signal.candidate);
    } else {
        console.log('WebRTC: adding null candidate');
        // Some browsers don't need null candidate; skip if not supported
        try { connection.addIceCandidate(null); } catch (e) { /* ignore */ }
    }
}

// Process a newly received SDP signal
const receivedSdpSignal = async (connection, partnerClientId, sdp) => {
    console.log('connection: ', connection);
    console.log('sdp', sdp);
    console.log('WebRTC: called receivedSdpSignal');
    try {
        await connection.setRemoteDescription(new RTCSessionDescription(sdp));
        console.log('WebRTC: set Remote Description');
        if (connection.remoteDescription && connection.remoteDescription.type === 'offer') {
            console.log('WebRTC: remote Description type offer');
            // Add local tracks
            if (localStream) {
                localStream.getTracks().forEach(track => connection.addTrack(track, localStream));
            }
            const answer = await connection.createAnswer();
            await connection.setLocalDescription(answer);
            console.log('WebRTC: set Local Description (answer)');
            sendHubSignal(JSON.stringify({ sdp: connection.localDescription }), partnerClientId);
            inCall = true;
            setUIState();
        } else if (connection.remoteDescription && connection.remoteDescription.type === 'answer') {
            console.log('WebRTC: remote Description type answer');
        }
    } catch (err) {
        console.error('WebRTC: Error processing SDP', err);
    }
}

const receivedCandidateSignal = (connection, partnerClientId, candidate) => {
    console.log('WebRTC: adding full candidate');
    try {
        if (candidate) {
            connection.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => console.warn('addIceCandidate failed', e));
        }
    } catch (e) {
        console.warn('addIceCandidate exception', e);
    }
}

attachMediaStream = (stream) => {
    console.log("OnPage: called attachMediaStream");
    if (incomingVideo.srcObject !== stream) {
        incomingVideo.srcObject = stream;
        console.log("OnPage: Attached remote stream");
    }
};

const callbackIceCandidate = (evt, connection, partnerClientId) => {
    console.log("WebRTC: Ice Candidate callback");
    if (evt.candidate) {// Found a new candidate
        console.log('WebRTC: new ICE candidate');
        sendHubSignal(JSON.stringify({ "candidate": evt.candidate }), partnerClientId);
    } else {
        // Null candidate means we are done collecting candidates.
        console.log('WebRTC: ICE candidate gathering complete');
        sendHubSignal(JSON.stringify({ "candidate": null }), partnerClientId);
    }
}