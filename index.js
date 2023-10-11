const fs = require("fs");
const express = require("express");
const app = express();
const exec = require('child_process').exec;
const cors = require('cors');
const { SerialPort, ReadlineParser } = require('serialport');
const init_config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
const sleep = (waitTimeInMs) => new Promise(resolve => setTimeout(resolve, waitTimeInMs));

const trueLog = console.log;
/*console.log = function(msg) {
    fs.appendFile("./console.log", msg, function(err) {
        if(err) {
            return trueLog(err);
        }
    });
}
console.error = function(msg) {
    fs.appendFile("./error.log", msg, function(err) {
        if(err) {
            return trueLog(err);
        }
    });
}*/

app.use(cors());

app.get('/get_config', (req,res) => {
    console.log(`Sequenzia requested boot configuration`);
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
    console.log(`Sequenzia requested boot configuration`);
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
    console.log(`Sequenzia requested Chunithm Menu configuration`);
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
                console.error(`Error executing command '${action.command}': ${error.message}`);
                res.status(500).send('Command execution failed');

            } else {
                console.log(`Command '${action.command}' executed successfully`);
                res.send(stdout);
            }
        });
    } else {
        res.status(404).send('Action does not exist');
    }
})

function percentageToDecibel(percentage, minDb, maxDb) {
    percentage = Math.min(100, Math.max(0, percentage));
    const logValue = Math.log10(percentage / 100 + 1);
    return minDb + logValue * ((maxDb || 0) - (minDb || -80));
}
app.get('/volume/gain', (req, res) => {
    const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
    const volume_controls = config.volume_controls
    if (volume_controls) {
        if (req.query && req.query.set) {
            exec(`vmcli.exe ${volume_controls.row}.Gain=${percentageToDecibel(req.query.set, volume_controls.min || -80, volume_controls.max || 0)}`, (error, stdout, stderr) => {
                if (error) {
                    console.error(`Error executing setting gain: ${error.message}`);
                    res.status(500).send('Command execution failed');
                } else {
                    res.status(200).send(percentageToDecibel(stdout.split("=").pop(), volume_controls.min || -80, volume_controls.max || 0).toString());
                }
            });
        } else {
            exec(`vmcli.exe ${volume_controls.row}.Gain`, (error, stdout, stderr) => {
                if (error) {
                    console.error(`Error executing getting current gain: ${error.message}`);
                    res.status(500).send('Command execution failed');
                } else {
                    res.status(200).send(stdout.split("=").pop());
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
                    console.error(`Error executing setting mute: ${error.message}`);
                    res.status(500).send('Command execution failed');
                } else {
                    res.status(200).send(stdout.split("=").pop());
                }
            });
        } else {
            exec(`vmcli.exe ${volume_controls.row}.Mute`, (error, stdout, stderr) => {
                if (error) {
                    console.error(`Error executing getting current mute: ${error.message}`);
                    res.status(500).send('Command execution failed');
                } else {
                    res.status(200).send(stdout.split("=").pop());
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
                console.log(`_KIOSK_${command[0].cmd}_`)
                request = `_KIOSK_${command[0].cmd}_`;
                if (command.length > 0 && command[0].return === true) {
                    let i = 0;
                    while (i <= 6) {
                        await sleep(1000).then(() => {
                            console.log(`Waiting for response...`)
                            if (response !== null) {
                                res.status((response === "NO RESPONSE") ? 500 : 200).send(response);
                                response = null;
                                i = 50;
                            } else if (i >= 5) {
                                //res.status(500).send("Comm Timeout");
                                response = "NO RESPONSE";
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
    console.log(`Server listening on port 6833`);
});

if (init_config.serialPort) {
    function initializeSerialPort() {
        const port = new SerialPort({path: init_config.serialPort || "COM50", baudRate: init_config.serialBaud || 115200});
        const parser = port.pipe(new ReadlineParser({delimiter: '\n'}));
        let pingTimer = setInterval(() => {
            port.write("_KIOSK_PING _\n");
        }, 30000)
        let requestTimer = setInterval(() => {
            if (request !== null) {
                port.write('\n' + request);
                request = null;
            }
        }, 10)
        parser.on('data', (data) => {
            const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
            const receivedData = data.toString().trim();
            console.log(receivedData);
            if (receivedData === "_KIOSK_HELLO?_") {
                port.write("_KIOSK_READY_\n");
            } else if (receivedData.startsWith("_KIOSK_DATA_")) {
                let _res = receivedData;
                _res = _res.replace("_KIOSK_DATA_[", "");
                _res = _res.split("]_");
                _res.pop();
                _res = _res.join(']_');
                response = _res;
            } else {
                const action = (config.actions.map(e => `_KIOSK_` + e.id + '_')).indexOf(receivedData);

                // Check if the received data matches the desired string
                if (action !== -1) {
                    console.log(config.actions[action]);
                    exec(config.actions[action].command, (error, stdout, stderr) => {
                        if (error) {
                            console.error(`Error executing command '${config.actions[action].command}': ${error.message}`);
                        } else {
                            console.log(`Command '${config.actions[action].command}' executed successfully`);
                        }
                    });
                }
            }
        });
        port.on('error', (err) => {
            console.error(`Serial port error: ${err.message}`);
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
            console.log(`Listening to ${init_config.serialPort}...`);
        });
    }
    initializeSerialPort();
}
