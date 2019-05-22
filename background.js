/* Copyright (c) 2019 Parallax Inc., All Rights Reserved. */

// Container for openPort IDs
var openPorts = [];

// Register listeners to create app window upon application launch and
// to close active serial ports upon application termination
chrome.app.runtime.onLaunched.addListener(function() {
    chrome.app.window.create('index.html', {
        id: "BlocklyProp-Launcher",
        innerBounds: {
            width: 500,
            height: 414
        }, state: "normal",
        resizable: false
    }, function(win) {
        chrome.runtime.onMessage.addListener(logPorts);
        win.onClosed.addListener(closeSerialPorts);
        win.onClosed.addListener(closeServer);
        });
  });

function logPorts(msg) {
// Log port open/close/delete events for system cleanup upon application termination
    console.log("Received message: ", msg);
    if (msg.hasOwnProperty("connId") && msg.hasOwnProperty("state")) {
        if (msg.state === "opened") {
            openPorts.push({connId: msg.connId});
            console.log("Added connection id: " + msg.connId);
        } else {
            let idx = openPorts.findIndex(function(p) {return p["connId"] === msg.connId});
            if (idx > -1) {
                openPorts.splice(idx, 1);
                console.log("Removed connection id: " + msg.connId);
            }
        }
    }
}

function closeSerialPorts() {
// Close this app's active serial ports
    //Check any known-open ports
    openPorts.forEach(function(oPort) {
        chrome.serial.disconnect(oPort.connId, function() {});
    });
    //Ask OS for others
    chrome.serial.getConnections(function(activeConnections) {
        activeConnections.forEach(function(port) {
            chrome.serial.disconnect(port.connectionId, function() {});
        });
    });
}

function closeServer() {
// Close this app's active server(s)
    chrome.sockets.tcpServer.getSockets(function (socketInfos) {
        socketInfos.forEach(function(v) {chrome.sockets.tcpServer.close(v.socketId)});
    });
}
