const dns = require("node:dns");
dns.setServers(["1.1.1.1", "1.0.0.1"]);

const express = require("express");
const dontenv = require("dotenv");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const { createRemoteJWKSet, jwtVerify } = require("jose-cjs");
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




const JWKS = createRemoteJWKSet(
    new URL(`${process.env.CLIENT_URL}/api/auth/jwks`),
);


const verifyToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer")) {
        return res.status(401).json({ msg: "Unauthorized" });
    }

    // ["Bearer", "xjasasdhsagdydsav"]

    const token = authHeader.split(" ")[1];

    if (!token) {
        return res.status(401).json({ msg: "Unauthorized" });
    }

    try {
        const { payload } = await jwtVerify(token, JWKS);
        req.user = payload;

        console.log("TOKEN VERIFIED");
        console.log(payload);

        next();
    } catch (error) {
        console.log(error);
        return res.status(401).json({ msg: "Unauthorized" });
    }
};

const userVerify = async (req, res, next) => {
    const user = req.user;
    if (user?.role !== "user" || user.plan != "premium") {
        return res.status(403).json({ msg: "Forbidden" });
    }
    next();
};

const creatorVerify = async (req, res, next) => {
    const user = req.user;
    if (user?.role !== "creator") {
        return res.status(403).json({ msg: "Forbidden" });
    }
    next();
};

const adminVerify = async (req, res, next) => {
    const user = req.user;
    if (user?.role !== "admin") {
        return res.status(403).json({ msg: "Forbidden" });
    }
    next();
};


