const mineflayer      = require('mineflayer');
const mcData     = require('minecraft-data')('1.21.4')  // adjust to match your server version
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const armorManager = require('mineflayer-armor-manager')
const Vec3 = require('vec3')

//BOT INSTANCE
const bot = mineflayer.createBot({
  host:'107.138.47.146',//host: '173.73.200.194',
  port: 25565,
  username: 'pvt.asdeoyt@gmail.com',
  version: '1.21.4',
  auth: 'microsoft', // or 'mojang' for older versions
});

//PLUGINS
bot.loadPlugin(pathfinder)
bot.loadPlugin(armorManager)

// Initial gearing on spawn
bot.once('spawn', () => {
    console.log('Bot spawned and starting initial gearing.')
    state = "gearing"
})

// Ally system constants
const ALLY_LIST = ['CowardlyFirebolt'] // Players the bot will not attack
const ALLY_MAX_DISTANCE = 7.5 // Maximum distance from allied players

function isAlly(playerName) {
    return ALLY_LIST.includes(playerName)
}

function getNearestAlly() {
    const allies = bot.players
    let nearestAlly = null
    let nearestDistance = Infinity
    
    for (const playerName in allies) {
        const player = allies[playerName]
        if (isAlly(playerName) && player.entity && player.entity.position) {
            const distance = bot.entity.position.distanceTo(player.entity.position)
            if (distance < nearestDistance) {
                nearestDistance = distance
                nearestAlly = player.entity
            }
        }
    }
    
    return nearestAlly
}

function isTooFarFromAlly() {
    const nearestAlly = getNearestAlly()
    if (!nearestAlly) {
        return false // No ally online, don't worry about distance
    }
    
    const distance = bot.entity.position.distanceTo(nearestAlly.position)
    return distance > ALLY_MAX_DISTANCE
}

//VARIABLES & CONSTANTS
var state ="IDLE"
var target = null
const TARGETING_RANGE = 35// Close range targeting
const KITE_RANGE = 80 // Range to kite enemies with bow
const HEALTH_THRESHOLD = 10
const HUNGER_THRESHOLD = 18
const COOLDOWN = new Map()
const LASTACTION = new Map()

// Valid food items the bot can eat
const VALID_FOODS = [
    'enchanted_golden_apple',
    'golden_apple',
    'golden_carrot',
    'cooked_beef', // steak
    'cooked_porkchop',
    'cooked_rabbit',
    'cooked_mutton',
    'bread',
    'cooked_cod',
    'baked_potato',
    'cooked_chicken',
]

// COOLDOWNS, time in miliseconds 
COOLDOWN.set('attack', 1500) // time between bow attacks (1.5s for full draw)
COOLDOWN.set('stateprint',500)
COOLDOWN.set('gearing',500)
COOLDOWN.set('healing',1000)
COOLDOWN.set('eating',500)
COOLDOWN.set('playerCollect',250)
COOLDOWN.set('lookAround',2000)
COOLDOWN.set('targetCheck',2000)

//INTERRUPT TRIGGERS
bot.on("death", () => {
    bot_reset()
});

bot.on('entityGone', (entity) => {
    if (target && entity.id === target.id) {
        console.log("Target entity is gone (died or left)");
        bot_reset();
    }
});

bot.on('playerCollect', (collector, itemDrop) => {
    if (collector !== bot.entity) return
    state = "gearing"
    if (canDoAction("playerCollect")) {
        bot.armorManager.equipAll().catch(() => {})
    }
});

bot.on('whisper', (from, msg) => {
    bot.chat('recieved: ' + msg)
});

bot.on('physicsTick', async () => {
    // Constantly activate item when in eating state
    if (state === "EATING") {
        bot.activateItem();
        jumpAndFaceAwayWhileEating();
    } else {
        bot.setControlState('jump', false);
    }
})

