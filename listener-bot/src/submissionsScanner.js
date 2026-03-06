const EconomyHandler = require('./handlers/economyHandler');
const QuizHandler = require('./handlers/quizHandler');
const ProfileHandler = require('./handlers/profileHandler');

/**
 * Watches Firestore for new submissions and processes them.
 */
class SubmissionsScanner {
    constructor(db, discordClient) {
        this.db = db;
        this.economy = new EconomyHandler(db);
        this.quiz = new QuizHandler(db, discordClient, this.economy);
        this.profile = new ProfileHandler(db, discordClient);
    }

    start() {
        console.log('👀 Submissions Scanner started...');

        // Listen for new, unprocessed submissions
        this.db.collection('submissions')
            .where('processed', '==', false)
            .onSnapshot(snapshot => {
                snapshot.docChanges().forEach(async (change) => {
                    if (change.type === 'added') {
                        await this.processSubmission(change.doc);
                    }
                });
            }, error => {
                console.error('🔥 Scanner error:', error);
            });
    }

    async processSubmission(doc) {
        const data = doc.data();
        const id = doc.id;
        console.log(`📦 Processing submission: ${data.type} (${id})`);

        let result = { status: 'failed', error: 'Unknown type' };

        try {
            switch (data.type) {
                case 'QUIZ_ANSWER':
                    result = await this.quiz.handleSubmit(data);
                    break;
                case 'PURCHASE':
                    result = await this.economy.handlePurchase(data);
                    break;
                case 'LINK_DISCORD':
                    result = await this.profile.handleLinkDiscord(data);
                    break;
            }

            // Mark as processed with result
            await doc.ref.update({
                processed: true,
                processedAt: new Date().toISOString(),
                result: result
            });

            console.log(`✅ Finished: ${data.type} -> ${result.status}`);
        } catch (err) {
            console.error(`❌ Error processing ${id}:`, err);
            await doc.ref.update({
                processed: true,
                error: err.message
            });
        }
    }
}

module.exports = SubmissionsScanner;