// async function run() {
//     try {
//         await client.connect();

        client.connect(() => {
            console.log('connecting to MOngo db');
        }).catch(console.dir)



        const db = client.db("PromptGrid");
        const userCollection = db.collection("user");
        const promptCollection = db.collection("prompts");
        const rejectionCollection = db.collection("rejection-feedback")
        const ratingCollection = db.collection("prompt-ratings")
        const bookmarkCollection = db.collection("prompt-bookmarks")
        const reportCollection = db.collection("prompt-reports");
        const subscriptionsCollection = db.collection("subscriptions");
        const copiedPromptCollection = db.collection("copied-prompts");



        // app.post("/subscription", async (req, res) => {
        //     // console.log("BODY =", req.body);
        //     const { sessionId, userId, priceId } = req.body;

        //     const isExist = await subscriptionsCollection.findOne({ sessionId });
        //     if (isExist) {
        //         return res.json({ msg: "Already exist!" });
        //     }

        //     await subscriptionsCollection.insertOne({
        //         sessionId,
        //         userId,
        //         priceId,
        //     });

        //     //update user role
        //     await userCollection.updateOne(
        //         { _id: new ObjectId(userId) },
        //         { $set: { plan: "premium" } },
        //     );

        //     res.json({ msg: "Payment successful!" });
        // });


        // try to solve payment by this: 
        app.get("/api/user/me", async (req, res) => {
            try {
                const { userId } = req.query;

                if (!userId) {
                    return res.status(400).json({ error: "userId required" });
                }

                const user = await userCollection.findOne({
                    _id: new ObjectId(userId)
                });

                if (!user) {
                    return res.status(404).json({ error: "User not found" });
                }

                res.json({
                    success: true,
                    user
                });

            } catch (err) {
                console.error(err);
                res.status(500).json({ error: "Failed to fetch user" });
            }
        });

        // GET ALL PAYMENTS (ADMIN)

        app.get("/payments", verifyToken, adminVerify, async (req, res) => {
            try {
                const payments = await subscriptionsCollection
                    .find({})
                    .sort({ createdAt: -1 })
                    .toArray();

                res.send({
                    success: true,
                    payments,
                });

            } catch (err) {
                console.error(err);

                res.status(500).send({
                    success: false,
                    message: "Failed to fetch payments",
                });
            }
        });

        app.post("/subscription", async (req, res) => {
            try {
                const {
                    sessionId,
                    userId,
                    userEmail,
                    priceId,
                    amount,
                } = req.body;

                const exists = await subscriptionsCollection.findOne({
                    sessionId,
                });

                if (exists) {
                    return res.json({
                        success: true,
                        message: "Already processed",
                    });
                }

                await subscriptionsCollection.insertOne({
                    sessionId,
                    userId,
                    userEmail,
                    priceId,
                    amount,
                    status: "paid",
                    createdAt: new Date(),
                });

                await userCollection.updateOne(
                    {
                        _id: new ObjectId(userId),
                    },
                    {
                        $set: {
                            plan: "premium",
                        },
                    }
                );

                res.json({
                    success: true,
                    message: "Payment successful",
                });

            } catch (err) {
                console.error(err);

                res.status(500).json({
                    success: false,
                    message: "Subscription failed",
                });
            }
        });


        // all prompt api(public): no need to very
        app.get("/api/prompts", async (req, res) => {
            try {
                const {
                    search,
                    category,
                    aiTool,
                    difficulty,
                    sort = "latest",
                    page = 1,
                    limit = 12
                } = req.query;

                // ---------------- BASE QUERY (LOCKED) ----------------
                const query = {
                    status: "approved"
                };

                // ---------------- SEARCH ----------------
                if (search) {
                    query.$or = [
                        { title: { $regex: search, $options: "i" } },
                        { tags: { $regex: search, $options: "i" } },
                        { aiTool: { $regex: search, $options: "i" } }
                    ];
                }

                // ---------------- FILTERS ----------------
                if (category && category !== "all") {
                    query.category = category;
                }

                if (aiTool && aiTool !== "all") {
                    query.aiTool = aiTool;
                }

                if (difficulty && difficulty !== "all") {
                    query.difficulty = difficulty;
                }

                // ---------------- SORT LOGIC ----------------
                let sortQuery = { createdAt: -1 };

                if (sort === "popular") {
                    sortQuery = { ratingAvg: -1 };
                }

                if (sort === "copied") {
                    sortQuery = { copyCount: -1 };
                }

                if (sort === "latest") {
                    sortQuery = { createdAt: -1 };
                }

                // ---------------- PAGINATION ----------------
                const pageNum = Number(page);
                const limitNum = Number(limit);
                const skip = (pageNum - 1) * limitNum;

                const total = await promptCollection.countDocuments(query);

                const prompts = await promptCollection
                    .find(query)
                    .sort(sortQuery)
                    .skip(skip)
                    .limit(limitNum)
                    .toArray();

                // ---------------- ENRICH CREATOR ----------------
                const enriched = await Promise.all(
                    prompts.map(async (prompt) => {
                        const creator = await userCollection.findOne(
                            { _id: new ObjectId(prompt.creatorId) },
                            { projection: { name: 1, image: 1 } }
                        );

                        return {
                            ...prompt,
                            creator: creator || {
                                name: "Unknown",
                                image: ""
                            }
                        };
                    })
                );

                // ---------------- RESPONSE ----------------
                res.json({
                    success: true,
                    total,
                    page: pageNum,
                    limit: limitNum,
                    data: enriched
                });

            } catch (err) {
                console.error("PROMPTS API ERROR:", err);
                res.status(500).json({
                    success: false,
                    message: "Failed to fetch prompts"
                });
            }
        });

        //no need to verify:
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


        //no need to verify
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


        //copy related all api:
        // app.patch("/api/prompts/:id/copy", async (req, res) => {
        //     try {
        //         const { id } = req.params;

        //         await promptCollection.updateOne(
        //             { _id: new ObjectId(id) },
        //             { $inc: { copyCount: 1 } }
        //         );

        //         res.json({ success: true });
        //     } catch (err) {
        //         res.status(500).json({ error: "Copy failed" });
        //     }
        // });

        app.patch("/api/prompts/:id/copy", async (req, res) => {
            try {
                const { id } = req.params;
                const { userId, content, title } = req.body;

                if (!userId) {
                    return res.status(400).json({ error: "Missing userId" });
                }

                // 1. increase copy count
                await promptCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $inc: { copyCount: 1 } }
                );

                // 2. store full copy history
                await copiedPromptCollection.insertOne({
                    promptId: new ObjectId(id),
                    userId: new ObjectId(userId),

                    content: content || "",
                    title: title || "",

                    createdAt: new Date()
                });

                res.json({ success: true });

            } catch (err) {
                console.error(err);
                res.status(500).json({ error: "Copy failed" });
            }
        });


        app.get("/api/user/copied-prompts", async (req, res) => {
            try {
                const { userId } = req.query;

                if (!ObjectId.isValid(userId)) {
                    return res.status(400).json({ error: "Invalid userId" });
                }

                // 1. get copied list (dashboard)
                const copies = await copiedPromptCollection.aggregate([
                    {
                        $match: {
                            userId: new ObjectId(userId)
                        }
                    },
                    {
                        $sort: {
                            createdAt: -1
                        }
                    },
                    {
                        $lookup: {
                            from: "prompts",
                            localField: "promptId",
                            foreignField: "_id",
                            as: "prompt"
                        }
                    },
                    {
                        $unwind: "$prompt"
                    },
                    {
                        $project: {
                            _id: 1,
                            createdAt: 1,
                            content: 1,

                            promptTitle: "$prompt.title",
                            promptThumbnail: "$prompt.thumbnail",
                            promptCategory: "$prompt.category",
                            promptVisibility: "$prompt.visibility"
                        }
                    }
                ]).toArray();

                // 2. total copy count (profile stats)
                const totalCopy = await copiedPromptCollection.countDocuments({
                    userId: new ObjectId(userId)
                });

                res.json({
                    success: true,

                    // dashboard data
                    data: copies,

                    // profile stats
                    stats: {
                        totalCopy
                    }
                });

            } catch (err) {
                console.error(err);
                res.status(500).json({ error: "Failed to fetch copied prompts" });
            }
        });


        app.delete("/api/user/copied-prompts/:id", async (req, res) => {
            try {
                const { id } = req.params;

                await copiedPromptCollection.deleteOne({
                    _id: new ObjectId(id),
                });

                res.json({ success: true });
            } catch (err) {
                res.status(500).json({ error: "Failed to delete item" });
            }
        });


        app.delete("/api/user/copied-prompts", async (req, res) => {
            try {
                const { userId } = req.query;

                await copiedPromptCollection.deleteMany({
                    userId: new ObjectId(userId),
                });

                res.json({ success: true });
            } catch (err) {
                res.status(500).json({ error: "Failed to clear history" });
            }
        });


        // -------------------

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
                    reportStatus: "pending",
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

        app.get("/api/reviews/all", async (req, res) => {
            try {
                const reviews = await ratingCollection
                    .find({ review: { $ne: "" } })
                    .sort({ createdAt: -1 })
                    .limit(50)
                    .toArray();

                res.json(reviews);
            } catch (err) {
                res.status(500).json({ error: "Failed to load reviews" });
            }
        });


        // app.get("/api/reviews/my", async (req, res) => {
        //     try {
        //         const { userId } = req.query;

        //         if (!userId) {
        //             return res.status(400).json({ error: "userId required" });
        //         }

        //         const reviews = await ratingCollection
        //             .find({
        //                 userId: userId, // only this user's reviews
        //                 review: { $ne: "" }
        //             })
        //             .sort({ createdAt: -1 })
        //             .toArray();

        //         res.json({
        //             success: true,
        //             data: reviews
        //         });

        //     } catch (err) {
        //         console.error(err);
        //         res.status(500).json({ error: "Failed to load user reviews" });
        //     }
        // });


        app.get("/api/user/reviews", async (req, res) => {
            try {
                const { userId } = req.query;

                // 1. validation
                if (!userId || !ObjectId.isValid(userId)) {
                    return res.status(400).json({
                        success: false,
                        message: "Invalid userId"
                    });
                }

                const reviews = await ratingCollection
                    .find({
                        userId: new ObjectId(userId)
                    })
                    .sort({ createdAt: -1 })
                    .toArray();

                res.json({
                    success: true,
                    data: reviews
                });

            } catch (err) {
                console.error("USER REVIEWS ERROR:", err);

                res.status(500).json({
                    success: false,
                    message: "Failed to fetch user reviews"
                });
            }
        });


        app.post("/api/prompts/:id/rate", async (req, res) => {
            try {
                const { id } = req.params;

                const {
                    userId,
                    rating,
                    userPlan,
                    userName,
                    userImage,
                    review
                } = req.body;

                // ---------------- VALIDATION ----------------
                if (!ObjectId.isValid(id)) {
                    return res.status(400).json({ error: "Invalid prompt id" });
                }

                if (!userId || !rating) {
                    return res.status(400).json({ error: "Missing data" });
                }

                const numericRating = Number(rating);

                if (numericRating < 1 || numericRating > 5) {
                    return res.status(400).json({ error: "Invalid rating value" });
                }

                // ---------------- GET PROMPT ----------------
                const prompt = await promptCollection.findOne({
                    _id: new ObjectId(id)
                });

                if (!prompt) {
                    return res.status(404).json({ error: "Prompt not found" });
                }

                // ---------------- ACCESS CONTROL ----------------
                const isBlocked =
                    (userPlan || "free") === "free" &&
                    prompt.visibility === "private";

                if (isBlocked) {
                    return res.status(403).json({
                        error: "Free users cannot rate private prompts"
                    });
                }

                // ---------------- ONE USER ONE RATING ----------------
                const existing = await ratingCollection.findOne({
                    promptId: new ObjectId(id),
                    userId: new ObjectId(userId)
                });

                if (existing) {
                    return res.status(409).json({
                        error: "You already rated this prompt"
                    });
                }

                // ---------------- INSERT RATING ----------------
                await ratingCollection.insertOne({
                    promptId: new ObjectId(id),
                    userId: new ObjectId(userId),

                    userName: userName || "Unknown",
                    userImage: userImage || "",

                    rating: numericRating,
                    review: review || "",

                    createdAt: new Date()
                });

                // ---------------- RECALCULATE STATS ----------------
                const stats = await ratingCollection.aggregate([
                    {
                        $match: {
                            promptId: new ObjectId(id)
                        }
                    },
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

                // ---------------- UPDATE PROMPT CACHE ----------------
                await promptCollection.updateOne(
                    { _id: new ObjectId(id) },
                    {
                        $set: {
                            ratingAvg: avg,
                            ratingCount: count
                        }
                    }
                );

                // ---------------- RESPONSE ----------------
                res.json({
                    success: true,
                    avg,
                    count
                });

            } catch (err) {
                console.error("RATING ERROR:", err);
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

        // Creator apis:

        app.get("/api/creator/dashboard", async (req, res) => {
            try {
                const { userId } = req.query;

                if (!userId) {
                    return res.status(400).json({ error: "userId required" });
                }

                // IMPORTANT: treat everything as STRING (consistent with your DB)
                const creatorId = userId.toString();

                // 1. GET PROMPTS
                const prompts = await promptCollection
                    .find({ creatorId })
                    .toArray();

                const promptIds = prompts.map(p => p._id.toString());

                // 2. TOTAL PROMPTS
                const totalPrompts = prompts.length;

                // 3. TOTAL COPIES (FIXED: convert promptId to string match)
                const totalCopies = await copiedPromptCollection.countDocuments({
                    promptId: { $in: promptIds.map(id => new ObjectId(id)) }
                });

                // 4. TOTAL RATINGS
                const ratingsAgg = await ratingCollection.aggregate([
                    {
                        $match: {
                            promptId: {
                                $in: prompts.map(p => p._id)
                            }
                        }
                    },
                    {
                        $group: {
                            _id: null,
                            avgRating: { $avg: "$rating" },
                            totalRatings: { $sum: 1 }
                        }
                    }
                ]).toArray();

                const avgRating = ratingsAgg[0]?.avgRating || 0;
                const totalRatings = ratingsAgg[0]?.totalRatings || 0;

                // 5. MOST POPULAR PROMPT (REAL)
                const mostPopular = await promptCollection
                    .find({ creatorId })
                    .sort({ copyCount: -1 })
                    .limit(1)
                    .toArray();

                // 6. RECENT COPIES (REAL ACTIVITY)
                const recentActivity = await copiedPromptCollection.aggregate([
                    {
                        $match: {
                            promptId: { $in: prompts.map(p => p._id) }
                        }
                    },
                    {
                        $sort: { createdAt: -1 }
                    },
                    {
                        $limit: 5
                    },
                    {
                        $lookup: {
                            from: "prompts",
                            localField: "promptId",
                            foreignField: "_id",
                            as: "prompt"
                        }
                    },
                    { $unwind: "$prompt" },
                    {
                        $project: {
                            _id: 1,
                            createdAt: 1,
                            title: "$prompt.title"
                        }
                    }
                ]).toArray();

                // 7. ENGAGEMENT SCORE
                const engagementScore =
                    (totalCopies * 2) +
                    (totalRatings * 5) +
                    (totalPrompts * 3);

                res.json({
                    success: true,
                    stats: {
                        totalPrompts,
                        totalCopies,
                        totalRatings,
                        avgRating: Number(avgRating.toFixed(1)),
                        engagementScore
                    },
                    mostPopular: mostPopular[0] || null,
                    recentActivity
                });

            } catch (err) {
                console.error(err);
                res.status(500).json({ error: "Dashboard failed" });
            }
        });

        // ===============================
        // GET ALL USERS (ADMIN ONLY)
        // ===============================
        app.get("/api/admin/users", verifyToken, adminVerify, async (req, res) => {
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
        app.patch("/api/admin/users/:id", verifyToken, adminVerify, async (req, res) => {
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
        app.delete("/api/admin/users/:id", verifyToken, adminVerify, async (req, res) => {
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


        app.get("/api/admin/prompts", verifyToken, adminVerify, async (req, res) => {
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

        // continue admin page er backend code
        // GET ALL REPORTS (with prompt + user info)
        app.get("/api/admin/reports", verifyToken, adminVerify, async (req, res) => {
            try {
                const reports = await reportCollection.aggregate([
                    {
                        $sort: { createdAt: -1 }
                    },

                    // join prompt data
                    {
                        $lookup: {
                            from: "prompts",
                            localField: "promptId",
                            foreignField: "_id",
                            as: "prompt"
                        }
                    },
                    { $unwind: "$prompt" },

                    // join reporter user data
                    {
                        $lookup: {
                            from: "user",
                            localField: "userId",
                            foreignField: "_id",
                            as: "reporter"
                        }
                    },
                    { $unwind: "$reporter" },

                    {
                        $project: {
                            _id: 1,
                            reason: 1,
                            createdAt: 1,
                            reportStatus: 1,

                            prompt: {
                                _id: "$prompt._id",
                                title: "$prompt.title",
                                creatorId: "$prompt.creatorId",
                                status: "$prompt.status"
                            },

                            reporter: {
                                _id: "$reporter._id",
                                name: "$reporter.name",
                                email: "$reporter.email",
                                image: "$reporter.image"
                            }
                        }
                    }
                ]).toArray();

                res.json({
                    success: true,
                    data: reports
                });

            } catch (err) {
                console.error(err);
                res.status(500).json({ error: "Failed to fetch reports" });
            }
        });

        // DISMISS REPORT (NOT HARMFUL) in admin 
        app.patch("/api/admin/reports/:id/dismiss", verifyToken, adminVerify, async (req, res) => {
            try {
                const { id } = req.params;

                const result = await reportCollection.updateOne(
                    { _id: new ObjectId(id) },
                    {
                        $set: {
                            reportStatus: "dismissed"
                        }
                    }
                );

                res.json({
                    success: true,
                    message: "Report dismissed",
                    data: result
                });

            } catch (err) {
                console.error(err);
                res.status(500).json({ error: "Failed to dismiss report" });
            }
        });

        // WARN CREATOR
        app.patch("/api/admin/reports/:id/warn", verifyToken, adminVerify, async (req, res) => {
            try {
                const { id } = req.params;

                const report = await reportCollection.findOne({
                    _id: new ObjectId(id)
                });

                if (!report) {
                    return res.status(404).json({ error: "Report not found" });
                }

                await reportCollection.updateOne(
                    { _id: new ObjectId(id) },
                    {
                        $set: {
                            reportStatus: "warning_sent"
                        }
                    }
                );

                // OPTIONAL: you can increase warning count
                await userCollection.updateOne(
                    { _id: new ObjectId(report.userId) },
                    {
                        $inc: { warningCount: 1 }
                    }
                );

                res.json({
                    success: true,
                    message: "Creator warned"
                });

            } catch (err) {
                console.error(err);
                res.status(500).json({ error: "Failed to warn creator" });
            }
        });

        // 4. REMOVE PROMPT (HARD ACTION)
        app.patch("/api/admin/reports/:id/remove", verifyToken, adminVerify, async (req, res) => {
            try {
                const { id } = req.params;

                const report = await reportCollection.findOne({
                    _id: new ObjectId(id)
                });

                if (!report) {
                    return res.status(404).json({ error: "Report not found" });
                }

                // 1. Update report status
                await reportCollection.updateOne(
                    { _id: new ObjectId(id) },
                    {
                        $set: {
                            reportStatus: "prompt_removed"
                        }
                    }
                );

                // 2. Remove or deactivate prompt
                await promptCollection.updateOne(
                    { _id: new ObjectId(report.promptId) },
                    {
                        $set: {
                            status: "removed",
                            visibility: "hidden"
                        }
                    }
                );

                res.json({
                    success: true,
                    message: "Prompt removed successfully"
                });

            } catch (err) {
                console.error(err);
                res.status(500).json({ error: "Failed to remove prompt" });
            }
        });


        app.get("/api/admin/analytics", verifyToken, adminVerify, async (req, res) => {
            try {

                // ==============================
                // 1. BASIC COUNTS (OVERVIEW)
                // ==============================

                const totalUsers = await userCollection.countDocuments();

                const totalPrompts = await promptCollection.countDocuments();

                const totalReviews = await ratingCollection.countDocuments();

                const totalCopies = await copiedPromptCollection.countDocuments();

                const totalBookmarks = await bookmarkCollection.countDocuments();

                // ==============================
                // 2. USER ANALYTICS
                // ==============================

                const users = await userCollection.aggregate([
                    {
                        $group: {
                            _id: null,
                            total: { $sum: 1 },
                            free: {
                                $sum: {
                                    $cond: [{ $eq: ["$plan", "free"] }, 1, 0]
                                }
                            },
                            premium: {
                                $sum: {
                                    $cond: [{ $eq: ["$plan", "premium"] }, 1, 0]
                                }
                            },
                            creators: {
                                $sum: {
                                    $cond: [{ $eq: ["$role", "creator"] }, 1, 0]
                                }
                            }
                        }
                    }
                ]).toArray();

                const userStats = users[0] || {};

                // ==============================
                // 3. PROMPT CONTENT ANALYTICS
                // ==============================

                const promptStats = await promptCollection.aggregate([
                    {
                        $group: {
                            _id: null,
                            approved: {
                                $sum: {
                                    $cond: [{ $eq: ["$status", "approved"] }, 1, 0]
                                }
                            },
                            pending: {
                                $sum: {
                                    $cond: [{ $eq: ["$status", "pending"] }, 1, 0]
                                }
                            },
                            rejected: {
                                $sum: {
                                    $cond: [{ $eq: ["$status", "rejected"] }, 1, 0]
                                }
                            },
                            hidden: {
                                $sum: {
                                    $cond: [{ $eq: ["$visibility", "hidden"] }, 1, 0]
                                }
                            },
                            public: {
                                $sum: {
                                    $cond: [{ $eq: ["$visibility", "public"] }, 1, 0]
                                }
                            }
                        }
                    }
                ]).toArray();

                const contentStats = promptStats[0] || {};

                // ==============================
                // 4. REPORT ANALYTICS
                // ==============================

                const reportStats = await reportCollection.aggregate([
                    {
                        $group: {
                            _id: null,
                            total: { $sum: 1 },
                            pending: {
                                $sum: {
                                    $cond: [{ $eq: ["$reportStatus", "pending"] }, 1, 0]
                                }
                            },
                            dismissed: {
                                $sum: {
                                    $cond: [{ $eq: ["$reportStatus", "dismissed"] }, 1, 0]
                                }
                            },
                            removed: {
                                $sum: {
                                    $cond: [{ $eq: ["$reportStatus", "prompt_removed"] }, 1, 0]
                                }
                            },
                            warned: {
                                $sum: {
                                    $cond: [{ $eq: ["$reportStatus", "warning_sent"] }, 1, 0]
                                }
                            }
                        }
                    }
                ]).toArray();

                const reports = reportStats[0] || {};

                // ==============================
                // 5. SUBSCRIPTION ANALYTICS
                // ==============================

                const subscriptionStats = await subscriptionsCollection.aggregate([
                    {
                        $match: { status: "paid" }
                    },
                    {
                        $group: {
                            _id: null,
                            paidUsers: { $sum: 1 },
                            revenue: {
                                $sum: { $toDouble: "$amount" }
                            }
                        }
                    }
                ]).toArray();

                const subscriptions = subscriptionStats[0] || {};

                // ==============================
                // 6. RATINGS AVERAGE
                // ==============================

                const ratingStats = await ratingCollection.aggregate([
                    {
                        $group: {
                            _id: null,
                            avgRating: { $avg: "$rating" }
                        }
                    }
                ]).toArray();

                const avgRating = ratingStats[0]?.avgRating || 0;

                // ==============================
                // FINAL RESPONSE
                // ==============================

                res.json({
                    success: true,

                    overview: {
                        totalUsers,
                        totalPrompts,
                        totalReviews,
                        totalCopies,
                        totalBookmarks
                    },

                    users: {
                        total: userStats.total || totalUsers,
                        free: userStats.free || 0,
                        premium: userStats.premium || 0,
                        creators: userStats.creators || 0
                    },

                    content: {
                        approved: contentStats.approved || 0,
                        pending: contentStats.pending || 0,
                        rejected: contentStats.rejected || 0,
                        hidden: contentStats.hidden || 0,
                        public: contentStats.public || 0
                    },

                    reports: {
                        total: reports.total || 0,
                        pending: reports.pending || 0,
                        dismissed: reports.dismissed || 0,
                        removed: reports.removed || 0,
                        warned: reports.warned || 0
                    },

                    subscriptions: {
                        paidUsers: subscriptions.paidUsers || 0,
                        revenue: subscriptions.revenue || 0
                    },

                    ratings: {
                        avgRating: Number(avgRating.toFixed(2))
                    }
                });

            } catch (err) {
                console.error("Admin analytics error:", err);
                res.status(500).json({
                    success: false,
                    error: "Failed to load admin analytics"
                });
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

        // client add prompts
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


        // user profile er api:
        app.get("/api/user/stats", async (req, res) => {
            try {
                const { userId } = req.query;

                if (!ObjectId.isValid(userId)) {
                    return res.status(400).json({ error: "Invalid userId" });
                }

                // 🔥 CONSISTENT TYPE (STRING BASED SAFE)
                const id = userId.toString();

                const totalPrompts = await promptCollection.countDocuments({
                    creatorId: id,
                });

                const totalCopy = await copiedPromptCollection.countDocuments({
                    userId: id,
                });

                const bookmarks = await bookmarkCollection.countDocuments({
                    userId: id,
                });

                const recentCopies = await copiedPromptCollection
                    .find({ userId: id })
                    .sort({ createdAt: -1 })
                    .limit(5)
                    .toArray();

                res.json({
                    totalPrompts,
                    totalCopy,
                    bookmarks,
                    recentCopies,
                });

            } catch (err) {
                console.error(err);
                res.status(500).json({ error: "Stats fetch failed" });
            }
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

                    // 🔥 convert string → ObjectId safely
                    {
                        $addFields: {
                            creatorObjId: {
                                $convert: {
                                    input: "$_id",
                                    to: "objectId",
                                    onError: null,
                                    onNull: null
                                }
                            }
                        }
                    },

                    // 🔥 only valid ids
                    {
                        $match: {
                            creatorObjId: { $ne: null }
                        }
                    },

                    {
                        $lookup: {
                            from: "user",
                            localField: "creatorObjId",
                            foreignField: "_id",
                            as: "user"
                        }
                    },

                    {
                        $unwind: "$user"
                    },

                    {
                        $project: {
                            _id: 0,
                            creatorId: "$_id",
                            name: "$user.name",
                            image: "$user.image",
                            totalPrompts: 1
                        }
                    },

                    {
                        $sort: { totalPrompts: -1 }
                    },

                    {
                        $limit: 10
                    }
                ]).toArray();

                res.json(topCreators);

            } catch (err) {
                console.error(err);
                res.status(500).json({ error: "Failed to fetch top creators" });
            }
        });









        // Send a ping to confirm a successful connection
//         await client.db("admin").command({ ping: 1 });
//         console.log(
//             "Pinged your deployment. You successfully connected to MongoDB!",
//         );
//     } finally {
//         // Ensures that the client will close when you finish/error
//         // await client.close();
//     }
// }
// run().catch(console.dir);

app.get("/", (req, res) => {
    res.send("Server is running fine!");
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});