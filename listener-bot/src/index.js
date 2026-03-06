require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, Events } = require('discord.js');

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const http = require('http');

// 1. Initialize Firebase Admin
let serviceAccount;
try {
    // Locally it expects it to be two levels up based on original code
    serviceAccount = require('../../service-account.json');
} catch (error) {
    // Check local directory if missing (for Docker/Render convenience)
    try {
        serviceAccount = require('../service-account.json');
    } catch (e) {
        if (process.env.FIREBASE_SERVICE_ACCOUNT) {
            serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        } else {
            console.error('❌ Critical: No service-account.json found. Populate FIREBASE_SERVICE_ACCOUNT env var or add the file.');
        }
    }
}

if (serviceAccount) {
    initializeApp({
        credential: cert(serviceAccount)
    });
}

const db = getFirestore();

// 2. Health check server for Render
const PORT = process.env.PORT || 3000;
const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;

http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
}).listen(PORT, () => {
    console.log(`📡 Health check server listening on port ${PORT}`);

    // Self-ping every 10 minutes to stay awake on Render Free Tier
    if (RENDER_EXTERNAL_URL) {
        setInterval(() => {
            http.get(RENDER_EXTERNAL_URL, (res) => {
                console.log(`💓 Self-ping sent to ${RENDER_EXTERNAL_URL}: ${res.statusCode}`);
            }).on('error', (err) => {
                console.error('❌ Self-ping failed:', err.message);
            });
        }, 10 * 60 * 1000);
    }
});



// 2. Initialize Discord Client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Config from .env
const QUIZ_BOT_ID = process.env.QUIZ_APP_BOT_ID;
const QUIZ_CHANNEL_ID = process.env.QUIZ_CHANNEL_ID;

const { parseQuizMessage } = require('./parseQuizMessage');
const SubmissionsScanner = require('./submissionsScanner');

client.once(Events.ClientReady, () => {
    console.log(`🤖 Foxy Listener is online as ${client.user.tag}`);

    // Start watching for app submissions
    const scanner = new SubmissionsScanner(db, client);
    scanner.start();
});

client.on('messageCreate', async (message) => {
    if (message.author.id !== QUIZ_BOT_ID) return;
    if (message.channel.id !== QUIZ_CHANNEL_ID) return;

    try {
        const data = parseQuizMessage(message);
        if (!data) return;

        if (data.type === 'NEW_QUIZ') {
            const quizId = `quiz_${message.id}`;
            await db.collection('quizzes').doc(quizId).set({
                quizId,
                title: data.title,
                status: 'active',
                type: data.questions[0].type,
                createdAt: FieldValue.serverTimestamp(),
                expiresAt: calculateExpiry(),
                questions: data.questions,
                sourceMessageId: message.id
            });
            console.log(`✅ Synced new ${data.questions[0].type}: ${data.questions[0].text}`);
        }
        else if (data.type === 'REVEAL_QUIZ') {
            // Find the most recent active quiz of this type to update it
            const activeQuizzes = await db.collection('quizzes')
                .where('status', '==', 'active')
                .where('type', '==', data.challengeType)
                .orderBy('createdAt', 'desc')
                .limit(1)
                .get();

            if (!activeQuizzes.empty) {
                const quizDoc = activeQuizzes.docs[0];
                const quizData = quizDoc.data();

                // Update the first question with the correct answer
                const updatedQuestions = [...quizData.questions];
                updatedQuestions[0].correctAnswer = data.correctAnswer;

                await quizDoc.ref.update({
                    status: 'finished',
                    questions: updatedQuestions,
                    revealedAt: FieldValue.serverTimestamp()
                });
                console.log(`🏁 Finished ${data.challengeType}: Correct answer was ${data.correctAnswer}`);
            }
        }
    } catch (error) {
        console.error('❌ Error in listener bot:', error);
    }
});

function calculateExpiry() {
    const date = new Date();
    date.setHours(date.getHours() + 2); // 2 hour window
    return date.toISOString();
}

const token = process.env.LISTENER_BOT_TOKEN ? process.env.LISTENER_BOT_TOKEN.trim() : null;
if (!token) {
    console.error('❌ Error: LISTENER_BOT_TOKEN is missing in .env');
    process.exit(1);
}

client.login(token).catch(err => {
    console.error('❌ Failed to login to Discord:', err.message);
    if (err.message.includes('TokenInvalid')) {
        console.error('👉 Please double check your LISTENER_BOT_TOKEN in the .env file.');
    }
    process.exit(1);
});



