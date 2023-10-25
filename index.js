const fs = require("fs");
const express = require("express");
const app = express();
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
    if (action) {
        exec(action.command, (error, stdout, stderr) => {
            if (error) {
                error(`Error executing command '${action.command}': ${error.message}`);
                res.status(500).send('Command execution failed');

            } else {
                log(`Command '${action.command}' executed successfully`);
                res.send(stdout);
            }
        });
    } else {
        res.status(404).send('Action does not exist');
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
            exec(`vmcli.exe ${volume_controls.row}.Gain=${percentageToDecibel(parseInt(req.query.set), volume_controls.min || -80, volume_controls.max || 0)}`, (error, stdout, stderr) => {
                if (error) {
                    error(`Error executing setting gain: ${error.message}`);
                    res.status(500).send('Command execution failed');
                } else {
                    res.status(200).send(req.query.set);
                }
            });
        } else {
            exec(`vmcli.exe ${volume_controls.row}.Gain`, (error, stdout, stderr) => {
                if (error) {
                    error(`Error executing getting current gain: ${error.message}`);
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
            exec(`vmcli.exe ${volume_controls.row}.Mute=${req.query.set}`, (error, stdout, stderr) => {
                if (error) {
                    error(`Error executing setting mute: ${error.message}`);
                    res.status(500).send('Command execution failed');
                } else {
                    res.status(200).send(req.query.set);
                }
            });
        } else {
            exec(`vmcli.exe ${volume_controls.row}.Mute`, (error, stdout, stderr) => {
                if (error) {
                    error(`Error executing getting current mute: ${error.message}`);
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

if (init_config.serialPort) {
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
        parser.on('data', (data) => {
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
                } else if (receivedData[0] === "ACTION") {
                    const action = (config.actions.map(e => e.id)).indexOf(receivedData[1]);
                    if (action !== -1) {
                        log("MCU Requested: " + receivedData[1]);
                        let command = config.actions[action].command;
                        if (config.actions[action].accept_params && receivedData[2] !== undefined) {
                            command += ` ${receivedData[2]}`;
                        }
                        log(command);
                        exec(command, (error, stdout, stderr) => {
                            if (error) {
                                error(`Error executing command '${command}': ${error.message}`);
                            } else {
                                log(`Command '${command}' executed successfully`);
                            }
                        });
                    } else {
                        log("MCU Unknown Request: " + receivedData[1]);
                    }
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
