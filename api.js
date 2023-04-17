const express = require('express');
const mongoose = require('mongoose');
const zookeeper = require('node-zookeeper-client');

const app = express();
const port = process.argv[3]
const uri = `mongodb://localhost:${process.argv[4]}/database`;

app.use(express.json());

// Mongo Configuration
const dataSchema = new mongoose.Schema({
    key: String,
    value: String
});

const Data = mongoose.model('Data', dataSchema);

// Zookeeper
const path = `/data/${process.argv[2]}`;
const client = zookeeper.createClient('localhost:8000,localhost:8001,localhost:8002');
var mongoNodes = [];

function listChildren(client, path) {
    client.getChildren(
        path,
        function (event) {
            console.log('Got watcher event: %s', event);
            listChildren(client, path);
        },
        function (error, children, stat) {
            if (error) {
                console.log(
                    'Failed to list children of %s due to: %s.',
                    path,
                    error
                );
                return;
            }

            console.log('Children of %s are: %j.', path, children);
            children.forEach(child => {
                getNodeData(client, `${path}/${child}`);
            })
        }
    );
}

function createNode(client, path, data) {
    client.exists(
        path,
        function (err, stat) {
            if (err) {
                console.log(err.stack);
                return;
            }

            if (stat) {
                console.log('Node Already exists. Deleting and recreating.');
                removeNode(client, path);
            }

            client.create(
                path,
                Buffer.from(data),
                zookeeper.CreateMode.EPHEMERAL,
                function (err, path) {
                    if (err) {
                        console.log(err.stack);
                        return;
                    }
                    console.log('Node: %s is successfully created.', path);
                }
            );

        }
    )


}

function getNodeData(client, path) {
    client.getData(
        path,
        function (err, data, stat) {
            if (err) {
                console.log(err.stack);
                return;
            }
            console.log('Got data: %s', data.toString('utf8'));
            mongoNodes.push(JSON.parse(data.toString('utf8')));
            // console.log(mongoNodes);
        }
    );
}

function removeNode(client, path) {
    client.remove(
        path,
        function (err) {
            if (err) {
                console.log(err.stack);
                return;
            }
            console.log('Node: %s is successfully removed.', path);
        }
    );
}

client.once('connected', async function () {
    console.log('Connected to ZooKeeper.');

    var nodeData = {
        "host": "localhost",
        "port": port,
        "name": process.argv[2]
    }
    //set watch on /data
    listChildren(client, "/data");

    // create the node
    createNode(client, path, JSON.stringify(nodeData));


});

client.connect();


// API Endpoints
app.get('/api', (req, res) => {
    Data.find({}, (err, data) => {
        if (err) {
            console.log(err);
        } else {
            res.send(data);
        }
    })
})

app.post('/api', (req, res) => {
    const data = new Data(req.body);
    data.save((err, data) => {
        if (err) {
            console.log(err);
        } else {
            res.send(data);
        }
    })
})

const start = async () => {
    try {
        await mongoose
            .connect(uri, {
                useNewUrlParser: true,
                useUnifiedTopology: true
            })
            .then(() => {
                console.log("Successfully connected to Mongo database");
            })
            .catch((error) => {
                console.log("database connection failed. exiting now...");
                console.error(error);
                process.exit(1);
            });
        const server = app.listen(port, () => {
            console.log(`Listening on port ${port}`);
        })

        process.on('SIGINT' || 'SIGTERM', () => {
            console.log('Closing http server.');
            server.close((err) => {
                console.log('Http server closed.');
                client.close();
                process.exit(err ? 1 : 0);
            });
        });
    }
    catch (err) {
        console.log(err);
    }
}

start();