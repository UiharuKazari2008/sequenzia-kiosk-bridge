const fs = require("fs");
const express = require("express");
const webreq = require('request');
const WebSocket = require('ws');
const app = express();
const wss = new WebSocket.Server({ port: 6834 });
const exec = require('child_process').exec;
const cors = require('cors');
const { SerialPort, ReadlineParser } = require('serialport');
const init_config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
const sleep = (waitTimeInMs) => new Promise(resolve => setTimeout(resolve, waitTimeInMs));

log = function(msg) {
    fs.appendFile("./log.txt", `LOG : ${msg}\n`, function(err) {
        if(err) {
            return trueLog(err);
        }
    });
}

error = function(msg) {
    fs.appendFile("./log.txt", `ERROR : ${msg}\n`, function(err) {
        if(err) {
            return trueLog(err);
        }
    });
}

app.use(cors());

app.get('/get_config', (req,res) => {
    log(`Sequenzia requested boot configuration`);
    const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
    res.json(config.actions.map(a => {
        let r = {
            ...a
        }
        delete r.command;
        return r;
    }))
})
app.get('/get_config2', (req,res) => {
    log(`Sequenzia requested boot configuration`);
    const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
    res.json({
        display_config: config.display_config,
        padding: config.padding,
        buttons: config.actions.map(a => {
            let r = {
                ...a
            }
            delete r.command;
            return r;
        }),
        applications: config.applications.map(a => {
            let r = {
                ...a
            }
            delete r.command;
            return r;
        })
    })
})
app.get('/get_special_menu/chun', (req,res) => {
    log(`Sequenzia requested Chunithm Menu configuration`);
    const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
    if (config.touch_menus) {
        res.json(config.touch_menus)
    } else {
        res.status(404).end();
    }
})
app.get('/action/:id', (req, res) => {
    const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
    const action = config.actions.filter(e => e.id === req.params.id)[0]
    if (action && action.wsc) {
        Object.values(WSClients).forEach(ws => ws.send(JSON.stringify({
            location: action.location,
            menu: action.menu,
            item: action.item,
            undo: action.undo
        })));
        res.send("OK");
    } else if (action) {
        exec(action.command, (e, stdout, stderr) => {
            if (e) {
                error(`Error executing command '${action.command}': ${e.message}`);
                res.status(500).send('Command execution failed');
            } else {
                log(`Command '${action.command}' executed successfully`);
                res.send(stdout);
                if (init_config.serialPort && action.display_message) {
                    let _request = "DISPLAY_MESSAGE::";
                    if (action.display_message.icon) {
                        _request += action.display_message.icon;
                    } else {
                        _request += "120";
                    }
                    _request += "::";
                    if (action.display_message.text) {
                        _request += action.display_message.text;
                    } else {
                        _request += "SET TEXT";
                    }
                    _request += "::";
                    _request += ((action.display_message.japanese) ? 0 : 1);
                    _request += "::";
                    if (action.display_message.brightness) {
                        _request += action.display_message.brightness;
                    } else {
                        _request += 255;
                    }
                    _request += "::";
                    _request += ((action.display_message.invert) ? 0 : 1);
                    _request += "::";
                    if (action.display_message.timeout) {
                        _request += action.display_message.timeout;
                    } else {
                        _request += 5;
                    }
                    _request += "::";
                    _request += ((action.display_message.is_small) ? 2 : 1);
                    _request += "::";
                    log(_request);
                    request = _request;
                }
            }
        });
    } else {
        res.status(404).send('Action does not exist');
    }
})
app.get('/io3/:action', (req, res) => {
    if (io3Port) {
        switch (req.params.action) {
            case 'TEST':
            case 'SERVICE':
            case 'CREDIT':
            case 'START':
            case 'CARD':
                io3Port.write(`${req.params.action.toUpperCase()}\n`);
                res.status(200).send('OK');
                break;
            default:
                res.status(404).send('Unknown GPIO Action');
                break;
        }
    } else {
        res.status(500).send('IO3 Not Available');
    }
})
app.get('/led_data', (req, res) => {
    if (req.query.bankSelect && req.query.bankSelect === "10") {
        if (init_config.io3SerialPort) {
            //  LED_DATA::brightness::time::hex_data::animate::
            let _request = "LED_DATA"
            if (req.query.full_stream) {
                _request += "_FULL"
            }
            _request += "::"
            if (req.query.ledBrightness && !isNaN(parseInt(req.query.ledBrightness.toString()))) {
                _request += req.query.ledBrightness.toString() + "::";
            } else {
                _request += "-1::";
            }
            if (req.query.transition_time && !isNaN(parseInt(req.query.transition_time.toString()))) {
                _request += req.query.transition_time.toString() + "::";
            } else {
                _request += "-1::";
            }
            if (req.query.ledValues) {
                _request += req.query.ledValues + "::";
                if (req.query.ani_start) {
                    _request += "1::";
                } else {
                    _request += "-1::";
                }

                log("JVS LED Data: " + _request.toString().trim());
                io3Port.write(`${_request.toString().trim()}\n`);
                res.status(200).send("OK");
            } else if (req.query.ledColor) {
                _request += req.query.ledColor + "::";
                if (req.query.ani_start) {
                    _request += "1::";
                } else {
                    _request += "-1::";
                }
                log("JVS LED Data: " + _request.toString().trim());
                io3Port.write(`${_request.toString().trim()}\n`);
                res.status(200).send("OK");
            } else {
                res.status(400).send("Missing Data");
            }
        } else {
            res.status(500).send('Serial Port Not Available');
        }
    } else if (init_config.serialPort) {
        //  LED_DATA::bank_id::brightness::time::take_own::is_stream::hex_data::
        let _request = "LED_DATA::"
        if (req.query.bankSelect) {
            _request += req.query.bankSelect + "::";
        } else {
            _request += "0::";
        }
        if (req.query.ledBrightness && !isNaN(parseInt(req.query.ledBrightness.toString()))) {
            _request += req.query.ledBrightness.toString() + "::";
        } else {
            _request += "-1::";
        }
        if (req.query.transition_time && !isNaN(parseInt(req.query.transition_time.toString()))) {
            _request += req.query.transition_time.toString() + "::";
        } else {
            _request += "-1::";
        }
        if (req.query.takeOwnership && req.query.takeOwnership === "true") {
            _request += "1::";
        } else {
            _request += "0::";
        }
        if (req.query.ledValues) {
            _request += "1::" + req.query.ledValues + "::";
            request = _request;
            log("HCM LED Data: " + _request.toString().trim());
            res.status(200).send("OK");
        } else if (req.query.ledColor) {
            _request += "0::" + req.query.ledColor + "::";
            request = _request;
            log("HCM LED Data: " + _request.toString().trim());
            res.status(200).send("OK");
        } else {
            res.status(400).send("Missing Data");
        }
    } else {
        res.status(500).send('Serial Port Not Available');
    }
})

