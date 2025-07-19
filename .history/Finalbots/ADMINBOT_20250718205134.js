const mineflayer      = require('mineflayer');
//import { randomBytes } from 'crypto'


const bot = mineflayer.createBot({
    host:'localhost',//host: '173.73.200.194',
    port: 25565,
    username: 'ADMINBOT',
    version: '1.21.4',
    auth: 'offline'
  });

  const bots = new Map()
  
  
  function generateUniqueName() {
    let name
    do {
      name = 'Bot_' + randomBytes(3).toString('hex')
    } while (bots.has(name))
    return name
  }

  bot.on('whisper', (username, message) => {
    console.log(`Whisper from ${username}: ${message}`)
    // you could even auto-respond:
    // bot.whisper(username, `I got your message: "${message}"`)
  })