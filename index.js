const fs = require("fs");
const express = require("express");
const app = express();
const exec = require('child_process').exec;
const cors = require('cors');
const { SerialPort, ReadlineParser } = require('serialport');
const init_config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
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
app.get('/action/:id', (req, res) => {
    const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
    const action = config.actions.filter(e => e.id === req.params.id)[0]
    if (action) {
        exec(action.command, (error, stdout, stderr) => {
            if (error) {
                console.error(`Error executing command '${action.command}': ${error.message}`);
                res.status(500).send('Command execution failed');
                return;
            }
            console.log(`Command '${action.command}' executed successfully`);
            res.send(stdout);
        });
    } else {
        res.status(404).send('Action does not exist');
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
            port.write("_KIOSK_PING_");
        }, 30000)
        parser.on('data', (data) => {
            const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
            const receivedData = data.toString().trim();
            if (receivedData === "_KIOSK_HELLO?_") {
                port.write("_KIOSK_READY_");
                port.close();
            } else {
                const action = (config.actions.map(e => `_KIOSK_` + e.id + '_')).indexOf(receivedData);

                // Check if the received data matches the desired string
                if (action !== -1) {
                    console.log(config.actions[action]);
                    exec(config.actions[action].command, (error, stdout, stderr) => {
                        if (error) {
                            console.error(`Error executing command '${config.actions[action].command}': ${error.message}`);
                            return;
                        }
                        console.log(`Command '${config.actions[action].command}' executed successfully`);
                    });
                }
            }
            console.log(receivedData);
        });
        port.on('error', (err) => {
            console.error(`Serial port error: ${err.message}`);
            clearInterval(pingTimer);
            setTimeout(initializeSerialPort, 5000); // Retry after 5 seconds
        });
        port.on('close', (err) => {
            clearInterval(pingTimer);
            setTimeout(initializeSerialPort, 1000); // Retry after 5 seconds
        });

        // Handle the opening of the serial port
        port.on('open', () => {
            console.log(`Listening to ${init_config.serialPort}...`);
        });
    }
    initializeSerialPort();
}
