//TODO Enhance (or integrate with index.js) to support multiple active connections (portIDs); talkToProp and hearFromProp especially
//TODO Revisit promisify and see if it will clean up code significantly

var portID = -1;
var portBaudrate = 0;
const initialBaudrate = 115200;
const finalBaudrate = 921600;

// propComm status values
const stValidating = -1;
const stInvalid = 0;
const stValid = 1;

// propComm stage values
const sgError = -2;
const sgIdle = -1;
const sgHandshake = 0;
const sgVersion = 1;
const sgRAMChecksum = 2;
const sgMBLResponse = 3;
//const sgEEProgram = 3;
//const sgEEChecksum = 4;

// Propeller Communication (propComm) status; categorizes Propeller responses
var propComm = {};                                  //Holds current status
var mblRespAB = new ArrayBuffer(8);                 //Buffer for Micro Boot Loader responses

const propCommStart = {                             //propCommStart is used to initialize propComm
    stage       : sgHandshake,                      //Propeller Protocol Stage
    rxCount     : 0,                                //Current count of receive bytes (for stage)
    handshake   : stValidating,                     //ROM-resident boot loader RxHandshake response validity
    version     : stValidating,                     //ROM-resident boot loader Propeller version number response validity
    ramCheck    : stValidating,                     //ROM-resident boot loader RAM Checksum response validity
    mblResponse : stValidating,                     //Micro Boot Loader response format validity
    mblRespBuf  : new Uint8Array(mblRespAB),        //Micro Boot Loader responses data (unsigned byte format)
    mblPacketId : new Int32Array(mblRespAB, 0, 1),  //Micro Boot Loader requested next packet id (32-bit signed int format)
    mblTransId  : new Int32Array(mblRespAB, 4, 1)   //Micro Boot Loader transmission id (32-bit signed int format)
//    eeProg    : stValidating,
//    eeCheck   : stValidating
};

const txHandshake = [
    0x49,                                                                            /*First timing template ('1' and '0') plus first two bits of handshake ('0' and '1')*/
    0xAA,0x52,0xA5,0xAA,0x25,0xAA,0xD2,0xCA,0x52,0x25,0xD2,0xD2,0xD2,0xAA,0x49,0x92, /*Remaining 248 bits of handshake...*/
    0xC9,0x2A,0xA5,0x25,0x4A,0x49,0x49,0x2A,0x25,0x49,0xA5,0x4A,0xAA,0x2A,0xA9,0xCA,
    0xAA,0x55,0x52,0xAA,0xA9,0x29,0x92,0x92,0x29,0x25,0x2A,0xAA,0x92,0x92,0x55,0xCA,
    0x4A,0xCA,0xCA,0x92,0xCA,0x92,0x95,0x55,0xA9,0x92,0x2A,0xD2,0x52,0x92,0x52,0xCA,
    0xD2,0xCA,0x2A,0xFF,
    0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29, /*250 timing templates ('1' and '0')*/
    0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29, /*to receive 250-bit handshake from */
    0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29, /*Propeller.}                       */
    0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29,
    0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29, /*This is encoded as two pairs per} */
    0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29, /*byte; 125 bytes}                  */
    0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29,
    0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29,0x29,
    0x29,0x29,0x29,0x29,                                                             /*8 timing templates ('1' and '0') to receive 8-bit Propeller ver; two pairs per byte; 4 bytes*/
    0x93,0x92,0x92,0x92,0x92,0x92,0x92,0x92,0x92,0x92,0xF2                           /*Download command (1; program RAM and run); 11 bytes*/
];

