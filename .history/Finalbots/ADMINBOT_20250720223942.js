const mineflayer = require('mineflayer');
const { randomBytes } = require('crypto');
const { createTownleaderBot } = require('./TownleaderBot.js');

const admin = mineflayer.createBot({
  host: 'localhost',
  port: 25565,
  username: 'ADMINBOT',
  version: '1.21.4',
  auth: 'offline'
});

const bots = new Map();

function generateUniqueName() {
  let name;
  do {
    name = 'Bot_' + randomBytes(3).toString('hex');
  } while (bots.has(name));
  return name;
}

admin.on('whisper', async (username, message) => {
  console.log(`Whisper from ${username}: ${message}`);

  const botName = generateUniqueName();
  try {
    const townBot = createTownleaderBot(botName, 5000);
    bots.set(botName, townBot);

    townBot.once('login', () => {
      admin.chat(`✅ Townleader ${botName} connected successfully.`);
    });

    townBot.once('error', (err) => {
      admin.chat(`❌ Could not connect Townleader: ${err.message}`);
      bots.delete(botName);
    });
  } catch (err) {
    console.error(`Failed to spawn ${botName}:`, err);
    admin.chat(`Failed to spawn ${botName}:`, err);
  }
});