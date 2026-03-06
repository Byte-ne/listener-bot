/**
 * Parser for "Quiz Bot" (Mathagram/Anagram) format.
 * 
 * New Challenge Format:
 * Title: "Mathagram: 18 to the power of 2"
 * Description: "Can you work out what the answer is..." (Green bar)
 * 
 * Reveal Format:
 * Title: "Mathagram Finished"
 * Description: "The correct answer to the mathagram was: 324" (Red bar)
 */
function parseQuizMessage(message) {
    const embed = message.embeds[0];
    if (!embed || !embed.title) return null;

    const title = embed.title;
    const description = embed.description || "";

    // 1. Check for New Challenge
    if (title.includes(':') && description.toLowerCase().includes('work out')) {
        const parts = title.split(':');
        const type = parts[0].trim(); // Mathagram or Anagram
        const questionText = parts[1].trim();

        return {
            type: 'NEW_QUIZ',
            title: `${type} Challenge`,
            questions: [
                {
                    questionId: `q_${message.id}`,
                    text: questionText,
                    type: type.toLowerCase(), // mathagram | anagram
                    correctAnswer: null, // Revealed later
                    inputType: 'text' // User types the answer
                }
            ]
        };
    }

    // 2. Check for Reveal / Finished
    if (title.toLowerCase().includes('finished') && description.toLowerCase().includes('correct answer')) {
        const type = title.split(' ')[0].trim(); // Mathagram or Anagram
        const answerMatch = description.match(/was:\s*(.*)/i);
        const correctAnswer = answerMatch ? answerMatch[1].trim() : null;

        return {
            type: 'REVEAL_QUIZ',
            challengeType: type.toLowerCase(),
            correctAnswer: correctAnswer
        };
    }

    return null;
}

module.exports = { parseQuizMessage };
