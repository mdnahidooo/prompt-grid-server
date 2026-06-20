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
        const rejectionCollection =db.collection("rejection-feedback")



        // ===============================
        // GET ALL USERS (ADMIN ONLY)
        // ===============================
        app.get("/api/admin/users", async (req, res) => {
            try {
                const users = await userCollection.find().toArray();

                const formattedUsers = users.map(u => ({
                    _id: u._id,
                    name: u.name,
                    email: u.email,
                    image: u.image,
                    role: u.role,
                    plan: u.plan,
                    createdAt: u.createdAt
                }));

                res.send(formattedUsers);
            } catch (err) {
                res.status(500).send({ error: "Failed to fetch users" });
            }
        });


        // ===============================
        // UPDATE USER ROLE / PLAN
        // ===============================
        app.patch("/api/admin/users/:id", async (req, res) => {
            try {
                const { id } = req.params;
                const { role, plan } = req.body;

                const updateDoc = {
                    ...(role && { role }),
                    ...(plan && { plan })
                };

                const result = await userCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: updateDoc }
                );

                res.send(result);
            } catch (err) {
                res.status(500).send({ error: "Failed to update user" });
            }
        });


        // ===============================
        // DELETE USER
        // ===============================
        app.delete("/api/admin/users/:id", async (req, res) => {
            try {
                const { id } = req.params;

                const result = await userCollection.deleteOne({
                    _id: new ObjectId(id)
                });

                res.send(result);
            } catch (err) {
                res.status(500).send({ error: "Failed to delete user" });
            }
        });


        app.get("/api/admin/prompts", async (req, res) => {
            try {
                const prompts = await promptCollection.find({}).toArray();

                // attach creator info manually (MongoDB join simulation)
                const enriched = await Promise.all(
                    prompts.map(async (prompt) => {
                        const creator = await userCollection.findOne({
                            _id: new ObjectId(prompt.creatorId),
                        });

                        return {
                            ...prompt,
                            creator: creator
                                ? {
                                    name: creator.name,
                                    email: creator.email,
                                    image: creator.image,
                                    role: creator.role,
                                    plan: creator.plan,
                                }
                                : null,
                        };
                    })
                );

                res.send(enriched);
            } catch (err) {
                res.status(500).send({ error: "Failed to fetch admin prompts" });
            }
        });


        app.patch("/api/admin/prompts/:id/status", async (req, res) => {
            try {
                const { id } = req.params;
                const { status, feedback } = req.body;

                const update = {
                    status,
                };

                if (status === "rejected") {
                    update.rejectionFeedback = feedback || "";
                }

                const result = await promptCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: update }
                );

                res.send(result);
            } catch (err) {
                res.status(500).send({ error: "Status update failed" });
            }
        });

        app.patch("/api/admin/prompts/:id/feature", async (req, res) => {
            try {
                const { id } = req.params;
                const { isFeatured } = req.body;

                const result = await promptCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { isFeatured } }
                );

                res.send(result);
            } catch (err) {
                res.status(500).send({ error: "Feature update failed" });
            }
        });





        // app.get("/api/rejection/:promptId", async (req, res) => {
        //     try {
        //         const { promptId } = req.params;

        //         // 🔥 VALIDATION (IMPORTANT)
        //         if (!ObjectId.isValid(promptId)) {
        //             return res.status(400).send({
        //                 error: "Invalid promptId"
        //             });
        //         }

        //         const feedback = await rejectionCollection.findOne({
        //             promptId: new ObjectId(promptId)
        //         });

        //         res.send(feedback || null);

        //     } catch (err) {
        //         console.error("Rejection fetch error:", err);
        //         res.status(500).send({ error: "Failed to fetch rejection feedback" });
        //     }
        // });


        app.get("/api/feedback/:promptId", async (req, res) => {
            try {
                const { promptId } = req.params;

                // validate id
                if (!ObjectId.isValid(promptId)) {
                    return res.status(400).json({
                        success: false,
                        error: "Invalid promptId"
                    });
                }

                // find rejection feedback for this prompt
                const feedback = await rejectionCollection.findOne({
                    promptId: new ObjectId(promptId)
                });

                // IMPORTANT: always return JSON
                return res.status(200).json({
                    success: true,
                    data: feedback || null
                });

            } catch (err) {
                console.error("Feedback fetch error:", err);

                return res.status(500).json({
                    success: false,
                    error: "Failed to fetch rejection feedback"
                });
            }
        });

        app.patch("/api/admin/prompts/:id/reject", async (req, res) => {
            try {
                const { id } = req.params;
                const { reason, adminId } = req.body;

                if (!reason || !adminId) {
                    return res.status(400).send({
                        error: "Reason and adminId required"
                    });
                }

                // 1. Update prompt status only
                const promptResult = await promptCollection.updateOne(
                    { _id: new ObjectId(id) },
                    {
                        $set: {
                            status: "rejected"
                        }
                    }
                );

                // 2. Store rejection feedback in NEW collection
                const rejectionResult = await rejectionCollection.insertOne({
                    promptId: new ObjectId(id),
                    adminId,
                    rejectionReason: reason,
                    createdAt: new Date()
                });

                res.send({
                    success: true,
                    promptResult,
                    rejectionResult
                });

            } catch (err) {
                console.error(err);
                res.status(500).send({ error: "Rejection failed" });
            }
        });


        // ---------------------------------


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