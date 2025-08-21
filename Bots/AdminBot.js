// adminbot-minimal.js
const mineflayer = require('mineflayer')
const { spawn } = require('child_process')
const path = require('path')

const bot = mineflayer.createBot({
  host: 'localhost',
  port: 25565,
  username: 'ADMINBOT',
  version: '1.21.4',
  auth: 'offline'
})

let lastAckCode = null

function spawnWithRetry({ botName, botType, args = [] }, { max = 3, delayMs = 5000 }) {
  let attempt = 0

  function tryOnce() {
    attempt++
    const file = botType === 'townleader' ? 'TownleaderBot.js' :
                 botType === 'fighter'     ? 'FighterBot.js'     : null
    if (!file) throw new Error(`Unknown botType ${botType}`)

    const child = spawn('node', [path.join(__dirname, file), ...args], {
      stdio: ['ignore', 'pipe', 'pipe'], // read logs to decide if we continue waiting
      detached: false,
      env: {
        ...process.env,
        BOTNAME: botName,
        MC_HOST: 'localhost',
        MC_PORT: '25565'
      }
    })

    child.stdout.on('data', d => process.stdout.write(`[${botName}] ${d}`))
    child.stderr.on('data', d => process.stderr.write(`[${botName}] ${d}`))

    child.on('exit', (code, signal) => {
      if (code === 101) {
        if (attempt < max) {
          console.log(`[${botName}] connect failed (code 101). Retry ${attempt}/${max - 1} in ${delayMs}ms`)
          setTimeout(tryOnce, delayMs)
        } else {
          console.log(`[${botName}] connect failed after ${max} attempts. Giving up.`)
        }
      } else {
        console.log(`[${botName}] exited. code=${code} signal=${signal ?? 'none'}`)
      }
    })
  }

  tryOnce()
}

bot.on('whisper', (_username, message) => {
  
  if (maybeHandleAck(message)) return

  const parts = message.trim().split(/\s+/)
  const command = (parts[0] || '').toLowerCase()

  // createtown <leaderName> <townName> <ack_code>
  if (command === 'createtown' && parts.length === 4) {
    const [ , leaderName, townName, ackCode ] = parts
    lastAckCode = ackCode // expect this exact code next
    spawnWithRetry(
      { botName: leaderName, botType: 'townleader', args: ['--town', townName, '--ack', ackCode] },
      { max: 3, delayMs: 5000 }
    )    
    return
  }

  // spawnfighter <fighterName> <ack_code>
  if (command === 'spawnfighter' && parts.length === 3) {
    const [ , fighterName, ackCode ] = parts
    lastAckCode = ackCode // expect this exact code next
    spawnWithRetry(
      { botName: fighterName, botType: 'fighter', args: ['--ack', ackCode] },
      { max: 3, delayMs: 5000 }
    )
    return
  }
})


function maybeHandleAck(message) {
  const code = String(message).trim()
  if (!lastAckCode) return false
  if (code !== lastAckCode) return false

  bot.chat(`/ack ${code}`)
  console.log(`[ACK] Accepted. Ran "/ack ${code}".`)
  lastAckCode = null
  return true
}