bot.on('physicsTick', async () => {
    try {
        // Continuous target checking every 2 seconds (except when eating or gearing)
        if (state !== "EATING" && state !== "gearing" && canDoAction("targetCheck")) {
            checkForClosestTarget()
        }

        // Bot state priority: 1. gear -> 2. heal -> 3. eat -> 4. run away -> 5. attack -> 6. move -> 7. target

        if(state === "gearing"){
            gear()
        }
        else if(bot.health < HEALTH_THRESHOLD && canHealSelf()){
            heal()
        }
        else if(bot.food <= HUNGER_THRESHOLD && canEatFood()){
            eat()
        }
        else if(state == "EATING"){
            if (bot.food > HUNGER_THRESHOLD) {
                console.log('No longer hungry, stopping eating')
                state = "IDLE"
                equipBow()
            }
            return
        }
        else if(isTooFarFromAlly()){
            return_to_ally()
        }
        // --- If target is too close, run away ---
        else if(target && target.position && bot.entity.position.distanceTo(target.position) < 10) {
            // Don't run from allies
            if (!isAlly(target.username)) {
                state = "MOVING FROM TARGET";
                move_from_target();
            } else {
                target = null
                state = "IDLE"
                bot.pathfinder.setGoal(null)
            }
        }
        else if(state === "MOVING FROM TARGET" && target && target.position) {
            move_from_target()
        }
        else if(target && target.position && bot.entity.position.distanceTo(target.position) > 26) {
            // If too far, move closer to a random position within 10-26 blocks of the target
            if (!isAlly(target.username)) {
                state = "MOVING FROM TARGET";
                move_from_target();
            } else {
                target = null
                state = "IDLE"
                bot.pathfinder.setGoal(null)
            }
        }
        else if(target && target.position && bot.entity.position.distanceTo(target.position) <= KITE_RANGE && state !== "EATING"){
            // Don't attack allies
            if (!isAlly(target.username)) {
                // If no line of sight, move to get it
                if (!hasLineOfSightToTarget()) {
                    move_to_line_of_sight();
                } else {
                    attack_with_bow()
                }
            } else {
                target = null
                state = "IDLE"
                bot.pathfinder.setGoal(null)
            }
        }
        else if(target && target.position && bot.entity.position.distanceTo(target.position) > KITE_RANGE){
            console.log("Target too far, resetting")
            bot_reset()
        }
        else{
            get_new_target()
        }

        if (canDoAction("stateprint")){
            console.log(state)
        }
    } catch (error) {
        console.log('Physics tick error:', error.message)
        if (error.message.includes('PartialReadError') || error.message.includes('Read error')) {
            bot_reset()
        }
    }
});

//STATE FUNCTIONS

function gear(){
    state = "GEARING UP"
    bot.armorManager.equipAll().catch(() => {})
    equipBow()
    if (canDoAction("gearing")) {
        state = "IDLE"
        equipBow()
    }
}

async function heal() {
    if (state !="HEALING" && canDoAction("healing")){
        state = "HEALING"
        const potion = await GetItemInInventory('splash_potion')
        if (!potion) {
            console.log('No healing splash potion found')
            state = "IDLE"
            return
        }
        try {
            const ticks = Math.floor(Math.random() * 10) + 1;
            await bot.waitForTicks(ticks);
            if (target && !isAlly(target.username)) {
                const awayFromTarget = bot.entity.position.minus(target.position).normalize()
                const lookPosition = bot.entity.position.plus(awayFromTarget.scaled(2))
                await bot.lookAt(lookPosition, true)
                bot.setControlState('sprint', true)
                bot.setControlState('forward', true)
                console.log('Running away from target while healing')
            } 
            await bot.activateItem(false, new Vec3(0, -1, 0))
            bot.setControlState('sprint', false)
            bot.setControlState('forward', false)
            state = "IDLE"
            equipBow()
            console.log('Healing complete, resuming combat')
        } catch (error) {
            console.log('Error during healing:', error.message)
            bot.setControlState('sprint', false)
            bot.setControlState('forward', false)
            state = "IDLE"
            equipBow()
        }
    }
}

async function eat() {
    if (state !== "EATING" && canDoAction("eating")) {
        state = "EATING"
        const food = await getBestFood()
        if (!food) {
            console.log('No valid food found in inventory')
            state = "IDLE"
            return
        }
        console.log('Started eating food - will jump and face away from target')
    }
}

function return_to_ally(){
    state = "RETURNING TO ALLY"
    const nearestAlly = getNearestAlly()
    if (!nearestAlly) {
        console.log("No ally found to return to")
        state = "IDLE"
        return
    }
    const distance = bot.entity.position.distanceTo(nearestAlly.position)
    console.log(`Returning to ally ${nearestAlly.username} (${Math.floor(distance)} blocks away)`)
    target = null
    bot.setControlState('sprint', true)
    bot.pathfinder.setGoal(new goals.GoalFollow(nearestAlly, 3))
}

