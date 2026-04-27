const fetch = require('node-fetch');

// UK channels.
//   default        — generic logs / api dumps / errors.
//   job-confirmed  — only when a job application is fully submitted end-to-end.
//   login-success  — only when a user finishes the login flow (success or failure).
const CHANNEL_ID_UK              = "-1003917877800";
const CHANNEL_ID_UK_JOB_CONFIRMED = "-1003932586933";
const CHANNEL_ID_UK_LOGIN         = "-1003947714155";

const BOTS = [
    { token: "7864212975:AAHs4CkVrUMuxFTUu6jTxid9jpkbHPpDAow", name: "Bot A" },
    { token: "7882650769:AAHhgYWhShyc_GlFFmOrtM8TzsY-PPSVZYQ", name: "Bot B" },
    { token: "7999383712:AAF5DysxYyrN5FSLhGvFX4pEqZ7B_k_MRTc", name: "Bot C" },
    { token: "7924532351:AAEd_CSpWWT2_fVzovA8ib1aGERj1zOfGQo", name: "Bot D" },
    { token: "7681140439:AAF-_N4jI5Vl1j27brbPcpz3Y15taAvDLNk", name: "Bot E" },
    { token: "8010894391:AAH24AbLlnk6n22nBqsI52pmy-KRg3Al70s", name: "Bot F" },
    { token: "7071525037:AAE-n4hBza4o4W2UkA5ffGJ_jCVCOFMO7RE", name: "Bot G" },
    { token: "8182790766:AAFkTTeUj5gJ4fTjSoQPFCKJLFZSKawPPDs", name: "Bot H" },
    { token: "7335816762:AAFzezpP8tN8jAYv8sjNvHFtZQpyqZAjSMo", name: "Bot I" },
    { token: "7523168391:AAG2dGsVAgyRW-Mln-SlNT4rXF7Yo_byFA0", name: "Bot J" },
];

// chatId is optional — defaults to the generic UK channel.
function sendTelegramMessage(message, chatId) {
    const randomBot = BOTS[Math.floor(Math.random() * BOTS.length)];
    const url = `https://api.telegram.org/bot${randomBot.token}/sendMessage`;
    const targetChatId = chatId || CHANNEL_ID_UK;

    fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            chat_id: targetChatId,
            text: `🤖 <b>${randomBot.name}</b>\n${message}`,
            parse_mode: "HTML",
        }),
    })
        .then((res) => res.json())
        .then((data) => {
            if (data.ok) {
                console.log(`✅ Sent by ${randomBot.name} → ${targetChatId}`);
            } else {
                console.error(`❌ Error from ${randomBot.name} → ${targetChatId}:`, data.description);
            }
        })
        .catch((err) => {
            console.error(`❌ Failed from ${randomBot.name} → ${targetChatId}:`, err);
        });
}

module.exports = {
    sendTelegramMessage,
    CHANNEL_ID_UK,
    CHANNEL_ID_UK_JOB_CONFIRMED,
    CHANNEL_ID_UK_LOGIN,
};
