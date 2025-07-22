const mineflayer      = require('mineflayer');
//import { randomBytes } from 'crypto'
const { createTownleaderBot } = require('./TownleaderBot.js');

const bot = mineflayer.createBot({
    host:'localhost',//host: '173.73.200.194',
    port: 25565,
    username: 'ADMINBOT',
    version: '1.21.4',
    auth: 'offline'
  });

  const bots = new Map()
  
  
  function spawnTownleaderWithRetry(botName, ack_code, maxRetries = 3, delayMs = 5000) {
    let attempts = 0;

    function trySpawn() {
      attempts++;
      const townBot = createTownleaderBot(botName, 5000);
      bots.set(botName, townBot);

      townBot.once('login', () => {
        bot.chat(`Townleader ${botName} connected successfully.`);
        bot.chat(`/ack ${ack_code}`)
        console.log("acknowledged first ack")
      });

      townBot.once('error', (err) => {
        bots.delete(botName);
        if (attempts < maxRetries) {
          bot.chat(`Could not connect Townleader: ${err.message}. Retrying (${attempts}/${maxRetries})...`);
          setTimeout(trySpawn, delayMs);
        } else {
          bot.chat(`Failed to connect Townleader ${botName} after ${maxRetries} attempts.`);
        }
      });
    }

    trySpawn();
  }

  bot.on('whisper', (username, message) => {
    console.log(`Whisper from ${username}: ${message}`);

    // Split the message into command and arguments
    const parts = message.trim().split(/\s+/);
    const command = parts[0].toLowerCase();
    const args = parts.slice(1);

    // Detect 'createtown' with exactly three arguments
    if (command === 'createtown' && args.length === 3) {
      const [leaderName, townName, ack_code] = args;
      console.log(`Create town with leader: ${leaderName}, town: ${townName}, ackcode: ${ack_code}`);

      try {
        spawnTownleaderWithRetry(leaderName,ack_code);
      } catch (err) {
        console.error(`Failed to spawn ${leaderName}:`, err);
        bot.chat(`Failed to spawn ${leaderName}:`, err);
      }
    }
  });


