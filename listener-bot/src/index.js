require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, Events } = require('discord.js');

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const express = require('express');
const path = require('path');

// 1. Initialize Logging System
const activityLogs = [];
function logActivity(message, type = 'info') {
    const log = {
        timestamp: new Date().toLocaleTimeString(),
        message,
        type, // info, success, error
    };
    activityLogs.unshift(log);
    if (activityLogs.length > 50) activityLogs.pop(); // Keep last 50
    console.log(`${type === 'error' ? '❌' : '📝'} [${log.timestamp}] ${message}`);
}

// 2. Initialize Firebase Admin
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
            logActivity('No service-account.json found. Dashboard will show Firebase as offline.', 'error');
        }
    }
}

if (serviceAccount) {
    initializeApp({
        credential: cert(serviceAccount)
    });
}

const db = getFirestore();

// 3. Initialize Express Dashboard
const app = express();
const PORT = process.env.PORT || 3000;
const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

app.get('/', (req, res) => {
    res.render('index', {
        botStatus: client.user ? 'Online' : 'Connecting...',
        botTag: client.user?.tag || 'N/A',
        firebaseStatus: serviceAccount ? 'Connected' : 'Disconnected',
        logs: activityLogs,
        externalUrl: RENDER_EXTERNAL_URL || `http://localhost:${PORT}`
    });
});

app.listen(PORT, () => {
    logActivity(`Dashboard server listening on port ${PORT}`, 'success');

    if (RENDER_EXTERNAL_URL) {
        setInterval(() => {
            const http = require('http');
            http.get(RENDER_EXTERNAL_URL, (res) => {
                // Silent ping
            }).on('error', (err) => {
                logActivity(`Self-ping failed: ${err.message}`, 'error');
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
    logActivity(`Foxy Listener is online as ${client.user.tag}`, 'success');

    // Start watching for app submissions
    const scanner = new SubmissionsScanner(db, client);
    scanner.start();
    logActivity('Submissions Scanner started', 'info');
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
            logActivity(`Synced new ${data.questions[0].type}: ${data.questions[0].text}`, 'success');
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
                logActivity(`Finished ${data.challengeType}: Correct answer was ${data.correctAnswer}`, 'success');
            }
        }
    } catch (error) {
        logActivity(`Error in listener bot: ${error.message}`, 'error');
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