async function attack_with_bow() {
    if (!target || !target.position) {
        bot_reset()
        return
    }
    // Don't attack allies
    if (isAlly(target.username)) {
        target = null
        state = "IDLE"
        bot.pathfinder.setGoal(null)
        return
    }
    state = "ATTACKING WITH BOW"
    await equipBow()
    const distance = bot.entity.position.distanceTo(target.position)

    // Estimate target velocity (simple: difference in position over time)
    if (!target._lastPos) target._lastPos = target.position.clone()
    if (!target._lastTime) target._lastTime = Date.now()
    const now = Date.now()
    const dt = (now - target._lastTime) / 1000 // seconds
    let velocity = new Vec3(0, 0, 0)
    if (dt > 0) {
        velocity = target.position.minus(target._lastPos).scaled(1 / dt)
    }
    target._lastPos = target.position.clone()
    target._lastTime = now

    // Predict where the target will be after arrow travel time
    const arrowSpeed = 3.0 // blocks per second (vanilla full draw)
    const eyePos = target.position.offset(0, 1.62, 0)
    const botEye = bot.entity.position.offset(0, 1.62, 0)
    const toTarget = eyePos.minus(botEye)
    const travelTime = toTarget.distanceTo(new Vec3(0,0,0)) / arrowSpeed

    // Lead the target
    let predictedPos = eyePos.plus(velocity.scaled(travelTime))

    // --- Aim adjustment based on vertical difference ---
    // If the target is above or below, adjust aim higher or lower
    const verticalDiff = eyePos.y - botEye.y
    if (verticalDiff > 2) {
        // Target is significantly above, aim a bit higher
        predictedPos = predictedPos.offset(0, 0.6, 0)
    } else if (verticalDiff > 0.5) {
        // Target is slightly above
        predictedPos = predictedPos.offset(0, 0.3, 0)
    } else if (verticalDiff < -2) {
        // Target is significantly below, aim a bit lower
        predictedPos = predictedPos.offset(0, -0.6, 0)
    } else if (verticalDiff < -0.5) {
        // Target is slightly below
        predictedPos = predictedPos.offset(0, -0.3, 0)
    }

    // --- Aim slightly higher if target is far away ---
    if (distance > 20 && distance <= 40) {
        predictedPos = predictedPos.offset(0, 0.2, 0)
    } else if (distance > 40 && distance <= 60) {
        predictedPos = predictedPos.offset(0, 0.4, 0)
    } else if (distance > 60) {
        predictedPos = predictedPos.offset(0, 0.6, 0)
    }
    // --- End aim adjustment ---

    await bot.lookAt(predictedPos)

    if (canDoAction("attack")) {
        // Only attack if we have arrows and a bow
        if (hasItemInInventory('bow') && hasItemInInventory('arrow')) {
            try {
                await bot.equip(bot.inventory.items().find(i => i.name === 'bow'), 'hand')
                bot.activateItem() // Start drawing bow
                setTimeout(() => {
                    bot.deactivateItem() // Release arrow after 1s (full draw)
                }, 1000)
            } catch (e) {
                // ignore
            }
        }
    }
}

// MOVING FROM TARGET state logic
function move_from_target() {
    if (!target || !target.position) {
        state = "IDLE";
        return;
    }
    // Don't run from allies
    if (isAlly(target.username)) {
        target = null
        state = "IDLE"
        bot.pathfinder.setGoal(null)
        return
    }

    const botPos = bot.entity.position;
    const tgtPos = target.position;
    const dx = botPos.x - tgtPos.x;
    const dz = botPos.z - tgtPos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    // If already in the desired range, stop moving and go idle
    if (dist >= 10 && dist <= 26) {
        bot.pathfinder.setGoal(null);
        state = "IDLE";
        return;
    }

    // If too far, move closer to a random position within 10-26 blocks of the target
    if (dist > 26) {
        const angle = Math.random() * Math.PI * 2;
        const radius = 10 + Math.random() * (26 - 10);
        const destX = tgtPos.x + Math.cos(angle) * radius;
        const destZ = tgtPos.z + Math.sin(angle) * radius;
        const destY = tgtPos.y;
        bot.pathfinder.setGoal(new goals.GoalBlock(Math.round(destX), Math.round(destY), Math.round(destZ)));
        return;
    }

    // If too close, run away as before
    const angle = Math.atan2(dz, dx) + (Math.random() - 0.5) * Math.PI / 2;
    const radius = 10 + Math.random() * (26 - 10);
    const destX = tgtPos.x + Math.cos(angle) * radius;
    const destZ = tgtPos.z + Math.sin(angle) * radius;
    const destY = tgtPos.y;

    bot.pathfinder.setGoal(new goals.GoalBlock(Math.round(destX), Math.round(destY), Math.round(destZ)));
}

function get_new_target(){
    state = "LOOKING FOR TARGET"
    if (canDoAction("lookAround")) {
        lookAround()
    }
    if (!target) {
        state = "IDLE"
    }
}

//COSMETIC FUNCTIONS

function lookAround() {
    const yaw = Math.random() * Math.PI * 2
    const pitch = (Math.random() - 0.5) * 0.5
    bot.look(yaw, pitch)
    console.log("Looking around for targets...")
}