function percentageToDecibel(percentage, _min, _max) {
    const minDb = _min || -80;
    const maxDb = _max || 0;
    percentage = Math.min(100, Math.max(0, percentage));
    return minDb + (percentage / 100) * (maxDb - minDb);
}
function decibelToPercentage(dbValue, _min, _max) {
    const minDb = _min || -80;
    const maxDb = _max || 0;
    dbValue = Math.min(0, Math.max(minDb, dbValue));
    return ((dbValue - minDb) / (maxDb - minDb)) * 100;
}
app.get('/volume/gain', (req, res) => {
    const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
    const volume_controls = config.volume_controls
    if (volume_controls) {
        if (req.query && req.query.set) {
            exec(`vmcli.exe ${volume_controls.row}.Gain=${percentageToDecibel(parseInt(req.query.set), volume_controls.min || -80, volume_controls.max || 0)}`, (e, stdout, stderr) => {
                if (e) {
                    error(`Error executing setting gain: ${e.message}`);
                    res.status(500).send('Command execution failed');
                } else {
                    res.status(200).send(req.query.set);
                }
            });
        } else {
            exec(`vmcli.exe ${volume_controls.row}.Gain`, (e, stdout, stderr) => {
                if (e) {
                    error(`Error executing getting current gain: ${e.message}`);
                    res.status(500).send('Command execution failed');
                } else {
                    res.status(200).send(decibelToPercentage(stdout.split("=").pop(), volume_controls.min || -80, volume_controls.max || 0).toFixed().toString());
                }
            });
        }
    } else {
        res.status(500).send('Volume control not configured');
    }
})
app.get('/volume/mute', (req, res) => {
    const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
    const volume_controls = config.volume_controls
    if (volume_controls) {
        if (req.query && req.query.set) {
            exec(`vmcli.exe ${volume_controls.row}.Mute=${req.query.set}`, (e, stdout, stderr) => {
                if (e) {
                    error(`Error executing setting mute: ${e.message}`);
                    res.status(500).send('Command execution failed');
                } else {
                    res.status(200).send(req.query.set);
                }
            });
        } else {
            exec(`vmcli.exe ${volume_controls.row}.Mute`, (e, stdout, stderr) => {
                if (e) {
                    error(`Error executing getting current mute: ${e.message}`);
                    res.status(500).send('Command execution failed');
                } else {
                    res.status(200).send((stdout.split("=").pop().split('.')[0] === "0") ? "1" : "0");
                }
            });
        }
    } else {
        res.status(500).send('Volume control not configured');
    }
})

