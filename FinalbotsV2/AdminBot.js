const mineflayer      = require('mineflayer');
//import { randomBytes } from 'crypto'
const { createTownleaderBot } = require('./TownleaderBot.js');
const { spawn } = require('child_process');
const path = require('path');

const bot = mineflayer.createBot({
    host:'107.138.47.146',//host: '173.73.200.194',
    port: 25565,
    username: 'ADMINBOT',
    version: '1.21.4',
    auth: 'offline'
  });

  const bots = new Map()
  
  
  function spawnBotWithRetry(botName, botType, ack_code, maxRetries = 3, delayMs = 5000) {
    let attempts = 0;

    function trySpawn() {
      attempts++;
      let newBot;
      
      // Create bot based on type
      switch (botType.toLowerCase()) {
        case 'townleader':
          newBot = createTownleaderBot(botName, 5000);
          break;
        case 'fighter':
          // Spawn FighterBot as a separate Node process
          const fighterProcess = spawn('node', [
            path.join(__dirname, 'FighterBot.js'),
            '--name', botName
          ], 
          {
            stdio: 'inherit',
            detached: false
          }
          );
          
          // Store the process reference
          bots.set(botName, { type: 'fighter', process: fighterProcess });
          
          // Handle process events
          fighterProcess.on('error', (err) => {
            console.error(`FighterBot process error:`, err);
            bots.delete(botName);
          });
          
          fighterProcess.on('exit', (code) => {
            console.log(`FighterBot ${botName} exited with code ${code}`);
            bots.delete(botName);
          });
          
          newBot = { type: 'fighter', process: fighterProcess };
          break;
        default:
          bot.chat(`Unknown bot type: ${botType}. Supported types: townleader, fighter`);
          return;
      }
      
      bots.set(botName, newBot);

            // Handle different bot types
      if (newBot.type === 'fighter') {
        /*// For FighterBot processes, acknowledge immediately since we can't detect login
        bot.chat(`${botType} ${botName} process started successfully.`);
        bot.chat(`/ack ${ack_code}`)
        console.log("acknowledged first ack for FighterBot process")
        
        // Handle FighterBot process events
        newBot.process.on('error', (err) => {
          console.error(`FighterBot process error:`, err);
          bots.delete(botName);
        });
        
        newBot.process.on('exit', (code) => {
          console.log(`FighterBot ${botName} exited with code ${code}`);
          bots.delete(botName);
        });*/
      } else {
        // For TownleaderBot, use the original login detection
        newBot.once('login', () => {
          bot.chat(`${botType} ${botName} connected successfully.`);
          bot.chat(`/ack ${ack_code}`)
          console.log("acknowledged first ack")
        });

        newBot.once('error', (err) => {
          bots.delete(botName);
          if (attempts < maxRetries) {
            bot.chat(`Could not connect ${botType}: ${err.message}. Retrying (${attempts}/${maxRetries})...`);
            setTimeout(trySpawn, delayMs);
          } else {
            bot.chat(`Failed to connect ${botType} ${botName} after ${maxRetries} attempts.`);
          }
        });
      }
      }
    trySpawn();
  }

  // Convenience function for backward compatibility
  function spawnTownleaderWithRetry(botName, ack_code, maxRetries = 3, delayMs = 5000) {
    return spawnBotWithRetry(botName, 'townleader', ack_code, maxRetries, delayMs);
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
        spawnTownleaderWithRetry(leaderName, ack_code);
      } catch (err) {
        console.error(`Failed to spawn ${leaderName}:`, err);
        bot.chat(`Failed to spawn ${leaderName}: ${err.message}`);
      }
    }
    
    // Detect 'spawnfighter' with exactly two arguments
    else if (command === 'spawnfighter' && args.length === 2) {
      const [fighterName, ack_code] = args;
      console.log(`Spawn fighter: ${fighterName}, ackcode: ${ack_code}`);

      try {
        spawnBotWithRetry(fighterName, 'fighter', ack_code);
      } catch (err) {
        console.error(`Failed to spawn ${fighterName}:`, err);
        bot.chat(`Failed to spawn ${fighterName}: ${err.message}`);
      }
    }
  });


