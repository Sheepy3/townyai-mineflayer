const mineflayer = require('mineflayer');

function createTownleaderBot(name, timeout = 5000) {
  const bot = mineflayer.createBot({
    host: 'localhost',
    port: 25565,
    username: name,
    version: '1.21.4',
    auth: 'offline',
  });

  //login timer
  const timer = setTimeout(() => {
    bot.emit('error', new Error(`Login timed out after ${timeout/1000}s`));
  }, timeout);

  // clear the timer on success
  bot.once('login', () => {
    clearTimeout(timer);
    console.log(`${bot.username} successfully logged in.`);
    initialize_bot(bot,name)
  });

  bot.on('error', err => {
    console.error(`${bot.username} error:`, err.message);
  });

  return bot;
}

module.exports = { createTownleaderBot };

function initialize_bot(bot,name){
    bot.on('whisper', (from, msg) => {
        console.log(`[${name}] got whisper:`, msg)

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

}

async function create_town(bot, townName, ack_code){

  await bot.waitForTicks(20);
  bot.chat(`/t create ${townName}`);
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