const rxHandshake = [
    0xEE,0xCE,0xCE,0xCF,0xEF,0xCF,0xEE,0xEF,0xCF,0xCF,0xEF,0xEF,0xCF,0xCE,0xEF,0xCF,  /*The RxHandshake array consists of 125 bytes encoded to represent the expected*/
    0xEE,0xEE,0xCE,0xEE,0xEF,0xCF,0xCE,0xEE,0xCE,0xCF,0xEE,0xEE,0xEF,0xCF,0xEE,0xCE,  /*250-bit (125-byte @ 2 bits/byte) response of continuing-LFSR stream bits from*/
    0xEE,0xCE,0xEE,0xCF,0xEF,0xEE,0xEF,0xCE,0xEE,0xEE,0xCF,0xEE,0xCF,0xEE,0xEE,0xCF,  /*the Propeller, prompted by the timing templates following the txHandshake stream.*/
    0xEF,0xCE,0xCF,0xEE,0xEF,0xEE,0xEE,0xEE,0xEE,0xEF,0xEE,0xCF,0xCF,0xEF,0xEE,0xCE,
    0xEF,0xEF,0xEF,0xEF,0xCE,0xEF,0xEE,0xEF,0xCF,0xEF,0xCF,0xCF,0xCE,0xCE,0xCE,0xCF,
    0xCF,0xEF,0xCE,0xEE,0xCF,0xEE,0xEF,0xCE,0xCE,0xCE,0xEF,0xEF,0xCF,0xCF,0xEE,0xEE,
    0xEE,0xCE,0xCF,0xCE,0xCE,0xCF,0xCE,0xEE,0xEF,0xEE,0xEF,0xEF,0xCF,0xEF,0xCE,0xCE,
    0xEF,0xCE,0xEE,0xCE,0xEF,0xCE,0xCE,0xEE,0xCF,0xCF,0xCE,0xCF,0xCF
];

