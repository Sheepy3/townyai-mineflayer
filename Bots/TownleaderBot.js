const mineflayer = require('mineflayer');

function getArg(flag, fallback = undefined) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i+1] ? process.argv[i + 1]: fallback;
}

const BOTNAME = process.env.BOTNAME || getArg('--name', `Townleader_${Math.floor(Math.random()*10000)}`);
const ACK     = process.env.ACK     || getArg('--ack', '')
const bot = mineflayer.createBot({
  host: process.env.MC_HOST || 'localhost', // DO NOT PUSH HARDCODED CHANGES TO THESE VALUES.
  port: process.env.MC_PORT || 25565, // DO NOT PUSH HARDCODED CHANGES TO THESE VALUES.
  username: BOTNAME,
  version: '1.21.4',
  auth: 'offline',
});


// clear the timer on success
bot.once('login', () => {
  console.log(`${bot.username} successfully logged in.`);
});

// Add spawn event listener for consistency with other bots
bot.once('spawn', () => {
  bot.whisper("ADMINBOT", ACK)
  //console.log('Bot spawned and ready for town management.');
});

bot.on('error', err => {
  console.error(`${bot.username} error:`, err.message);
  
  // Handle protocol errors gracefully
  if (err.message.includes('PartialReadError') || err.message.includes('Read error')) {
    console.log(`${bot.username}: Protocol read error detected, this is usually harmless`);
    return;
  }
  
  // For other errors, you might want to reconnect
  if (err.message.includes('ECONNRESET') || err.message.includes('Connection lost')) {
    console.log(`${bot.username}: Connection lost, could not connect.`);
    process.exit(101);
  //  // You could implement reconnection logic here
  }
});


// Handle whispers directly
bot.on('whisper', (from, msg) => {
  console.log(`[${BOTNAME}] got whisper:`, msg)

  // Command parser
  const parts = msg.trim().split(/\s+/)
  const command = parts[0].toLowerCase()
  const args = parts.slice(1)
  
  //future might be better to switch this to switch case. 

  if (command === 'rtp' && args.length === 1) {
    const ack_code = args[0]
    rtp_now(bot, ack_code)
  }
  
  else if (command === 'createtown' && args.length === 2) {
    const [townName, ack_code] = args;
    create_town(bot, townName, ack_code)
  } else {
    bot.whisper(from, `unknown command: ${msg}`);
  }
  
  if(command === 'set_t_spawn'){
    const ack_code = args[0]
    bot.chat(`/t set spawn`)
    bot.chat(`/ack ${ack_code}`)
    console.log("set t spawn")
  }
});

async function create_town(bot, townName, ack_code){

  await bot.waitForTicks(20);
  bot.chat(`/t create ${townName}`);
  bot.chat(`/n create ${townName}`);
  bot.chat(`/ack ${ack_code}`);
  //bot.chat(`i created the fucking town`)
}


async function rtp_now(bot, ack_code) {
    bot.chat(`/rtp 5000 ${ack_code}`);

    // Wait for a whisper from 'Server' containing the ack_code
    await new Promise((resolve) => {
      function onWhisper(from, msg) {
        if (from === 'Server' && msg.includes(ack_code)) {
          bot.removeListener('whisper', onWhisper);
          resolve();
        }
      }
      bot.on('whisper', onWhisper);
    });

    bot.chat(`RTP confirmed with ack_code: ${ack_code}`);
  bot.chat(`/ack ${ack_code}`);
}