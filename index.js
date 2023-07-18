const fs = require("fs");
const express = require("express");
const app = express();
const exec = require('child_process').exec;
const cors = require('cors');

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
