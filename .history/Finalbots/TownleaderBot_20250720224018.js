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
        bot.whisper(from, `Roger that: ${msg}`);
      });

}