const microBootLoader = [
    0x9a,0xd2,0x93,0x92,0x92,0x92,0x92,                                              /*Patched and Encoded Micro Boot Loader*/
    0x92,0x92,0x92,0xf2,0x92,0x92,0x92,0x4a,0x29,0xca,0x52,0xd2,0x92,0x52,0xa5,0xc9,
    0x92,0x92,0xc9,0xd2,0x92,0x92,0x92,0x92,0xd2,0x92,0x25,0x92,0x92,0x92,0x49,0xc9,
    0x92,0x92,0x92,0x92,0x25,0x92,0x92,0x4a,0x52,0x92,0x92,0x92,0xaa,0x29,0x92,0x92,
    0xca,0x92,0x92,0x92,0x92,0x92,0x52,0x29,0x92,0x92,0x92,0x92,0x92,0x92,0x92,0x4a,
    0x49,0x92,0x4a,0x55,0x95,0xc9,0x92,0xa9,0x2a,0xca,0x52,0xaa,0x55,0x29,0x92,0x4a,
    0xc9,0x4a,0x92,0xaa,0xca,0xaa,0xa9,0x92,0x4a,0xc9,0x92,0x92,0x52,0x29,0xaa,0x95,
    0xd2,0xca,0xca,0x52,0x95,0xaa,0xca,0xaa,0x29,0x92,0x92,0xc9,0x92,0x29,0xa5,0x29,
    0x2a,0x2a,0x92,0x4a,0xc9,0x4a,0x92,0xaa,0xca,0xaa,0x29,0x52,0x95,0x49,0xd5,0x52,
    0xd2,0x52,0x25,0xc9,0x52,0x4a,0x92,0x92,0xa5,0x29,0xaa,0x95,0xca,0xaa,0x49,0x29,
    0xd2,0xd2,0x92,0xaa,0x95,0x4a,0xca,0xca,0x52,0x92,0xa9,0xca,0xaa,0x29,0x92,0x4a,
    0xca,0x92,0x92,0xaa,0x29,0xaa,0x95,0x92,0x4a,0xc9,0x4a,0x92,0xaa,0xca,0xaa,0x29,
    0x92,0x4a,0xc9,0xaa,0x25,0x95,0x49,0x95,0xc9,0x92,0xd2,0xd2,0x92,0x92,0x55,0xca,
    0xaa,0x95,0x92,0x4a,0x92,0xc9,0x92,0x92,0x52,0x52,0xd5,0x92,0xd2,0x2a,0xd2,0xca,
    0x92,0x95,0x49,0x95,0xc9,0xaa,0x95,0x25,0xc9,0xd2,0xaa,0x55,0x29,0xca,0x2a,0xc9,
    0x92,0x92,0x49,0x29,0xaa,0xd5,0x92,0xca,0xca,0xd2,0xca,0x92,0x95,0x49,0x95,0xc9,
    0xaa,0x95,0x25,0xc9,0xd2,0xaa,0x55,0x29,0x92,0x95,0xca,0xca,0x92,0x92,0x52,0x52,
    0xd5,0xd2,0x52,0x25,0x4a,0x92,0xaa,0xca,0xaa,0x29,0x52,0xd5,0x2a,0xca,0x92,0xa9,
    0x55,0xa5,0x92,0xa9,0xaa,0xc9,0x92,0x55,0xca,0xaa,0x95,0xca,0xaa,0x92,0x49,0x92,
    0x49,0x92,0xaa,0x29,0x92,0x92,0xa9,0xc9,0x92,0xaa,0x29,0xaa,0x95,0xca,0xaa,0xca,
    0x4a,0xd2,0x92,0x29,0xaa,0x29,0x92,0x4a,0xd2,0x4a,0x92,0xc9,0xca,0x52,0xd5,0x92,
    0x4a,0xca,0x92,0x25,0x4a,0x29,0xaa,0x95,0x92,0x4a,0x4a,0x29,0xaa,0x29,0x52,0xa5,
    0xd2,0x4a,0xd2,0x2a,0xc9,0x92,0x2a,0x52,0xa5,0xd2,0x4a,0xd2,0x2a,0x49,0x92,0x25,
    0xaa,0x29,0x4a,0xca,0xd2,0x92,0x92,0x55,0xca,0xaa,0x95,0x92,0x4a,0xd2,0x4a,0x52,
    0x2a,0x49,0x95,0xc9,0x92,0xa9,0x49,0xca,0x92,0x95,0x49,0x95,0x25,0xd2,0xca,0x92,
    0x92,0xd2,0xaa,0xca,0xaa,0x95,0x92,0x4a,0x92,0x92,0x4a,0xaa,0xca,0xaa,0x95,0x49,
    0x25,0x49,0xd5,0x52,0xd2,0x52,0x25,0xc9,0x52,0x4a,0xd2,0x92,0xa5,0x29,0x52,0x95,
    0xca,0xaa,0x2a,0x25,0x92,0x92,0x92,0x52,0x25,0xaa,0x4a,0x92,0x55,0x52,0x29,0xaa,
    0x29,0x92,0x92,0x25,0x4a,0x92,0xaa,0xca,0xaa,0x29,0x52,0x95,0x49,0xd5,0x52,0xd2,
    0x52,0x25,0xc9,0x52,0x92,0x92,0x92,0xa5,0xa5,0x52,0xd5,0x92,0xaa,0xca,0x92,0x92,
    0x4a,0xa5,0x52,0x55,0xd2,0xca,0xd2,0x4a,0x92,0x92,0x92,0x92,0x25,0xc9,0xaa,0x4a,
    0x55,0xa5,0x92,0x2a,0xaa,0x95,0xca,0x2a,0xa9,0x29,0xca,0x92,0x25,0xd5,0xca,0xd2,
    0x2a,0x92,0xc9,0x92,0xc9,0x52,0x52,0xd5,0x92,0xd2,0xd2,0x4a,0xca,0xd2,0x92,0xc9,
    0xaa,0x95,0x92,0x29,0xca,0xd2,0x92,0x55,0xca,0xaa,0x95,0xca,0xaa,0xc9,0x92,0x92,
    0x4a,0x29,0xaa,0x95,0x92,0x92,0xa9,0x25,0x92,0x92,0x92,0x52,0x95,0x52,0x29,0xca,
    0xd2,0x92,0xa5,0x29,0xaa,0x29,0x92,0x4a,0x55,0x55,0xa9,0xca,0xaa,0x95,0x92,0x2a,
    0xd2,0x4a,0x52,0x2a,0x49,0xd5,0x52,0x92,0xca,0x92,0x92,0x52,0xc9,0xca,0xd2,0x2a,
    0x52,0x92,0xca,0x2a,0x49,0x92,0x2a,0xaa,0xc9,0xca,0x92,0x95,0xca,0x92,0x92,0x92,
    0x92,0x4a,0xca,0x52,0x29,0xc9,0x92,0x92,0x49,0x29,0xaa,0xd5,0x92,0x52,0x25,0x2a,
    0x92,0x92,0x92,0x92,0x95,0x52,0x29,0x25,0x2a,0xd2,0x2a,0x49,0x55,0xd2,0x92,0x2a,
    0xc9,0xca,0x2a,0x52,0x52,0x25,0x92,0xc9,0x92,0xca,0x92,0xd2,0xca,0xd2,0x52,0xd5,
    0x92,0x92,0xca,0xd2,0xd2,0x52,0xd5,0x92,0xd5,0xca,0x92,0x92,0x55,0x25,0xd2,0x2a,
    0x49,0x55,0xd2,0x52,0x95,0x52,0x52,0xd5,0x92,0x55,0x49,0x4a,0xca,0xca,0x92,0x92,
    0x92,0x92,0xaa,0x25,0xaa,0xca,0x92,0x92,0x92,0x92,0x92,0x92,0x92,0x92,0x92,0x92,
    0x92,0x92,0x92,0x92,0x92,0x92,0x92,0x92,0x92,0x92,0x92,0x92,0x92,0xd2,0x92,0x92,
    0x92,0x92,0x92,0x92,0x92,0x92,0x92,0x92,0x92,0xc9,0x92,0x92,0x92,0x92,0x92,0x92,
    0x92,0x92,0x92,0x92,0x92,0xd2,0x92,0x92,0x92,0x92,0x92,0xaa,0x55,0x55,0xd5,0x52,
    0x55,0x55,0xc9,0xd2,0x92,0x92,0x92,0x55,0x92,0x92,0x92,0x92,0x92,0x92,0x92,0x92,
    0x92,0x92,0x92,0x92,0x92,0x92,0xd2,0x92,0x92,0x92,0x92,0x92,0x92,0x92,0x92,0x92,
    0x92,0xc9,0x92,0x92,0x92,0x92,0x92,0x92,0x92,0x92,0x92,0xca,0x92,0x92,0x92,0x92,
    0x92,0x92,0x92,0x92,0x92,0xd2,0x92,0x95,0x92,0x92,0x92,0x92,0x92,0x92,0x92,0x92,
    0x92,0x52,0x2a,0x29,0x92,0x92,0x92,0x92,0x92,0x92,0x92,0x95,0x29,0x92,0x92,0x92,
    0x92,0x92,0x92,0x92,0x92,0xa5,0x2a,0x92,0x92,0x92,0x92,0x92,0x92,0x92,0x92,0x29,
    0x29,0x25,0x95,0xa5,0x52,0x92,0x92,0xd2,0x92,0x49,0x92,0x92,0x92,0x92,0x92,0x92,
    0x92,0x92,0x92,0x2a,0x92,0x92,0x92,0x92,0x92,0x92,0x92,0x92,0x92,0x52,0x92,0x92,
    0x92,0x92,0x92,0x92,0x92,0x92,0x92,0xd2,0x2a,0x92,0x92,0x92,0x92,0x92,0x92,0x92,
    0x92,0xc9,0x92,0x92,0x92,0x92,0x92,0x92,0x92,0x92,0x92,0xd2,0x4a,0x49,0x25,0x2a,
    0xd2,0x92,0x4a,0x2a,0x92,0xa5,0x92,0x49,0xc9,0x92,0x92,0x92,0x92,0x92,0xfe
];

