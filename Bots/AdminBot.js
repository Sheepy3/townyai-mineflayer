// adminbot-minimal.js
const mineflayer = require('mineflayer')
const { spawn } = require('child_process')
const path = require('path')

const bot = mineflayer.createBot({
  host: process.env.MC_HOST || localhost, // DO NOT PUSH HARDCODED CHANGES TO THESE VALUES.
  port: process.env.MC_PORT || 25565, // DO NOT PUSH HARDCODED CHANGES TO THESE VALUES.
  username: 'ADMINBOT',
  version: '1.21.4',
  auth: 'offline'
})

// ---------- QUEUE STATE ----------
const queue = [];               // items: { botName, botType, args, ackCode, attempts, child }
let current = null;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

// enqueue() now also "maybe start next"
function enqueue(job) {
  job.attempts = 0;
  queue.push(job);
  if (!current) startNext();    // (combined maybeStartNext)
}

// startNext() both advances and launches
function startNext() {
  if (current) return;          // already running one
  if (queue.length === 0) return;

  current = queue.shift();
  current.attempts++;
  launchCurrent();
}

function launchCurrent() {
  const file =
    current.botType === 'townleader' ? 'TownleaderBot.js' :
    current.botType === 'fighter'     ? 'FighterBot.js'     : null;

  if (!file) {
    console.log(`[QUEUE] Unknown botType ${current.botType}. Skipping.`);
    return finishAndStartNext(false); // (combined advance)
  }

  console.log(`[QUEUE] Starting ${current.botType} ${current.botName} (attempt ${current.attempts}/${MAX_RETRIES})`);

  const child = spawn(process.execPath, [path.join(__dirname, file), ...current.args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
    env: { ...process.env, BOTNAME: current.botName, MC_HOST: 'localhost', MC_PORT: '25565' }
  });
  current.child = child;

  // Capture botName locally to avoid null reference issues
  const botName = current.botName;
  child.stdout.on('data', d => process.stdout.write(`[${botName}] ${d}`));
  child.stderr.on('data', d => process.stderr.write(`[${botName}] ${d}`));

  child.on('exit', (code, signal) => {
    // If we already moved on due to ACK, ignore late exit
    if (!current || current.child !== child) return;

    if (code === 101 && current.attempts < MAX_RETRIES) {
      console.log(`[${current.botName}] connect failed (code 101). Retry in ${RETRY_DELAY_MS}ms`);
      setTimeout(() => {
        current.attempts++;
        launchCurrent();
      }, RETRY_DELAY_MS);
    } else {
      console.log(`[${current.botName}] exited (code=${code}, signal=${signal ?? 'none'}). Moving on.`);
      finishAndStartNext(false);   // (combined advance)
    }
  });
}

// finishAndStartNext() is the only “advance” path
function finishAndStartNext(_ok) {
  // detach to avoid double-advance if child exits after ACK path
  if (current?.child) current.child.removeAllListeners('exit');
  current = null;
  startNext(); // immediately launch the next if queued
}

// -------- ACK handling (message body IS the code) --------
function tryHandleAck(message) {
  const code = String(message).trim();
  if (!current || code !== current.ackCode) return false;

  bot.chat(`/ack ${code}`);
  console.log(`[ACK] Accepted for ${current.botName}. Ran "/ack ${code}".`);

  // Move to the next job
  finishAndStartNext(true);
  return true;
}

// ---------- COMMAND PARSER ----------
bot.on('whisper', (_username, message) => {
  // 1) First consume potential ACK messages (bot whispers ONLY the code)
  if (tryHandleAck(message)) return

  // 2) Operator commands
  const parts = message.trim().split(/\s+/)
  const command = (parts[0] || '').toLowerCase()

  // createtown <leaderName> <townName> <ack_code>
  if (command === 'createtown' && parts.length === 4) {
    const [, leaderName, townName, ackCode] = parts
    enqueue({
      botName: leaderName,
      botType: 'townleader',
      args: ['--town', townName, '--ack', ackCode],
      ackCode
    })
    return
  }

  // spawnfighter <fighterName> <ack_code>
  if (command === 'spawnfighter' && parts.length === 3) {
    const [, fighterName, ackCode] = parts
    enqueue({
      botName: fighterName,
      botType: 'fighter',
      args: ['--ack', ackCode],
      ackCode
    })
    return
  }
})