/**
 * Handles Discord account linking and verification.
 */
class ProfileHandler {
    constructor(db, discordClient) {
        this.db = db;
        this.discordClient = discordClient;
    }

    async handleLinkDiscord(submission) {
        const { userId, discordId } = submission;

        try {
            // 1. Verify Discord user exists
            const user = await this.discordClient.users.fetch(discordId).catch(() => null);
            if (!user) return { status: 'failed', error: 'Invalid Discord User ID' };

            // 2. Check if this Discord ID is already linked to someone else
            const existing = await this.db.collection('users')
                .where('discordId', '==', discordId)
                .limit(1)
                .get();

            if (!existing.empty && existing.docs[0].id !== userId) {
                return { status: 'failed', error: 'Discord ID already linked to another account' };
            }

            // Fetch avatar from Discord
            const avatarUrl = user.displayAvatarURL({ extension: 'png', forceStatic: false, size: 256 });

            // 3. Update profile
            await this.db.collection('users').doc(userId).update({
                discordId: discordId,
                avatarUrl: avatarUrl
            });

            return { status: 'success' };
        } catch (error) {
            console.error('Link Error:', error);
            return { status: 'failed', error: 'Verification failed' };
        }
    }
}

module.exports = ProfileHandler;