var timingPulses = new Array(3110).fill(0xF9);

var txData = new Uint8Array(txHandshake.length+microBootLoader.length+timingPulses.length);
txData.set(txHandshake, 0);
txData.set(microBootLoader, txHandshake.length);
txData.set(timingPulses, txHandshake.length+microBootLoader.length);

//Add programming receive handler
chrome.serial.onReceive.addListener(hearFromProp);

/***********************************************************
 *                 Serial Support Functions                *
 ***********************************************************/

//TODO Consider returning error object
function openPort(portPath, baudrate) {
//Open serial port at portPath with baudrate.
//baudrate is optional; defaults to initialBaudrate
    return new Promise(function(resolve, reject) {
        console.log("Attempting to open port");
        portBaudrate = baudrate ? parseInt(baudrate) : initialBaudrate;
        chrome.serial.connect(portPath, {
                'bitrate': portBaudrate,
                'dataBits': 'eight',
                'parityBit': 'no',
                'stopBits': 'one',
                'ctsFlowControl': false
            },
            function (openInfo) {
                if (openInfo === undefined) {
                    console.log("Could not open port %s", portPath);
                } else {
                    portID = openInfo.connectionId;
                    console.log("Port", portPath, "open with ID", portID);
                    resolve(portID);
//TODO Determine why portID (openInfo.connectionId) always increases per OS session and not just per app session.  Is that a problem?  Are we not cleaning up something that should be addressed?
                }
            }
        );
    });
}

//TODO Consider returning error object
function closePort() {
    isOpen()
        .then(function() {
            chrome.serial.disconnect(portID,
                function (closeResult) {
                    if (closeResult === true) {
                        portID = -1;
                        console.log("Port closed");
                    } else {
                        console.log("Port not closed");
                    }
                });
        });
}

function isOpen() {
    return new Promise(function(resolve, reject) {
        portID >= 0 ? resolve() : reject()
    });
}