let request = null;
let response = null;
app.get('/mcu_link/:command', async (req,res) => {
    const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
    if (config.mcu_commands) {
        if (request === null) {
            const command = config.mcu_commands.filter(e => e.id === req.params.command);
            if (command.length > 0 && command[0].cmd) {
                let _request = `${command[0].cmd}`;
                if (req.query.options) {
                    _request += "::";
                    if (typeof req.query.options === "string") {
                        _request += req.query.options
                    } else {
                        _request += req.query.options.join("::");
                    }
                } else if (command[0].options) {
                    _request += "::";
                    if (typeof command[0].options === "string") {
                        _request += command[0].options
                    } else {
                        _request += command[0].options.join("::");
                    }
                }
                _request += "::";
                request = _request;
                if (command.length > 0 && command[0].return === true) {
                    let i = 0;
                    while (i <= 501) {
                        await sleep(10).then(() => {
                            log(`Waiting for response...`)
                            if (response !== null) {
                                res.status((response === "FAIL - NO RESPONSE FROM MCU!") ? 500 : 200).send(response.join(' '));
                                response = null;
                                i = 5000;
                            } else if (i >= 500) {
                                //res.status(500).send("Comm Timeout");
                                response = "FAIL - NO RESPONSE FROM MCU!";
                            } else {
                                i++
                            }
                        })
                    }
                } else {
                    res.status(200).send("OK");
                }
            } else {
                res.status(400).send("Not Configured");
            }
        } else {
            res.status(501).send("Request Busy");
        }
    } else {
        res.status(500).send("Not Configured");
    }
})
app.listen(6833, () => {
    log(`Server listening on port 6833`);
});

