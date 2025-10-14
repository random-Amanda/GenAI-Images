import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";
import db from "./db.js";
import axios from "axios";
import fs from "fs";
import path from "path";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "dall-e-3";
const API_BASE_URL = process.env.API_BASE_URL;
const GROUPS_STARTING_ID = Number(process.env.GROUPS_STARTING_ID) || 1;

const triggerWords = ["playground", "play", "disabilities", "disability", "wheelchair", "design", "sketch", "disabled",
    "indoor", "outdoor", "park", "children", "child", "accessibility", "accessible", "inclusion", "inclusive"];

function getOrCreateUser({ name, student_id, group, member, consent }) {
    let user = db
        .prepare("SELECT * FROM users WHERE group_number=? AND member=?")
        .get(group, member);

    if (!user) {
        const result = db
            .prepare("INSERT INTO users (name, student_id, group_number, member, consent) VALUES (?, ?, ?, ?, ?)")
            .run(name, student_id, group, member, consent);
        user = { id: result.lastInsertRowid, name, student_id, group_number: group, member };
    } else if (consent && user.consent !== consent) {
        db.prepare("UPDATE users SET consent=? WHERE id=?").run(consent, user.id);
        user.consent = consent;
    }
    return user;
}

async function getNextMockResponse(seenIds = []) {
    // wait for 10 seconds to simulate thinking
    await new Promise(resolve => setTimeout(resolve, 10000));
    const seenSet = new Set(seenIds.map(Number));
    let nextId = Math.floor(Math.random() * 5) + 1;
    if (seenSet.size < 5) {
        nextId = getNextMockResponseId(seenSet);
    }
    const nextResponse = db.prepare("SELECT * FROM mock_responses WHERE id=?").get(nextId);
    return nextResponse;
}

function getNextMockResponseId(existingSet) {
    let num;
    do {
        num = Math.floor(Math.random() * 5) + 1;
    } while (existingSet.has(num));
    return num;
}

function saveMessage(user_id, role, content) {
    db.prepare("INSERT INTO messages (user_id, role, content) VALUES (?, ?, ?)").run(user_id, role, content);
}

function saveImage(user_id, role, image) {
    db.prepare("INSERT INTO messages (user_id, role, image) VALUES (?, ?, ?)").run(user_id, role, image);
}

function getChatHistory(user_id) {
    return db
        .prepare("SELECT role, image, content FROM messages WHERE user_id=? ORDER BY id ASC")
        .all(user_id);
}

app.get("/api/config", (req, res) => {
    res.json({
        GROUPS_STARTING_ID: Number(GROUPS_STARTING_ID) || 1
    });
});

app.post("/api/load-chat", (req, res) => {
    try {
        const { name, student_id, group, member, consent } = req.body;
        const user = getOrCreateUser({ name, student_id, group, member, consent });
        let history = getChatHistory(user.id);
        if (!history || history.length === 0) {
            history = [{ role: "init", content: "How can I assist you today?" }];
        }
        res.json({
            messages: history,
            name: user.name,
            student_id: user.student_id,
            group: user.group_number,
            member: user.member,
            consent: user.consent
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to load chat history" });
    }
});

// (non-streaming) chat endpoint
app.post("/api/chat", async (req, res) => {
    try {
        const { message, group, name, student_id, member } = req.body || {};
        const user = getOrCreateUser({ name, student_id, group, member });
        let context = getChatHistory(user.id);
        if (context.length === 0) {
            let triggerFound = false;
            const words = message.content.toLowerCase().split(/\W+/);
            triggerFound = words.some(word => triggerWords.includes(word));
            if (!triggerFound) {
                res.json({ id: null, content: "❌ ERROR : Outside the scope of the task", raw: {} });
                return;
            }

        }

        saveMessage(user.id, message.role, message.content);

        // For groups within the specified range, use mock responses
        if (Number(group) >= GROUPS_STARTING_ID && Number(group) <= (GROUPS_STARTING_ID + 5)) {
            const { seen_mock_ids = [] } = req.body;
            const mockResponse = await getNextMockResponse(seen_mock_ids);
            if (!mockResponse) {
                res.json({ id: null, content: "No more responses available.", raw: {} });
                saveMessage(user.id, "assistant", "No more responses available.");
                return;
            }

            res.json({ id: mockResponse.id, content: mockResponse.image, raw: {} });
            saveImage(user.id, "assistant", mockResponse.image);
            return;
        }

        let url = API_BASE_URL + "/v1/images/generations";
        const oaiRes = await fetch(url, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${OPENAI_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: OPENAI_MODEL,
                prompt: message.content,
                size: "1024x1024",
                quality: "standard",
                n: 1
            })
        });

        if (!oaiRes.ok) {
            // const errText = await oaiRes.text();
            console.error("OpenAI API error:", oaiRes.status, await oaiRes.text());
            const errText = "⚠️ Your prompt couldn’t be processed. Please use a more detailed and appropriate description without vague or restricted content.";
            return res.status(oaiRes.status).send(errText);
        }

        const data = await oaiRes.json();
        let imageUrl = data?.data?.[0]?.url ?? "";
        saveMessage(user.id, "assistant", imageUrl);
        const responseData = await axios.get(imageUrl, { responseType: "arraybuffer" });
        const responseImage = Buffer.from(responseData.data, 'binary');

        res.json({
            content: responseImage,
            raw: data
        });
        saveImage(user.id, "assistant", responseImage);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Server running: ${process.env.BASE_URL}:${port}`);
});
