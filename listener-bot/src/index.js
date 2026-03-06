require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

// 1. Initialize Firebase Admin
// Make sure to put your service-account.json in the listener-bot folder
const serviceAccount = require('../../service-account.json');

initializeApp({
    credential: cert(serviceAccount)
});

const db = getFirestore();

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

client.once('ready', () => {
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

client.login(process.env.LISTENER_BOT_TOKEN);
