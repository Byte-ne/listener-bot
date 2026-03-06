const { FieldValue } = require('firebase-admin/firestore');

/**
 * Handles quiz submission grading and Discord verification.
 */
class QuizHandler {
    constructor(db, discordClient, economyHandler) {
        this.db = db;
        this.discordClient = discordClient;
        this.economyHandler = economyHandler;
        this.guildId = process.env.GUILD_ID;
    }

    async handleSubmit(submission) {
        const { userId, quizId, answers } = submission;

        try {
            // 1. Get user data for Discord ID
            const userDoc = await this.db.collection('users').doc(userId).get();
            const discordId = userDoc.data()?.discordId;
            if (!discordId) return { status: 'failed', error: 'Discord account not linked' };

            // 2. Verify Discord membership
            const guild = await this.discordClient.guilds.fetch(this.guildId);
            const member = await guild.members.fetch(discordId).catch(() => null);
            if (!member) return { status: 'failed', error: 'Must be in the Discord server' };

            // 3. Get quiz from Firestore (or potentially memory if cached)
            const quizDoc = await this.db.collection('quizzes').doc(quizId).get();
            if (!quizDoc.exists) return { status: 'failed', error: 'Quiz not found' };
            const quiz = quizDoc.data();

            // 4. Grade
            let correctCount = 0;
            for (const ans of answers) {
                const q = quiz.questions.find(item => item.questionId === ans.questionId);
                if (q) {
                    // Match text answers (case-insensitive)
                    const userAns = ans.selectedAnswer.trim().toLowerCase();
                    const correctAns = q.correctAnswer?.trim().toLowerCase();
                    if (userAns === correctAns) {
                        correctCount++;
                    }
                }
            }

            const total = quiz.questions.length;
            const accuracy = (correctCount / total) * 100;
            const isWinner = accuracy >= 100;

            const coins = 25 + (isWinner ? 75 : 0);
            const xp = 50 + (isWinner ? 100 : 0);

            // 5. Atomic updates
            const batch = this.db.batch();
            const statsRef = this.db.collection('users').doc(userId);

            batch.update(statsRef, {
                totalQuizzes: FieldValue.increment(1),
                totalQuizWins: FieldValue.increment(isWinner ? 1 : 0),
                foxyCoins: FieldValue.increment(coins)
            });

            // Note: XP handled by economyHandler via addXP since it triggers level checks
            await batch.commit();
            await this.economyHandler.addXP(userId, xp);

            return {
                status: 'success',
                data: { score: correctCount, total, coins, xp }
            };
        } catch (error) {
            console.error('Quiz grading error:', error);
            return { status: 'failed', error: 'Internal grading error' };
        }
    }
}

module.exports = QuizHandler;