let WSClients = {};
let WSActiveClient = null;
wss.on('connection', (ws) => {
    log('Client connected');
    const id = Date.now();
    // Send a welcome message to the client
    ws.send(JSON.stringify({init: true, error: false}));
    WSClients[id] = ws;
    WSActiveClient = id;
    ws.on('message', async (message) => {
        log(`Sequenzia Message: ${message.toString()}`);
        try {
            const data = JSON.parse(message.toString());
            const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
            if (data.type) {
                switch (data.type) {
                    case 'mcu_link':
                        if (config.mcu_commands) {
                            if (request === null) {
                                const command = config.mcu_commands.filter(e => e.id === data.command);
                                if (command.length > 0 && command[0].cmd) {
                                    let _request = `${command[0].cmd}`;
                                    if (data.options) {
                                        _request += "::";
                                        if (typeof data.options === "string") {
                                            _request += data.options
                                        } else {
                                            _request += data.options.join("::");
                                        }
                                    } else if (command[0].options) {
                                        _request += "::";
                                        if (typeof command[0].options === "string") {
                                            _request += command[0].options
                                        } else {
                                            _request += command[0].options.join("::");
                                        }
                                    }
                                    _request += "::";
                                    request = _request;
                                    if (command.length > 0 && command[0].return === true) {
                                        let i = 0;
                                        while (i <= 501) {
                                            await sleep(10).then(() => {
                                                log(`Waiting for response...`)
                                                if (response !== null) {
                                                    ws.send(JSON.stringify({error: (response === "FAIL - NO RESPONSE FROM MCU!"), data: response.join(' ')}));
                                                    response = null;
                                                    i = 5000;
                                                } else if (i >= 500) {
                                                    response = "FAIL - NO RESPONSE FROM MCU!";
                                                } else {
                                                    i++
                                                }
                                            })
                                        }
                                    } else {
                                        ws.send(JSON.stringify({error: false, ok: true}));
                                    }
                                } else {
                                    ws.send(JSON.stringify({error: true, reason: `Not Configured`}));
                                }
                            } else {
                                ws.send(JSON.stringify({error: true, reason: `Busy`}));
                            }
                        } else {
                            ws.send(JSON.stringify({error: true, reason: `Not Configured`}));
                        }
                        break;
                    case 'action':
                        const action = config.actions.filter(e => e.id === data.id)[0]
                        if (action) {
                            exec(action.command, (e, stdout, stderr) => {
                                if (e) {
                                    error(`Error executing command '${action.command}': ${e.message}`);
                                    ws.send(JSON.stringify({error: true, ok: false, reason: e.message}));

                                } else {
                                    log(`Command '${action.command}' executed successfully`);
                                    ws.send(JSON.stringify({error: false, ok: true, data: stdout}));
                                }
                            });
                        } else {
                            ws.send(JSON.stringify({error: true, reason: `Unknown Action`}));
                        }
                        break;
                    default:
                        ws.send(JSON.stringify({error: true, reason: `Unknown type`}));
                        break;
                }
            }
        } catch (e) {
            ws.send(JSON.stringify({error: true, reason: e.message}));
        }
    });
    ws.on('close', () => {
        delete WSClients[id];
    });
});