function changeBaudrate(baudrate) {
//Change port's baudrate.
//baudrate is optional (defaults to finalBaudrate)

//    return Promise.resolve(function() {console.log("Changing baudrate to " + portBaudrate)});

    return new Promise(function(resolve, reject) {
        portBaudrate = baudrate ? parseInt(baudrate) : finalBaudrate;
        console.log("Changing baudrate to " + portBaudrate);
        chrome.serial.update(portID, {'bitrate': portBaudrate}, function(updateResult) {
            updateResult ? resolve() : reject(Error("Can not set baudrate: " + baudrate));
        });
        resolve();
    });

}

//TODO determine if there's a better way to promisify callbacks (with boolean results)
//TODO return error object
function setControl(options) {
    return new Promise(function(resolve, reject) {
        chrome.serial.setControlSignals(portID, options, function(controlResult) {
            controlResult ? resolve() : reject(Error("Can not set " + options))
        });
    });
}

//TODO return error object
function flush() {
// Empty transmit and receive buffers
    return new Promise(function(resolve, reject) {
        chrome.serial.flush(portID, function(flushResult) {
            flushResult ? resolve() : reject(Error("Can not flush transmit/receive buffer"))
        });
    });
}

//TODO Check send callback
//TODO Consider returning error object
function send(data) {
// Transmit data
    // Convert data from string or buffer to an ArrayBuffer
    if (typeof data === 'string') {
        data = str2ab(data);
    } else {
        if (data instanceof ArrayBuffer === false) {data = buffer2ArrayBuffer(data)}
    }
    return chrome.serial.send(portID, data, function (sendResult) {
    });
}

function buffer2ArrayBuffer(buffer) {
// Convert buffer to ArrayBuffer
    var buf = new ArrayBuffer(buffer.length);
    var bufView = new Uint8Array(buf);
    for (var i = 0; i < buffer.length; i++) {
        bufView[i] = buffer[i];
    }
    return buf;
}


/***********************************************************
 *             Propeller Programming Functions             *
 ***********************************************************/

//TODO Add error handling
//TODO Make identify/program optional
function talkToProp() {
// Transmit identifying (and optionally programming) stream to Propeller

    var deliveryTime = 400+((10*(txData.byteLength+20+8))/portBaudrate)*1000+1; //Calculate package delivery time
                                                                                //300 [>max post-reset-delay] + ((10 [bits per byte] * (data bytes [transmitting] + silence bytes [MBL waiting] + MBL "ready" bytes [MBL responding]))/baud rate) * 1,000 [to scale ms to integer] + 1 [to round up]
    function resetPropComm() {
    // Reset propComm object to initial values
        Object.assign(propComm, propCommStart);
        return Promise.resolve();
    }

    function chain(func) {
        return Promise.resolve(func());
    }

    isOpen()
        .then(chain(function() {console.log("talking to Propeller")})
        .then(resetPropComm()                                                   //Reset propComm object
        .then(setControl({dtr: false})                                          //Start Propeller Reset Signal
        .then(flush()                                                           //Flush transmit/receive buffers (during Propeller reset)
        .then(setControl({dtr: true})                                           //End Propeller Reset
        .then(chain(function() {setTimeout(function() {send(txData)}, 100)})    //After Post-Reset-Delay, send package: Calibration Pulses+Handshake through Micro Boot Loader application+RAM Checksum Polls
        .then(isLoaderReady(1, deliveryTime)                                    //Verify package accepted
        .then(function() {console.log("Finished isLoaderReady?")})
//        .then(changeBaudrate()                                                //Bump up to faster finalBaudrate
        .then(function() {console.log("Found Propeller!")})
        .catch(function(e) {console.log("Error: %s", e.message)})
        .then(function() {console.log("done talking to Propeller")})
        )))))));

//    isMicroBootLoaderReady(2000).then(function(m){console.log("resolved", m)}, function(e){console.log("rejected", e.message)});
}

