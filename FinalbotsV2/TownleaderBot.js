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
        console.log(`[${name}] got whisper:`, msg);
        // Command parser for 'rtp <ack_code>'
        const parts = msg.trim().split(/\s+/);
        const command = parts[0].toLowerCase();
        const args = parts.slice(1);
        if (command === 'rtp' && args.length === 1) {
            const ack_code = args[0];
            rtp_now(bot, ack_code)
        } else if(command === 'createtown') {
          const [townName, ack_code] = args

          bot.chat(`/t create ${townName}`)
          bot.chat(`/ack ${ack_code}`)

            bot.whisper(from, `unknown command: ${msg}`);
        }
      });

}


async function rtp_now(bot, ack_code) {
  bot.chat(`/rtp 5000`)
  //await bot.waitForTicks(20);
  bot.chat(`RTP command received with ack_code: ${ack_code}`);
  bot.chat(`/ack ${ack_code}`)
}