let audio_file = null;
let sleep_time = null;
let audio_active = false;
let pingTimeout = null;
let requestHibernate = null;
async function loopAudio() {
    if (audio_active === false) {
        audio_active = true;
        while (audio_file) {
            await new Promise((resolve) => {
                exec(`"C:\\Program Files\\VideoLAN\\VLC\\vlc.exe" ./audio_fx/${audio_file}.mp3 --play-and-exit --gain=0.25`, (e, stdout, stderr) => {
                    if (e) {
                        error(`Error executing audio: ${e.message}`);
                    }
                    resolve();
                });
            });
            if (sleep_time)
                await sleep(sleep_time)
        }
        audio_active = false;
    }
}
if (init_config.serialPort) {
    exec(`"C:\\Program Files\\VideoLAN\\VLC\\vlc.exe" ./audio_fx/boot.mp3 --play-and-exit --gain=0.25`, (e, stdout, stderr) => {
        if (e) {
            error(`Error executing audio: ${e.message}`);
        }
    });
    function initializeSerialPort() {
        const port = new SerialPort({path: init_config.serialPort || "COM50", baudRate: init_config.serialBaud || 115200});
        const parser = port.pipe(new ReadlineParser({delimiter: '\n'}));
        let pingTimer = setInterval(() => {
            port.write("PING::\n");
        }, 30000)
        let requestTimer = setInterval(() => {
            if (request !== null) {
                port.write('\n' + request + "\n");
                request = null;
            }
        }, 5)
        parser.on('data', async (data) => {
            const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
            let receivedData = data.toString().trim()
            if (receivedData.includes("::")) {
                receivedData = receivedData.split("::");
                if (receivedData[0] === "PROBE") {
                    switch (receivedData[1]) {
                        case "SEARCH":
                            port.write("PROBE::HELLO::Sequenzia Kiosk Bridge v3::\n");
                            log("MCU Boot Hello");
                            break;
                        default:
                            break;
                    }
                } else if (receivedData[0] === "R") {
                    if (receivedData[1] === 'PONG') {

                    } else {
                        response = receivedData.slice(1);
                        log("MCU Response: " + response);
                    }
                } else if (receivedData[0] === "DLPM" && config.dps_enable) {
                    try {
                        switch (receivedData[1]) {
                            case "ABORT":
                                clearInterval(pingTimeout);
                                pingTimeout = null;
                                clearInterval(requestHibernate);
                                requestHibernate = null;
                                await new Promise((ok => {
                                    exec(`shutdown /a`, (e) => {
                                        if (e) {
                                            error(`Error requesting to abort shutdown: ${e.message}`);
                                            ok(false);
                                            if (receivedData[1] === "ABORT") {
                                                port.write("DLPM::CANCEL::\n");
                                            }
                                        } else {
                                            log(`System is entering dynamic low power mode in 60 Seconds`);
                                            if (receivedData[1] === "ABORT") {
                                                port.write("DLPM::CANCEL::\n");
                                            }
                                            ok(true);
                                        }
                                    });
                                }));
                            case "POWER_OFF":
                                if (config.dps_power_off) {
                                    exec(`shutdown /s /f /t 5 /c "Dynamic Low Power Mode Requested"`, (e, stdout, stderr) => {
                                        if (e) {
                                            error(`Error requesting to shutdown: ${e.message}`);
                                        } else {
                                            log(`System is entering dynamic low power mode in 60 Seconds`);
                                            pingTimeout = setInterval(() => {
                                                port.write("DLPM::REQ_POWER_OFF::\n");
                                            }, 2000);
                                        }
                                    });
                                } else {
                                    pingTimeout = setInterval(() => {
                                        port.write("DLPM::REQ_POWER_OFF::\n");
                                    }, 1000);
                                    if (!requestHibernate) {
                                        requestHibernate = setTimeout(() => {
                                            exec(`shutdown /h`, (e, stdout, stderr) => {
                                                if (e) {
                                                    error(`Error requesting to shutdown: ${e.message}`);
                                                } else {
                                                    log(`System is entering dynamic low power mode`);
                                                    requestHibernate = null;
                                                    clearInterval(pingTimeout);
                                                    pingTimeout = null;
                                                }
                                            });
                                        }, 5000)
                                    }
                                }
                                break;
                            case "RESTART":
                                exec(`shutdown /r /f /t 5 /c "Host Restart Requested"`, (e, stdout, stderr) => {
                                    if (e) {
                                        error(`Error requesting to restart: ${e.message}`);
                                    } else {
                                        log(`System is entering dynamic low power mode in 60 Seconds`);
                                        pingTimeout = setInterval(() => {
                                            port.write("DLPM::REQ_REBOOT::\n");
                                        }, 2000);
                                    }
                                });
                                break;
                            default:
                                error(`Unknown DLPM Command '${receivedData[1]}'`);
                        }
                    } catch (e) {
                        error("Failed to request power off: " + e.message);
                    }
                } else if (receivedData[0] === "PS" && config.power_switch) {
                    try {
                        let command = "/lce/kongou/"
                        if (receivedData[1] === "0") {
                            command += "stop";
                        } else if (receivedData[1] === "1") {
                            command += "init";
                        } else if (receivedData[1] === "128") {
                            command += "restart";
                        }
                        webreq(`http://localhost:6799${command}`, async (error, response, body) => {
                            if (!error && response.statusCode === 200) {
                                const statusMessage = body.toString();
                                log(`ALLS Lifecycle Command '${command}': ${statusMessage}`);
                            } else if (error) {
                                log(`ALLS Lifecycle Command '${command}': ${error.message}`);
                            } else {
                                log(`ALLS Lifecycle Command '${command}': ${response.statusCode}`);
                            }
                        })
                    } catch (e) {
                        error("Failed to update disk selection: " + e.message);
                    }
                } else if (receivedData[0] === "DS" && config.disk_select) {
                    try {
                        log("MCU Requested Disk Select: " + receivedData[1]);
                        webreq(`http://localhost:6799/lce/kongou/pull_id`, async (error, response, body) => {
                            if (!error && response.statusCode === 200) {
                                const statusMessage = body.toString();
                                log("LCC Response: " + statusMessage);
                            }
                        })
                    } catch (e) {
                        error("Failed to update disk selection: " + e.message);
                    }
                } else if (receivedData[0] === "ACTION") {
                    const action = (config.actions.map(e => e.id)).indexOf(receivedData[1]);
                    if (action !== -1 && config.actions[action].wsc) {
                        log("MCU to WS Requested: " + receivedData[1]);
                        Object.values(WSClients).forEach(ws => ws.send(JSON.stringify({
                            location: config.actions[action].location,
                            menu: config.actions[action].menu,
                            item: config.actions[action].item,
                            undo: config.actions[action].undo
                        })));
                    } else if (action !== -1 && config.actions[action].io3) {
                        log("MCU to IO3 Requested: " + receivedData[1]);
                        if (io3Port) {
                            io3Port.write(`${config.actions[action].io3.toUpperCase()}\n`);
                        } else {
                            error("Not Configured");
                        }
                    } else if (action !== -1 && config.actions[action].mcu_link) {
                        log("MCU to MCU Requested: " + receivedData[1]);
                        if (config.mcu_commands) {
                            if (request === null) {
                                const command = config.mcu_commands.filter(e => e.id === config.actions[action].mcu_link);
                                if (command.length > 0 && command[0].cmd) {
                                    let _request = `${command[0].cmd}`;
                                    if (config.actions[action].mcu_link_options) {
                                        _request += "::";
                                        if (typeof config.actions[action].mcu_link_options === "string") {
                                            _request += config.actions[action].mcu_link_options
                                        } else {
                                            _request += config.actions[action].mcu_link_options.join("::");
                                        }
                                    } else if (command[0].options) {
                                        _request += "::";
                                        if (typeof command[0].options === "string") {
                                            _request += command[0].options
                                        } else {
                                            _request += command[0].options.join("::");
                                        }
                                    }
                                    _request += "::";
                                    request = _request;
                                    if (command.length > 0 && command[0].return === true) {
                                        let i = 0;
                                        while (i <= 501) {
                                            await sleep(10).then(() => {
                                                log(`Waiting for response...`)
                                                if (response !== null) {
                                                    log(response.join(' '));
                                                    response = null;
                                                    i = 5000;
                                                } else if (i >= 500) {
                                                    error("FAIL - NO RESPONSE FROM MCU!");
                                                } else {
                                                    i++
                                                }
                                            })
                                        }
                                    }
                                } else {
                                    error("Not Configured");
                                }
                            } else {
                                error("MCU Busy");
                            }
                        } else {
                            error("MCU Link Request Unknown");
                        }
                    } else if (action !== -1) {
                        log("MCU Requested: " + receivedData[1]);
                        let command = config.actions[action].command;
                        if (config.actions[action].accept_params && receivedData[2] !== undefined) {
                            command += ` ${receivedData[2]}`;
                        }
                        log(command);
                        exec(command, (e, stdout, stderr) => {
                            if (e) {
                                error(`Error executing command '${command}': ${e.message}`);
                            } else {
                                log(`Command '${command}' executed successfully`);
                            }
                        });
                    } else {
                        log("MCU Unknown Request: " + receivedData[1]);
                    }
                    if (action !== -1 && config.actions[action].display_message) {
                        let _request = "DISPLAY_MESSAGE::";
                        if (config.actions[action].display_message.icon) {
                            _request += config.actions[action].display_message.icon;
                        } else {
                            _request += "120";
                        }
                        _request += "::";
                        if (config.actions[action].display_message.text) {
                            _request += config.actions[action].display_message.text;
                        } else {
                            _request += "SET TEXT";
                        }
                        _request += "::";
                        _request += ((config.actions[action].display_message.japanese) ? 0 : 1);
                        _request += "::";
                        if (config.actions[action].display_message.brightness) {
                            _request += config.actions[action].display_message.brightness;
                        } else {
                            _request += 255;
                        }
                        _request += "::";
                        _request += ((config.actions[action].display_message.invert) ? 1 : 0);
                        _request += "::";
                        if (config.actions[action].display_message.timeout) {
                            _request += config.actions[action].display_message.timeout;
                        } else {
                            _request += 5;
                        }
                        _request += "::";
                        _request += ((config.actions[action].display_message.is_small) ? 2 : 1);
                        _request += "::";
                        log(_request);
                        request = _request;
                    }
                } else if (receivedData[0] === "AUDIO_PLAY") {
                    switch (receivedData[1]) {
                        case "GAME_START":
                            audio_file = null;
                            sleep_time = null;
                            exec(`"C:\\Program Files\\VideoLAN\\VLC\\vlc.exe" ./audio_fx/boot.mp3 --play-and-exit --gain=0.25`, (e, stdout, stderr) => {
                                if (e) {
                                    error(`Error executing audio: ${e.message}`);
                                }
                            });
                            break;
                        case "GAME_OFF":
                            audio_file = null;
                            sleep_time = null;
                            exec(`"C:\\Program Files\\VideoLAN\\VLC\\vlc.exe" ./audio_fx/shutdown.mp3 --play-and-exit --gain=0.25`, (e, stdout, stderr) => {
                                if (e) {
                                    error(`Error executing audio: ${e.message}`);
                                }
                            });
                            break;
                        case "SHUTDOWN":
                            if (receivedData.length > 2) {
                                audio_file = "warning";
                                sleep_time = parseInt(receivedData[2]);
                            } else {
                                audio_file = "warning_long";
                                sleep_time = null;
                            }
                            loopAudio();
                            break;
                        case "STOP":
                            audio_file = null;
                            sleep_time = null;
                            break;
                        default:
                            error("MCU Requested Unkown Audio FX: " + receivedData[1]);
                            break;
                    }
                } else if (receivedData[0] === "GPIO" && io3Port !== false) {
                    log("GPIO Request: " + receivedData[1])
                    io3Port.write(`GPIO::${receivedData[1]}::\n`);
                } else if (receivedData[0] === "LED_DATA" && io3Port !== false) {
                    log("JVS LED Data: " + data.toString().trim())
                    io3Port.write(`${data.toString().trim()}\n`);
                }
            }
        });
        port.on('error', (err) => {
            error(`Serial port error: ${err.message}`);
            clearInterval(pingTimer);
            clearInterval(requestTimer);
            setTimeout(initializeSerialPort, 5000); // Retry after 5 seconds
        });
        port.on('close', (err) => {
            clearInterval(pingTimer);
            clearInterval(requestTimer);
            setTimeout(initializeSerialPort, 1000); // Retry after 5 seconds
        });

        // Handle the opening of the serial port
        port.on('open', () => {
            log(`Listening to ${init_config.serialPort}...`);
        });
    }
    initializeSerialPort();
}
let io3Port = false;
if (init_config.io3SerialPort) {
    function initializeIO3SerialPort() {
        io3Port = new SerialPort({path: init_config.io3SerialPort || "COM51", baudRate: init_config.io3SerialBaud || 9600});
        const parser = io3Port.pipe(new ReadlineParser({delimiter: '\n'}));
        parser.on('data', (data) => {
            let receivedData = data.toString().trim()
            log("IO3 Message: " + receivedData);
        })
        io3Port.on('error', (err) => {
            io3Port = false;
            error(`IO3 Serial port error: ${err.message}`);
            setTimeout(initializeIO3SerialPort, 5000); // Retry after 5 seconds
        });
        io3Port.on('close', (err) => {
            io3Port = false;
            setTimeout(initializeIO3SerialPort, 1000); // Retry after 5 seconds
        });

        // Handle the opening of the serial port
        io3Port.on('open', () => {
            log(`IO3 Connected via ${init_config.io3SerialPort}`);
        });
    }
    initializeIO3SerialPort();
}
