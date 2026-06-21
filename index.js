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
        const rejectionCollection = db.collection("rejection-feedback")
        const ratingCollection = db.collection("prompt-ratings")
        const bookmarkCollection = db.collection("prompt-bookmarks")
        const reportCollection = db.collection("prompt-reports");










        app.get("/api/prompts/featured", async (req, res) => {
            try {

                const prompts = await promptCollection
                    .find({ status: "approved" })
                    .sort({ isFeatured: -1, createdAt: -1 })
                    .limit(6)
                    .toArray();

                const enriched = await Promise.all(
                    prompts.map(async (p) => {
                        const creator = await userCollection.findOne({
                            _id: new ObjectId(p.creatorId)
                        });

                        return {
                            ...p,
                            creator: creator
                                ? {
                                    name: creator.name,
                                    image: creator.image,
                                    email: creator.email
                                }
                                : null
                        };
                    })
                );

                res.send(enriched);

            } catch (err) {
                res.status(500).send({ error: "Failed" });
            }
        });


        // app.get("/api/prompts/:id", async (req, res) => {
        //     try {
        //         const { id } = req.params;

        //         if (!ObjectId.isValid(id)) {
        //             return res.status(400).json({ error: "Invalid prompt id" });
        //         }

        //         const prompt = await promptCollection.findOne({
        //             _id: new ObjectId(id)
        //         });

        //         if (!prompt) {
        //             return res.status(404).json({ error: "Prompt not found" });
        //         }

        //         // safer creator fetch
        //         let creator = null;

        //         if (prompt.creatorId && ObjectId.isValid(prompt.creatorId)) {
        //             const user = await userCollection.findOne({
        //                 _id: new ObjectId(prompt.creatorId)
        //             });

        //             if (user) {
        //                 creator = {
        //                     name: user.name || "Unknown",
        //                     email: user.email || "",
        //                     image: user.image || "",
        //                     plan: user.plan || "free",
        //                 };
        //             }
        //         }

        //         const result = {
        //             ...prompt,
        //             creator
        //         };

        //         return res.status(200).json(result);

        //     } catch (err) {
        //         console.error("PROMPT FETCH ERROR:", err);

        //         return res.status(500).json({
        //             error: "Failed to fetch prompt"
        //         });
        //     }
        // });

        //--------------------------------


        // ------------------

        // app.get("/api/prompts/:id", async (req, res) => {
        //     try {
        //         const { id } = req.params;

        //         if (!ObjectId.isValid(id)) {
        //             return res.status(400).json({ error: "Invalid prompt id" });
        //         }

        //         const prompt = await promptCollection.findOne({
        //             _id: new ObjectId(id)
        //         });

        //         if (!prompt) {
        //             return res.status(404).json({ error: "Prompt not found" });
        //         }

        //         let creator = null;

        //         if (prompt.creatorId && ObjectId.isValid(prompt.creatorId)) {
        //             const user = await userCollection.findOne({
        //                 _id: new ObjectId(prompt.creatorId)
        //             });

        //             if (user) {
        //                 creator = {
        //                     name: user.name || "Unknown",
        //                     email: user.email || "",
        //                     image: user.image || "",
        //                     plan: user.plan || "free",
        //                 };
        //             }
        //         }

        //         res.status(200).json({
        //             ...prompt,
        //             creator,
        //             ratingAvg: prompt.ratingAvg || 0,
        //             ratingCount: prompt.ratingCount || 0
        //         });

        //     } catch (err) {
        //         console.error(err);
        //         res.status(500).json({ error: "Failed to fetch prompt" });
        //     }
        // });


        app.get("/api/prompts/:id", async (req, res) => {
            try {
                const { id } = req.params;

                if (!ObjectId.isValid(id)) {
                    return res.status(400).json({ error: "Invalid prompt id" });
                }

                const prompt = await promptCollection.findOne({
                    _id: new ObjectId(id)
                });

                if (!prompt) {
                    return res.status(404).json({ error: "Prompt not found" });
                }

                const creator = await userCollection.findOne(
                    { _id: new ObjectId(prompt.creatorId) },
                    { projection: { name: 1, email: 1, image: 1, plan: 1 } }
                );

                return res.json({
                    ...prompt,
                    creator: creator || null
                });

            } catch (err) {
                console.error(err);
                res.status(500).json({ error: "Failed to fetch prompt" });
            }
        });



        app.patch("/api/prompts/:id/copy", async (req, res) => {
            try {
                const { id } = req.params;

                await promptCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $inc: { copyCount: 1 } }
                );

                res.json({ success: true });
            } catch (err) {
                res.status(500).json({ error: "Copy failed" });
            }
        });


        app.post("/api/prompts/:id/report", async (req, res) => {
            try {
                const { id } = req.params;
                const { userId, reason } = req.body;

                if (!ObjectId.isValid(id) || !ObjectId.isValid(userId)) {
                    return res.status(400).json({ error: "Invalid IDs" });
                }

                if (!reason || reason.trim().length < 3) {
                    return res.status(400).json({ error: "Reason required" });
                }

                // prevent duplicate report by same user
                const existing = await reportCollection.findOne({
                    promptId: new ObjectId(id),
                    userId: new ObjectId(userId),
                });

                if (existing) {
                    return res.status(409).json({
                        error: "Already reported",
                    });
                }

                const result = await reportCollection.insertOne({
                    promptId: new ObjectId(id),
                    userId: new ObjectId(userId),
                    reason,
                    createdAt: new Date(),
                });

                res.status(201).json({
                    success: true,
                    insertedId: result.insertedId,
                });
            } catch (err) {
                console.error("REPORT ERROR:", err);
                res.status(500).json({ error: "Failed to report" });
            }
        });
        
        // -----------

        app.post("/api/prompts/:id/rate", async (req, res) => {
            try {
                const { id } = req.params;
                const { userId, rating } = req.body;

                if (!ObjectId.isValid(id)) {
                    return res.status(400).json({ error: "Invalid prompt id" });
                }

                if (!userId || !rating) {
                    return res.status(400).json({ error: "Missing data" });
                }

                // 1. Upsert rating (one user = one rating)
                await ratingCollection.updateOne(
                    { promptId: new ObjectId(id), userId: new ObjectId(userId) },
                    {
                        $set: {
                            rating: Number(rating),
                            updatedAt: new Date()
                        },
                        $setOnInsert: {
                            createdAt: new Date()
                        }
                    },
                    { upsert: true }
                );

                // 2. Recalculate average
                const stats = await ratingCollection.aggregate([
                    { $match: { promptId: new ObjectId(id) } },
                    {
                        $group: {
                            _id: "$promptId",
                            avg: { $avg: "$rating" },
                            count: { $sum: 1 }
                        }
                    }
                ]).toArray();

                const avg = stats[0]?.avg || 0;
                const count = stats[0]?.count || 0;

                // 3. Update prompt cache
                await promptCollection.updateOne(
                    { _id: new ObjectId(id) },
                    {
                        $set: {
                            ratingAvg: avg,
                            ratingCount: count
                        }
                    }
                );

                res.json({ success: true, avg, count });

            } catch (err) {
                console.error(err);
                res.status(500).json({ error: "Rating failed" });
            }
        });


        app.get("/api/prompts/:id/rating", async (req, res) => {
            try {
                const { id } = req.params;

                const prompt = await promptCollection.findOne(
                    { _id: new ObjectId(id) },
                    { projection: { ratingAvg: 1, ratingCount: 1 } }
                );

                const userRatings = await ratingCollection.find({
                    promptId: new ObjectId(id)
                }).toArray();

                res.json({
                    avg: prompt?.ratingAvg || 0,
                    count: prompt?.ratingCount || 0,
                    reviews: userRatings
                });

            } catch (err) {
                res.status(500).json({ error: "Failed to load rating" });
            }
        });


        // bookmark---------------------------------------
        app.get("/api/bookmarks/user/:userId", async (req, res) => {
            try {
                const { userId } = req.params;

                if (!ObjectId.isValid(userId)) {
                    return res.status(400).json({ error: "Invalid user id" });
                }

                const bookmarks = await bookmarkCollection
                    .find({ userId: new ObjectId(userId) })
                    .toArray();

                const promptIds = bookmarks.map(
                    (b) => new ObjectId(b.promptId)
                );

                const prompts = await promptCollection
                    .find({ _id: { $in: promptIds } })
                    .toArray();

                res.json({
                    success: true,
                    data: prompts,
                });
            } catch (err) {
                console.error(err);
                res.status(500).json({ error: "Failed to load bookmarks" });
            }
        });


        app.get("/api/prompts/:id/bookmark/:userId", async (req, res) => {
            try {
                const { id, userId } = req.params;

                if (!ObjectId.isValid(id)) {
                    return res.status(400).json({
                        error: "Invalid prompt id"
                    });
                }

                if (!ObjectId.isValid(userId)) {
                    return res.status(400).json({
                        error: "Invalid user id"
                    });
                }

                const bookmark = await bookmarkCollection.findOne({
                    promptId: new ObjectId(id),
                    userId: new ObjectId(userId)
                });

                res.json({
                    bookmarked: !!bookmark
                });

            } catch (err) {
                console.error("BOOKMARK STATUS ERROR:", err);

                res.status(500).json({
                    error: "Failed to check bookmark status"
                });
            }
        });


        app.post("/api/prompts/:id/bookmark", async (req, res) => {
            try {
                const { id } = req.params;
                const { userId } = req.body;

                if (!ObjectId.isValid(id)) {
                    return res.status(400).json({
                        error: "Invalid prompt id"
                    });
                }

                if (!ObjectId.isValid(userId)) {
                    return res.status(400).json({
                        error: "Invalid user id"
                    });
                }

                const existingBookmark = await bookmarkCollection.findOne({
                    promptId: new ObjectId(id),
                    userId: new ObjectId(userId)
                });

                if (existingBookmark) {
                    return res.json({
                        success: true,
                        bookmarked: true,
                        message: "Already bookmarked"
                    });
                }

                const result = await bookmarkCollection.insertOne({
                    promptId: new ObjectId(id),
                    userId: new ObjectId(userId),
                    createdAt: new Date()
                });

                res.status(201).json({
                    success: true,
                    bookmarked: true,
                    insertedId: result.insertedId
                });

            } catch (err) {
                console.error("BOOKMARK ERROR:", err);

                res.status(500).json({
                    error: "Failed to bookmark prompt"
                });
            }
        });



        app.delete("/api/prompts/:id/bookmark/:userId", async (req, res) => {
            try {
                const { id, userId } = req.params;

                if (!ObjectId.isValid(id)) {
                    return res.status(400).json({
                        error: "Invalid prompt id"
                    });
                }

                if (!ObjectId.isValid(userId)) {
                    return res.status(400).json({
                        error: "Invalid user id"
                    });
                }

                const result = await bookmarkCollection.deleteOne({
                    promptId: new ObjectId(id),
                    userId: new ObjectId(userId)
                });

                res.json({
                    success: true,
                    deletedCount: result.deletedCount
                });

            } catch (err) {
                console.error("REMOVE BOOKMARK ERROR:", err);

                res.status(500).json({
                    error: "Failed to remove bookmark"
                });
            }
        });



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


        // app.post("/api/prompts", async (req, res) => {
        //     const promptData = req.body;
        //     const newPromptData = {
        //         ...promptData,
        //         createdAt: new Date()
        //     }
        //     const result = await promptCollection.insertOne(newPromptData);

        //     res.json(result);
        // });

        app.post("/api/prompts", async (req, res) => {
            try {
                const promptData = req.body;

                const newPromptData = {
                    ...promptData,

                    // system fields (backend controlled)
                    createdAt: new Date(),

                    ratingAvg: 0,
                    ratingCount: 0,
                };

                const result = await promptCollection.insertOne(newPromptData);

                res.json(result);
            } catch (err) {
                console.error(err);
                res.status(500).json({ error: "Failed to create prompt" });
            }
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





        //---------------
        // public api(here use aggregation)
        app.get("/api/creators/top", async (req, res) => {
            try {
                const topCreators = await promptCollection.aggregate([
                    {
                        $group: {
                            _id: "$creatorId",
                            totalPrompts: { $sum: 1 }
                        }
                    },
                    {
                        $sort: { totalPrompts: -1 }
                    },
                    {
                        $limit: 10
                    }
                ]).toArray();

                const enriched = await Promise.all(
                    topCreators.map(async (creator) => {
                        const user = await userCollection.findOne({
                            _id: new ObjectId(creator._id)
                        });

                        if (!user) return null;

                        return {
                            creatorId: creator._id,
                            name: user.name,
                            image: user.image,
                            totalPrompts: creator.totalPrompts
                        };
                    })
                );

                res.send(enriched.filter(Boolean));
            } catch (err) {
                console.error(err);
                res.status(500).send({ error: "Failed to fetch top creators" });
            }
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