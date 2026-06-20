const dns = require("node:dns");
dns.setServers(["1.1.1.1", "1.0.0.1"]);

const express = require("express");
const dontenv = require("dotenv");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
// const { createRemoteJWKSet, jwtVerify } = require("jose-cjs");
dontenv.config();

const uri = process.env.MONGO_DB_URI;

const app = express();
const PORT = process.env.PORT || 5000;

app.use(
    cors({
        credentials: true,
        origin: [process.env.CLIENT_URL],
    }),
);
app.use(express.json());

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    },
});




async function run() {
    try {
        await client.connect();


        const db = client.db("PromptGrid");
        const userCollection = db.collection("user");
        const promptCollection = db.collection("prompts");





        app.get('/api/my-prompts', async (req, res) => {
            const query = {};
            if (req.query.creatorId) {
                query.creatorId = req.query.creatorId;
            }
            // Using find().toArray() to get all matching prompts
            const result = await promptCollection.find(query).toArray();
            res.send(result || []);
        });


        app.get('/api/my/prompts', async (req, res) => {
            const query = {};
            if (req.query.creatorId) {
                query.creatorId = req.query.creatorId;
            }
            const result = await promptCollection.findOne(query);

            res.send(result || {});
        })


        app.post("/api/prompts", async (req, res) => {
            const promptData = req.body;
            const newPromptData = {
                ...promptData,
                createdAt: new Date()
            }
            const result = await promptCollection.insertOne(newPromptData);

            res.json(result);
        });


        app.patch("/api/prompts/:promptId", async (req, res) => {
            const { promptId } = req.params;
            const updatedData = req.body;

            const result = await promptCollection.updateOne(
                { _id: new ObjectId(promptId) },
                { $set: updatedData }
            );

            res.json(result);
        });


        app.delete('/api/prompts/:promptId', async (req, res) => {
            const { promptId } = req.params;

            const result = await promptCollection.deleteOne({
                _id: new ObjectId(promptId),
            });

            res.send(result);
        });




        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log(
            "Pinged your deployment. You successfully connected to MongoDB!",
        );
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);

app.get("/", (req, res) => {
    res.send("Server is running fine!");
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});