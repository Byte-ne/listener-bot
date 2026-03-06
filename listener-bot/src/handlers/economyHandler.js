const { FieldValue } = require('firebase-admin/firestore');

/**
 * Handles cosmetic purchases and XP/Leveling logic.
 */
class EconomyHandler {
    constructor(db) {
        this.db = db;
    }

    async handlePurchase(submission) {
        const { userId, cosmeticId, price } = submission;
        const userRef = this.db.collection('users').doc(userId);

        try {
            await this.db.runTransaction(async (t) => {
                const userDoc = await t.get(userRef);
                if (!userDoc.exists) throw new Error('User not found');

                const userData = userDoc.data();
                if ((userData.foxyCoins || 0) < price) throw new Error('Insufficient coins');
                if (userData.unlockedCosmetics && userData.unlockedCosmetics.includes(cosmeticId)) {
                    throw new Error('Already owned');
                }

                t.update(userRef, {
                    foxyCoins: FieldValue.increment(-price),
                    unlockedCosmetics: FieldValue.arrayUnion(cosmeticId)
                });
            });
            return { status: 'success' };
        } catch (error) {
            console.error('Purchase error:', error);
            return { status: 'failed', error: error.message };
        }
    }

    async addXP(userId, amount) {
        const userRef = this.db.collection('users').doc(userId);

        try {
            await this.db.runTransaction(async (t) => {
                const userDoc = await t.get(userRef);
                if (!userDoc.exists) return;

                const userData = userDoc.data();
                let currentXP = (userData.xp || 0) + amount;
                let currentLevel = userData.level || 1;

                // Level Up Logic: 100 * (level^1.5)
                let xpToNext = Math.round(100 * Math.pow(currentLevel, 1.5));
                let levelsGained = 0;

                while (currentXP >= xpToNext) {
                    currentXP -= xpToNext;
                    currentLevel++;
                    levelsGained++;
                    xpToNext = Math.round(100 * Math.pow(currentLevel, 1.5));
                }

                const updates = {
                    xp: currentXP,
                    level: currentLevel
                };

                if (levelsGained > 0) {
                    updates.foxyCoins = FieldValue.increment(levelsGained * 50); // Lvl up bonus
                }

                t.update(userRef, updates);
            });
        } catch (error) {
            console.error('XP Error:', error);
        }
    }
}

module.exports = EconomyHandler;