function jumpAndFaceAwayWhileEating() {
    bot.setControlState('jump', true);
    if (target && target.position) {
        try {
            const awayFromTarget = bot.entity.position.minus(target.position).normalize();
            const lookPosition = bot.entity.position.plus(awayFromTarget.scaled(5));
            bot.lookAt(lookPosition, true).catch(() => {});
            bot.setControlState('forward', true);
        } catch (error) {}
    } else {
        bot.setControlState('forward', false);
    }
}

//HELPER FUNCTIONS

function checkForClosestTarget() {
    const closestEnemy = get_nearest_enemy_player()
    if (!closestEnemy) {
        if (target) {
            console.log("No enemies detected - clearing current target")
            target = null
        }
        return
    }
    const distance = bot.entity.position.distanceTo(closestEnemy.position)
    if (distance > TARGETING_RANGE) {
        if (target) {
            console.log(`Closest enemy ${closestEnemy.username} too far (${Math.floor(distance)} blocks) - clearing target`)
            target = null
        }
        return
    }
    // Don't target allies
    if (isAlly(closestEnemy.username)) {
        if (target && isAlly(target.username)) {
            target = null
        }
        return
    }
    if (!target || target.id !== closestEnemy.id) {
        const previousTarget = target ? target.username : "none"
        target = closestEnemy
        console.log(`Target switch: ${previousTarget} → ${target.username} at ${Math.floor(distance)} blocks (closest enemy)`)
    }
}

function get_nearest_enemy_player(){
    const players = Object.values(bot.players)
        .map(player => player.entity)
        .filter(entity => 
            entity && 
            entity.type === 'player' &&
            entity.username !== bot.username &&
            !isAlly(entity.username) &&
            entity.position
        )
    if (players.length === 0) return null
    let closest = null
    let closestDistance = Infinity
    for (const player of players) {
        const distance = bot.entity.position.distanceTo(player.position)
        if (distance < closestDistance) {
            closestDistance = distance
            closest = player
        }
    }
    return closest
}

async function GetItemInInventory(itemName) {
    let found_item = bot.inventory.items().find(item => item.name === itemName)
    if (found_item){
        await bot.equip(found_item, 'hand')
        return true
    }else{
        return false
    }
}

function hasItemInInventory(itemName) {
    return bot.inventory.items().some(item => item.name === itemName)
}

function canHealSelf() {
    return hasItemInInventory('splash_potion')
}

function canEatFood() {
    return VALID_FOODS.some(food => hasItemInInventory(food))
}

async function getBestFood() {
    for (const foodName of VALID_FOODS) {
        const hasFood = await GetItemInInventory(foodName)
        if (hasFood) {
            console.log(`Found food: ${foodName}`)
            return true
        }
    }
    return false
}

async function equipBow() {
    const bow = bot.inventory.items().find(item => item.name === 'bow')
    if (bow) {
        await bot.equip(bow, 'hand').catch(() => {})
    }
}

function canDoAction(action){
    const now = Date.now();
    const last = LASTACTION.get(action) || 0;
    if (COOLDOWN.get(action) < (now - last)){
        LASTACTION.set(action, now);
        return true;
    }
    return false;
}

// Move to a position with line of sight to the target's eyes
async function move_to_line_of_sight() {
    if (!target || !target.position) return;

    const eyePos = target.position.offset(0, 1.62, 0);
    const botPos = bot.entity.position;
    const radius = 12;
    let found = false;

    // Fallback: just move to a circle around the target, don't use rayTrace
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 8) {
        const x = target.position.x + Math.cos(angle) * radius;
        const z = target.position.z + Math.sin(angle) * radius;
        const y = target.position.y + 1.62;

        bot.pathfinder.setGoal(new goals.GoalBlock(Math.round(x), Math.round(y), Math.round(z)));
        found = true;
        break;
    }

    // If no position found, fallback to moving closer to the target
    if (!found) {
        bot.pathfinder.setGoal(new goals.GoalFollow(target, 5));
    }
}

// Helper function to check line of sight (always returns true, since rayTrace is not available)
function hasLineOfSightToTarget() {
    return true;
}

function bot_reset(){
    bot.setControlState('sprint', false)
    bot.setControlState('forward', false)
    bot.setControlState('left', false)
    bot.setControlState('right', false)
    bot.setControlState('back', false)
    bot.setControlState('jump', false)
    target = null
    bot.pathfinder.setGoal(null)
    console.log("RESETTING")
}


// ally system bug. The bot is not recognizing allies properly and may attack them. archer bot also generally sometimes aims strange and doesn't shoot properly.