function hearFromProp(info) {
// Receive Propeller's responses during programming.  Parse responses from expected stages for validation.
    console.log("Received", info.data.byteLength, "bytes =", ab2num(info.data));
    // Exit immediately if we're not programming
    if (propComm.stage === sgIdle) {
        console.log("...ignoring");
        return
    }

    var stream = ab2num(info.data);
    var sIdx = 0;

    // Validate rxHandshake
    if (propComm.stage === sgHandshake) {
        while (sIdx < stream.length && propComm.rxCount < rxHandshake.length) {
            //More data to match against rxHandshake...
            if (stream[sIdx++] === rxHandshake[propComm.rxCount++]) {
                //Handshake matches so far...
                if (propComm.rxCount === rxHandshake.length) {
                    //Entire handshake matches!  Note valid and prep for next stage
                    propComm.handshake = stValid;
                    propComm.rxCount = 0;
                    propComm.stage = sgVersion;
                    break;
                }
            } else {
                //Handshake failure!  Ignore the rest
                propComm.handshake = stInvalid;
                propComm.stage = sgIdle;
                break;
            }
        }
    }

    // Extract Propeller version
    if (propComm.stage === sgVersion) {
        while (sIdx < stream.length && propComm.rxCount < 4) {
            //More data to decode into Propeller version (4 bytes, 2 data bits per byte)
            propComm.version = (propComm.version >> 2 & 0x3F) | ((stream[sIdx] & 0x01) << 6) | ((stream[sIdx] & 0x20) << 2);
            sIdx++;
            if (++propComm.rxCount === 4) {
                //Received all 4 bytes
                if (propComm.version === 1) {
                    //Version matches expected value!  Prep for next stage
                    propComm.rxCount = 0;
                    propComm.stage = sgRAMChecksum;
                } else {
                    //Unexpected version!  Ignore the rest
                    propComm.stage = sgIdle;
                }
                break;
            }
        }
    }

    // Receive RAM Checksum
    if (propComm.stage === sgRAMChecksum && sIdx < stream.length) {
        //Received RAM Checksum response?
        propComm.ramCheck = stream[sIdx++] === 0xFE ? stValid : stInvalid;
        //Set next stage according to result
        propComm.rxCount = 0;
        propComm.stage = propComm.ramCheck ? sgMBLResponse : sgIdle;
    }

    // Receive Micro Boot Loader's "Ready" Signal
    if (propComm.stage === sgMBLResponse) {
        while (sIdx < stream.length && propComm.rxCount < propComm.mblRespBuf.byteLength) {
            propComm.mblRespBuf[propComm.rxCount++] = stream[sIdx++];
            //Finish stage when expected response size received
            if (propComm.rxCount === propComm.mblRespBuf.byteLength) {
                propComm.stage = sgIdle;
                //Valid if end of stream, otherwise something's wrong (invalid response)
                propComm.mblResponse = stream.length === sIdx ? stValid : stInvalid;
            }
        }
    }
}

function isLoaderReady(packetId, waittime) {
/* Is Micro Boot Loader delivered and Ready?
   Return a promise that waits for waittime then validates the responding Propeller Handshake, Version, and that the Micro Boot Loader delivery succeeded.
   Micro Boot Loader must respond with packetId for success (resolve).
   Rejects if any error occurs.
   Error is "Propeller not found" unless handshake received (and proper) and version received; error is more specific thereafter.*/

    return new Promise(function(resolve, reject) {

        function verifier() {
            console.log("Checking loader package delivery");
            //Check handshake and version
            if (propComm.handshake === stValidating || propComm.handshake === stInvalid || propComm.version === stValidating) {reject(Error("Propeller not found."))}
            //Check for proper version
            if (propComm.version !== 1) {reject(Error("Found Propeller version " + propComm.version + " - expected version 1."))}
            //Check RAM checksum
            if (propComm.ramCheck === stValidating) {reject(Error("Propeller communication lost waiting for RAM Checksum."))}
            if (propComm.ramCheck === stInvalid) {reject(Error("RAM checksum failure."))}
            //Check Micro Boot Loader Ready Signal
            if (propComm.mblResponse !== stValid || propComm.mblPacketId[0] !== packetId) {reject(Error("Micro Boot Loader failed."))}
            console.log("Done checking delivery");
            resolve();
        }
        console.log("Waiting %d ms for Micro Boot Loader delivery", waittime);
        setTimeout(verifier, waittime);
    });
}

function timedPromise(promise, timeout){
// Takes in a promise and returns it as a promise that rejects in timeout milliseconds if not resolved beforehand
    var expired = function() {
        return new Promise(function (resolve, reject) {
            var id = setTimeout(function() {
                console.log("Timed out!");
                clearTimeout(id);
                reject(Error('Timed out in ' + timeout + ' ms.'));
            }, timeout);
        })
    };
    // Returns a promise race between passed-in promise and timeout promise
    return Promise.race([promise(), expired()])
}