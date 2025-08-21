const mineflayer      = require('mineflayer');
const mcData     = require('minecraft-data')('1.21.4')  // adjust to match your server version
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const armorManager = require('mineflayer-armor-manager')
const Vec3 = require('vec3')

//BOT INSTANCE
const bot = mineflayer.createBot({
  host:'107.138.47.146',//host: '173.73.200.194',
  port: 25565,
  username: 'LumberJack',
  version: '1.21.4',
  auth: 'offline', // or 'mojang' for older versions
});

//PLUGINS
bot.loadPlugin(pathfinder)
bot.loadPlugin(armorManager)

// Configure pathfinder movements with block breaking/placing
bot.once('spawn', () => {
    console.log('Bot spawned and starting initial gearing.')
    state = "gearing"
    
    // Configure pathfinder to break/place blocks
    const movements = new Movements(bot, mcData)
    movements.canDig = true // Allow breaking blocks
    movements.scafoldingBlocks = ['dirt', 'cobblestone', 'stone'] // Blocks to place for scaffolding
    movements.allow1by1towers = true // Allow building 1x1 towers
    movements.allowFreeMotion = true // Allow more complex movements
    movements.allowParkour = true // Allow parkour movements
    movements.allowSprinting = true // Allow sprinting
    
    bot.pathfinder.setMovements(movements)
})

// Initial gearing on spawn
bot.once('spawn', () => {
    console.log('Bot spawned and starting initial gearing.')
    state = "gearing"
})

//VARIABLES & CONSTANTS
var state = "IDLE"
var target = null
var currentTree = null // Tree we're currently chopping
var movingToTree = false // Flag to track if we're moving to a tree
var placedScaffold = [] // Track scaffolding blocks we've placed
var treeSearchRadius = 30 // Reduced search radius for better performance
var wanderGoal = null
var lastWanderTime = 0
const TARGETING_RANGE = 25 // Detection range for players
const DEFEND_RANGE = 4 // Only defend if entity is within 4 blocks
const FLEE_RANGE = 15 // Start fleeing if enemy is within 15 blocks
const REACH_MIN = 2.85 // Minimum attack reach
const REACH_MAX = 3.68 // Maximum attack reach
const CPS = 13 // Attack speed when defending
const HEALTH_THRESHOLD = 10
const HUNGER_THRESHOLD = 18
const COOLDOWN = new Map()
const LASTACTION = new Map()

// Ally system constants
const ALLY_LIST = ['LumberJack'] // Bot won't attack itself

// Tree types the bot can chop
const TREE_TYPES = [
    'oak_log', 'birch_log', 'spruce_log', 'jungle_log', 
    'acacia_log', 'dark_oak_log', 'mangrove_log',
    'cherry_log', 'crimson_stem', 'warped_stem'
]

// COOLDOWNS, time in milliseconds 
COOLDOWN.set('attack', 1000/CPS) // time between attacks when defending
COOLDOWN.set('stateprint', 2000) // state printing
COOLDOWN.set('gearing', 500) // time for gearing process
COOLDOWN.set('healing', 1000) // time between healing attempts
COOLDOWN.set('eating', 500) // time between eating attempts
COOLDOWN.set('playerCollect', 250) // time for player collect gearing
COOLDOWN.set('wander', 10000) // 10 seconds between wander decisions
COOLDOWN.set('treeSearch', 5000) // 5 seconds between tree searches
COOLDOWN.set('treeMining', 200) // 200ms between tree block breaks
COOLDOWN.set('blockBreak', 100) // 100ms between block breaks
COOLDOWN.set('blockPlace', 200) // 200ms between block placements
COOLDOWN.set('itemPickup', 1000) // 1 second between item pickups
COOLDOWN.set('scaffold', 150) // 150ms between scaffold placements
COOLDOWN.set('scaffoldCleanup', 100) // 100ms between scaffold cleanup

/*lumberjack bot state priority
1. equip armor [implemented] -> gearing system with cooldown
2. heal [implemented] -> check if health below 10, throw splash potions away from target
3. eat food [implemented] -> hunger ≤18 interrupts all functions except gearing and healing
4. flee from enemies [modified] -> run away if enemy within 15 blocks
5. defend self [modified] -> only attack if enemy within 4 blocks
6. pickup items [new] -> collect dropped logs and items
7. move to tree [new] -> pathfind to selected tree
8. chop tree [new] -> chop down trees when close enough
9. find tree [new] -> search for nearby trees
10. wander [modified] -> random exploration to find trees
*/

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
        
        // Jump and face away from target while eating
        jumpAndFaceAwayWhileEating();
    } else {
        // Stop jumping when not eating
        bot.setControlState('jump', false);
    }
})

bot.on('physicsTick', async () => {
    try {
        // Continuous tree and enemy checks
        if (canDoAction("treeSearch")) {
            checkForEnemies()
            if (!currentTree && !movingToTree) {
                findNearestTree()
            }
        }

        // Lumberjack bot state priority: 1. gear -> 2. heal -> 3. eat -> 4. flee -> 5. defend -> 6. pickup -> 7. move to tree -> 8. chop -> 9. find -> 10. wander
        
        // 1. Equip armor - highest priority
        if(state === "gearing"){
            gear()
        }
        // 2. Heal - second priority
        else if(bot.health < HEALTH_THRESHOLD && canHealSelf()){
            heal()
        }
        // 3. Eat food - third priority
        else if(bot.food <= HUNGER_THRESHOLD && canEatFood()){
            eat()
        }
        // Special handling for eating state
        else if(state == "EATING"){
            if (bot.food > HUNGER_THRESHOLD) {
                console.log('No longer hungry, stopping eating')
                state = "IDLE"
                equipBestAxe()
            }
            return
        }
        // 4. Flee from enemies - fourth priority
        else if(shouldFlee()){
            flee_from_enemies()
        }
        // 5. Defend self - fifth priority (only if cornered within 4 blocks)
        else if(shouldDefend()){
            defend_self()
        }
        // 6. Pickup items - sixth priority
        else if(shouldPickupItems()){
            pickup_items()
        }
        // 7. Move to tree - seventh priority
        else if(currentTree && !isCloseToTree(currentTree)){
            move_to_tree()
        }
        // 8. Chop tree - eighth priority
        else if(currentTree && isCloseToTree(currentTree)){
            chop_tree()
        }
        // 9. Find tree - ninth priority
        else if(!currentTree){
            find_tree()
        }
        // 10. Wander - lowest priority
        else{
            wander_for_trees()
        }

        //logging
        if (canDoAction("stateprint")){
            console.log(`${state} | Tree: ${currentTree ? currentTree.name : 'none'} | Moving: ${movingToTree} | Health: ${bot.health}`)
        }
    } catch (error) {
        console.log('Physics tick error:', error.message)
        if (error.message.includes('PartialReadError') || error.message.includes('Read error')) {
            bot_reset()
        }
    }
});

//STATE FUNCTIONS

// 1. EQUIP ARMOR (modified to equip axe)
function gear(){
    state = "GEARING UP"
    
    // Equip armor
    bot.armorManager.equipAll().catch(() => {})
    
    // Equip best axe for lumberjacking
    equipBestAxe()
    
    // Reset state after gearing cooldown
    if (canDoAction("gearing")) {
        state = "IDLE"
        equipBestAxe()
    }
}

// 2. HEAL
async function heal() {
    if (state !="HEALING" && canDoAction("healing")){
        state = "HEALING"

        // Find a splash instant health potion in inventory
        const potion = await GetItemInInventory('splash_potion')

        if (!potion) {
            console.log('No healing splash potion found')
            state = "IDLE"
            return
        }
        
        try {
            // Add a short random delay before healing (between 0.05 and 0.5 seconds)
            const ticks = Math.floor(Math.random() * 10) + 1;
            await bot.waitForTicks(ticks);
          
            // Turn away from target if there is one and run away while healing
            if (target) {
                // Calculate direction away from target
                const awayFromTarget = bot.entity.position.minus(target.position).normalize()
                const lookPosition = bot.entity.position.plus(awayFromTarget.scaled(2))
                await bot.lookAt(lookPosition, true)
                
                // Start sprinting away from target
                bot.setControlState('sprint', true)
                bot.setControlState('forward', true)
                console.log('Running away from target while healing')
            } 
            
            if(bot.health < 7){
                await bot.activateItem(false, new Vec3(0, -1, 0))
                COOLDOWN.set('healing',500) //double pot
            }else{
                await bot.activateItem(false, new Vec3(0, -1, 0))
                COOLDOWN.set('healing',1000)
            }

            // Stop moving after healing
            bot.setControlState('sprint', false)
            bot.setControlState('forward', false)

            // Immediately resume normal state after healing and re-equip sword
            state = "IDLE"
            equipBestAxe()
            console.log('Healing complete, resuming combat')
        } catch (error) {
            console.log('Error during healing:', error.message)
            // Stop movement on error
            bot.setControlState('sprint', false)
            bot.setControlState('forward', false)
            state = "IDLE"
            equipBestAxe()
        }
    }
}

// 3. EAT FOOD
async function eat() {
    // Start eating if not already eating and cooldown allows
    if (state !== "EATING" && canDoAction("eating")) {
        state = "EATING"
        const food = await getBestFood()
        
        if (!food) {
            console.log('No valid food found in inventory')
            state = "IDLE"
            return
        }
        
        console.log('Started eating food - will jump and face away from target')
        // Don't reset state here - let it continue until hunger is satisfied
    }
}

// 4. FLEE FROM ENEMIES (same as before)
function flee_from_enemies() {
    state = "FLEEING FROM ENEMIES"
    
    const nearestEnemy = get_nearest_enemy_player()
    if (!nearestEnemy) {
        state = "IDLE"
        return
    }
    
    // Calculate direction away from enemy
    const awayFromEnemy = bot.entity.position.minus(nearestEnemy.position).normalize()
    const fleeTarget = bot.entity.position.plus(awayFromEnemy.scaled(20))
    
    console.log(`Fleeing from ${nearestEnemy.username} at distance ${Math.floor(bot.entity.position.distanceTo(nearestEnemy.position))}`)
    
    // Sprint away
    bot.setControlState('sprint', true)
    bot.pathfinder.setGoal(new goals.GoalNear(fleeTarget.x, fleeTarget.y, fleeTarget.z, 1))
}

// 5. DEFEND SELF (only when cornered within 4 blocks)
function defend_self() {
    const nearestEnemy = get_nearest_enemy_player()
    if (!nearestEnemy || !nearestEnemy.position) {
        state = "IDLE"
        return
    }
    
    state = "DEFENDING SELF"
    
    // Look at the target's eye level
    const eyePos = nearestEnemy.position.offset(0, 1.62, 0);
    bot.lookAt(eyePos);
    
    const distance = bot.entity.position.distanceTo(nearestEnemy.position)
    
    console.log(`Cornered! Defending against ${nearestEnemy.username} at distance ${Math.floor(distance)}`)
    
    if(canDoAction("attack") && distance <= REACH_MAX){
        bot.attack(nearestEnemy)
        console.log(`Defensive attack on ${nearestEnemy.username}`)
    }
}

// 6. PICKUP ITEMS (modified to prioritize logs)
function pickup_items() {
    state = "PICKING UP ITEMS"
    
    const nearbyItems = Object.values(bot.entities).filter(entity => 
        entity.name === 'item' && 
        entity.position &&
        bot.entity.position.distanceTo(entity.position) <= 8
    )
    
    if (nearbyItems.length === 0) {
        state = "IDLE"
        return
    }
    
    // Prioritize log items first
    let closestItem = null
    let closestDistance = Infinity
    let foundLog = false
    
    for (const item of nearbyItems) {
        const distance = bot.entity.position.distanceTo(item.position)
        
        // Check if item is a log (prioritize these)
        const isLog = item.getDroppedItem && TREE_TYPES.some(logType => 
            item.getDroppedItem().name === logType
        )
        
        if (isLog && (!foundLog || distance < closestDistance)) {
            closestDistance = distance
            closestItem = item
            foundLog = true
        } else if (!foundLog && distance < closestDistance) {
            // If no logs found yet, consider other items
            closestDistance = distance
            closestItem = item
        }
    }
    
    if (closestItem && canDoAction("itemPickup")) {
        const itemName = closestItem.getDroppedItem ? closestItem.getDroppedItem().name : 'item'
        console.log(`Moving to pickup ${itemName} at distance ${Math.floor(closestDistance)}`)
        
        // Move to the item
        const goal = new goals.GoalNear(closestItem.position.x, closestItem.position.y, closestItem.position.z, 1)
        bot.pathfinder.setGoal(goal)
        bot.setControlState('sprint', true)
    }
}

// 7. MOVE TO TREE (simplified without leaf clearing)
function move_to_tree() {
    if (!currentTree || !isValidTree(currentTree)) {
        console.log('Tree no longer valid, clearing target')
        currentTree = null
        movingToTree = false
        state = "IDLE"
        return
    }
    
    state = "MOVING TO TREE"
    movingToTree = true
    
    const distance = bot.entity.position.distanceTo(currentTree.position)
    console.log(`Moving to ${currentTree.name} at distance ${Math.floor(distance)}`)
    
    // Configure pathfinder movements
    const movements = new Movements(bot, mcData)
    movements.canDig = true
    movements.scafoldingBlocks = getScaffoldingBlocks()
    movements.allowFreeMotion = true
    movements.allowParkour = false // Disable parkour for more reliable movement
    movements.allowSprinting = true
    bot.pathfinder.setMovements(movements)
    
    // Set goal to move near the tree
    const goal = new goals.GoalNear(currentTree.position.x, currentTree.position.y, currentTree.position.z, 2)
    bot.pathfinder.setGoal(goal)
    
    // Enable sprinting
    bot.setControlState('sprint', true)
}

// 8. CHOP TREE (simplified without leaf clearing)
async function chop_tree() {
    if (!currentTree || !isValidTree(currentTree)) {
        console.log('Tree no longer valid during chopping')
        currentTree = null
        movingToTree = false
        state = "IDLE"
        return
    }
    
    state = "CHOPPING TREE"
    movingToTree = false
    
    try {
        // Stop all movement when chopping
        bot.setControlState('sprint', false)
        bot.setControlState('forward', false)
        bot.setControlState('back', false)
        bot.setControlState('left', false)
        bot.setControlState('right', false)
        bot.pathfinder.setGoal(null)
        
        // Check if we need to build up to reach the tree
        const distance = bot.entity.position.distanceTo(currentTree.position)
        const heightDiff = currentTree.position.y - bot.entity.position.y
        
        if (heightDiff > 1.5 && distance <= 3) {
            // Tree is too high, need to build scaffolding
            if (await buildScaffoldToTree()) {
                return // Wait for scaffolding to complete
            }
        }
        
        // Look at the tree before chopping
        await bot.lookAt(currentTree.position.offset(0.5, 0.5, 0.5))
        
        // Chop the current tree block
        if (canDoAction("treeMining")) {
            console.log(`Chopping ${currentTree.name} at ${currentTree.position}`)
            await bot.dig(currentTree)
            
            // After chopping, find the next tree block in this tree
            setTimeout(() => {
                findNextTreeBlock()
            }, 300) // Small delay to let the block break
        }
        
    } catch (error) {
        console.log('Error chopping tree:', error.message)
        currentTree = null
        movingToTree = false
        state = "IDLE"
        bot.pathfinder.setGoal(null)
    }
}

// 9. FIND TREE (modified)
function find_tree() {
    state = "SEARCHING FOR TREES"
    
    if (canDoAction("treeSearch")) {
        // Call findNearestTree which now properly sets currentTree
        findNearestTree()
        
        if (currentTree) {
            console.log(`Target acquired: ${currentTree.name} at distance ${Math.floor(bot.entity.position.distanceTo(currentTree.position))}`)
        }
    }
}

// 10. WANDER FOR TREES (modified)
function wander_for_trees() {
    state = "WANDERING FOR TREES"
    
    // Set new wander goal every 10 seconds
    if (canDoAction("wander") || !wanderGoal) {
        // Generate random coordinates within reasonable range
        const wanderDistance = 20 + Math.random() * 30 // 20-50 blocks away (reduced for better pathfinding)
        const angle = Math.random() * Math.PI * 2
        
        wanderGoal = bot.entity.position.offset(
            Math.cos(angle) * wanderDistance,
            0,
            Math.sin(angle) * wanderDistance
        )
        
        console.log(`Wandering to find trees: ${Math.floor(wanderGoal.x)}, ${Math.floor(wanderGoal.z)}`)
        
        // Configure movements for wandering with block breaking
        const movements = new Movements(bot, mcData)
        movements.canDig = true
        movements.scafoldingBlocks = getScaffoldingBlocks()
        movements.allowFreeMotion = true
        movements.allowParkour = true
        movements.allowSprinting = true
        bot.pathfinder.setMovements(movements)
        
        // Set pathfinder goal
        bot.pathfinder.setGoal(new goals.GoalNear(wanderGoal.x, wanderGoal.y, wanderGoal.z, 5))
        
        // Also use direct movement controls as backup
        bot.setControlState('sprint', true)
        bot.setControlState('forward', true)
    }
}

//HELPER FUNCTIONS

function checkForEnemies() {
    const nearestEnemy = get_nearest_enemy_player()
    if (nearestEnemy) {
        const distance = bot.entity.position.distanceTo(nearestEnemy.position)
        if (distance <= FLEE_RANGE) {
            console.log(`Enemy ${nearestEnemy.username} detected at ${Math.floor(distance)} blocks`)
        }
    }
}

function findNearestTree() {
    console.log('Searching for trees...')
    const treeBlocks = bot.findBlocks({
        matching: (block) => TREE_TYPES.includes(block.name),
        maxDistance: treeSearchRadius,
        count: 20 // Find more trees to choose from
    })
    
    if (treeBlocks.length > 0) {
        console.log(`Found ${treeBlocks.length} tree blocks`)
        
        // Find the closest tree block (ignoring leaves)
        let closestTree = null
        let closestDistance = Infinity
        
        for (const treePos of treeBlocks) {
            const treeBlock = bot.blockAt(treePos)
            // Only consider actual log blocks, not leaves
            if (treeBlock && TREE_TYPES.includes(treeBlock.name)) {
                const distance = bot.entity.position.distanceTo(treePos)
                if (distance < closestDistance) {
                    closestDistance = distance
                    closestTree = treeBlock
                }
            }
        }
        
        if (closestTree) {
            console.log(`Selected tree: ${closestTree.name} at ${closestTree.position} (${Math.floor(closestDistance)} blocks away)`)
            currentTree = closestTree
            movingToTree = false
            return closestTree
        }
    }
    
    console.log('No valid trees found in area')
    return null
}

function findNextTreeBlock() {
    console.log('Looking for next tree block...')
    
    // Look for connected tree blocks (for chopping entire tree) - ignore leaves
    const nearbyTreeBlocks = bot.findBlocks({
        matching: (block) => TREE_TYPES.includes(block.name),
        maxDistance: 8, // Search around current position
        count: 10
    })
    
    if (nearbyTreeBlocks.length > 0) {
        // Find the closest tree block (ignoring leaves)
        let closestTree = null
        let closestDistance = Infinity
        
        for (const treePos of nearbyTreeBlocks) {
            const treeBlock = bot.blockAt(treePos)
            // Only consider actual log blocks, not leaves
            if (treeBlock && TREE_TYPES.includes(treeBlock.name)) {
                const distance = bot.entity.position.distanceTo(treePos)
                if (distance < closestDistance) {
                    closestDistance = distance
                    closestTree = treeBlock
                }
            }
        }
        
        if (closestTree) {
            currentTree = closestTree
            movingToTree = false
            console.log(`Next tree block: ${currentTree.name} at distance ${Math.floor(closestDistance)}`)
        } else {
            console.log('Tree fully chopped! Cleaning up scaffolding...')
            cleanupScaffolding()
            currentTree = null
            movingToTree = false
        }
    } else {
        console.log('Tree fully chopped! Cleaning up scaffolding...')
        cleanupScaffolding()
        currentTree = null
        movingToTree = false
    }
}

// Build scaffolding to reach high tree logs
async function buildScaffoldToTree() {
    if (!currentTree || !canDoAction("scaffold")) return false
    
    const scaffoldingBlocks = getScaffoldingBlocks()
    if (scaffoldingBlocks.length === 0) {
        console.log('No scaffolding blocks available')
        return false
    }
    
    const targetHeight = currentTree.position.y
    const currentHeight = bot.entity.position.y
    const heightNeeded = Math.ceil(targetHeight - currentHeight)
    
    if (heightNeeded <= 1) return false // Don't need scaffolding
    
    console.log(`Building scaffolding ${heightNeeded} blocks high to reach tree`)
    
    try {
        // Build scaffold tower under bot's position
        const buildPos = bot.entity.position.floored().offset(0, 0, 0)
        
        for (let i = 1; i <= heightNeeded; i++) {
            const scaffoldPos = buildPos.offset(0, i, 0)
            const blockBelow = bot.blockAt(scaffoldPos.offset(0, -1, 0))
            const targetBlock = bot.blockAt(scaffoldPos)
            
            if (targetBlock && targetBlock.name === 'air' && blockBelow && blockBelow.name !== 'air') {
                const scaffoldType = scaffoldingBlocks[0]
                
                if (hasItemInInventory(scaffoldType)) {
                    await bot.equip(bot.inventory.items().find(item => item.name === scaffoldType), 'hand')
                    await bot.placeBlock(blockBelow, new Vec3(0, 1, 0))
                    
                    // Track placed scaffold for cleanup
                    placedScaffold.push({
                        position: scaffoldPos.clone(),
                        blockType: scaffoldType
                    })
                    
                    console.log(`Placed ${scaffoldType} at ${scaffoldPos}`)
                    
                    // Move up as we build
                    if (i === heightNeeded) {
                        // Jump up to the scaffold
                        bot.setControlState('jump', true)
                        setTimeout(() => {
                            bot.setControlState('jump', false)
                        }, 200)
                    }
                } else {
                    console.log(`No ${scaffoldType} available for scaffolding`)
                    break
                }
            }
        }
        
        // Re-equip axe after scaffolding
        equipBestAxe()
        return true
        
    } catch (error) {
        console.log('Error building scaffolding:', error.message)
        equipBestAxe()
        return false
    }
}

// Clean up scaffolding blocks after tree is chopped
async function cleanupScaffolding() {
    if (placedScaffold.length === 0 || !canDoAction("scaffoldCleanup")) return
    
    console.log(`Cleaning up ${placedScaffold.length} scaffolding blocks`)
    
    try {
        // Sort scaffolding by height (highest first) to prevent blocks from falling
        placedScaffold.sort((a, b) => b.position.y - a.position.y)
        
        for (const scaffold of placedScaffold) {
            const block = bot.blockAt(scaffold.position)
            
            if (block && block.name === scaffold.blockType) {
                console.log(`Removing ${scaffold.blockType} at ${scaffold.position}`)
                await bot.dig(block)
                
                // Small delay between block removals
                await new Promise(resolve => setTimeout(resolve, 100))
            }
        }
        
        // Clear the scaffold tracking array
        placedScaffold = []
        console.log('Scaffolding cleanup complete')
        
    } catch (error) {
        console.log('Error cleaning up scaffolding:', error.message)
    }
    
    // Re-equip axe after cleanup
    equipBestAxe()
}

//SHARED FUNCTIONS

// Shared helper function for getting items in inventory
async function GetItemInInventory(itemName) {
    let found_item = bot.inventory.items().find(item => item.name === itemName)
    if (found_item){
        await bot.equip(found_item, 'hand')
        return true
    }else{
        return false
    }
}

// Shared helper function for checking if item exists in inventory
function hasItemInInventory(itemName) {
    return bot.inventory.items().some(item => item.name === itemName)
}

function getPotionId(item) {
    const comp = item.components?.find(c => c.type === 'potion_contents')
    return comp?.data?.potionId
}

// Buff logic: checks for any splash instant health potion (strong or regular)
function canHealSelf() {
    return hasItemInInventory('splash_potion')
}

// Check if bot has any valid food
function canEatFood() {
    return VALID_FOODS.some(food => hasItemInInventory(food))
}

// Find the best food item to eat (prioritizes higher nutrition)
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

function getStrongestSword() {
    const swords = bot.inventory.items().filter(item => item.name.endsWith('_sword'))
    if (swords.length === 0) return null
    const swordOrder = [
        'netherite_sword',
        'diamond_sword',
        'iron_sword',
        'stone_sword',
        'golden_sword',
        'wooden_sword'
    ]
    swords.sort((a, b) => swordOrder.indexOf(a.name) - swordOrder.indexOf(b.name))
    return swords[0]
}

// Modified equip function for axes
function equipBestAxe() {
    const axes = bot.inventory.items().filter(item => item.name.endsWith('_axe'))
    if (axes.length === 0) return
    
    const axeOrder = [
        'netherite_axe',
        'diamond_axe',
        'iron_axe',
        'stone_axe',
        'golden_axe',
        'wooden_axe'
    ]
    
    axes.sort((a, b) => axeOrder.indexOf(a.name) - axeOrder.indexOf(b.name))
    const bestAxe = axes[0]
    
    if (bestAxe && bot.heldItem !== bestAxe) {
        bot.equip(bestAxe, 'hand').catch(() => {})
        console.log(`Equipped ${bestAxe.name}`)
    }
}

// Remove equipStrongestSword and replace with equipBestAxe calls
function equipStrongestSword() {
    equipBestAxe() // Use axe instead of sword for lumberjack
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

function bot_reset(){
    bot.setControlState('sprint', false)
    bot.setControlState('forward', false)
    bot.setControlState('left', false)
    bot.setControlState('right', false)
    bot.setControlState('back', false)
    bot.setControlState('jump', false)
    target = null
    currentTree = null
    movingToTree = false
    placedScaffold = [] // Clear scaffold tracking
    wanderGoal = null
    bot.pathfinder.setGoal(null)
    console.log("LUMBERJACK RESET")
}

function isAlly(playerName) {
    // Also check if it's the bot itself
    if (playerName === bot.username) return true
    return ALLY_LIST.includes(playerName)
}

function jumpAndFaceAwayWhileEating() {
    // Jump while eating
    bot.setControlState('jump', true);
    
    // Face away from target and move forward if there is one
    if (target && target.position) {
        try {
            // Calculate direction away from target
            const awayFromTarget = bot.entity.position.minus(target.position).normalize();
            const lookPosition = bot.entity.position.plus(awayFromTarget.scaled(5));
            bot.lookAt(lookPosition, true).catch(() => {}); // Catch any look errors
            
            // Move forward away from target while eating
            bot.setControlState('forward', true);
        } catch (error) {
            // Silently handle any direction calculation errors
        }
    } else {
        // No target, just jump in place
        bot.setControlState('forward', false);
    }
}

// Get available scaffolding blocks from inventory
function getScaffoldingBlocks() {
    const availableBlocks = []
    const scaffoldingTypes = ['dirt', 'cobblestone', 'stone', 'netherrack', 'sandstone', 'oak_planks', 'birch_planks', 'spruce_planks']
    
    for (const blockType of scaffoldingTypes) {
        if (hasItemInInventory(blockType)) {
            availableBlocks.push(blockType)
        }
    }
    
    // If no scaffolding blocks available, return empty array (pathfinder will work without placing blocks)
    return availableBlocks
}

// Manual block breaking function for emergencies
async function breakBlockAtPosition(position) {
    if (!canDoAction("blockBreak")) return false
    
    try {
        const block = bot.blockAt(position)
        if (!block || block.name === 'air') return false
        
        // Don't break bedrock or other unbreakable blocks
        const unbreakableBlocks = ['bedrock', 'barrier', 'end_portal', 'end_portal_frame']
        if (unbreakableBlocks.includes(block.name)) return false
        
        console.log(`Breaking ${block.name} at ${position}`)
        await bot.dig(block)
        return true
    } catch (error) {
        console.log('Error breaking block:', error.message)
        return false
    }
}

// Manual block placing function
async function placeBlockAtPosition(position, blockType = 'dirt') {
    if (!canDoAction("blockPlace")) return false
    if (!hasItemInInventory(blockType)) return false
    
    try {
        const targetBlock = bot.blockAt(position)
        if (!targetBlock || targetBlock.name !== 'air') return false
        
        // Find a reference block to place against
        const referenceBlock = bot.blockAt(position.offset(0, -1, 0)) // Try below first
        if (!referenceBlock || referenceBlock.name === 'air') return false
        
        console.log(`Placing ${blockType} at ${position}`)
        await bot.equip(bot.inventory.items().find(item => item.name === blockType), 'hand')
        await bot.placeBlock(referenceBlock, new Vec3(0, 1, 0))
        return true
    } catch (error) {
        console.log('Error placing block:', error.message)
        return false
    }
}

function shouldFlee() {
    const nearestEnemy = get_nearest_enemy_player()
    if (!nearestEnemy) return false
    
    const distance = bot.entity.position.distanceTo(nearestEnemy.position)
    return distance <= FLEE_RANGE && distance > DEFEND_RANGE
}

function shouldDefend() {
    const nearestEnemy = get_nearest_enemy_player()
    if (!nearestEnemy) return false
    
    const distance = bot.entity.position.distanceTo(nearestEnemy.position)
    return distance <= DEFEND_RANGE
}

function shouldPickupItems() {
    if (!canDoAction("itemPickup")) return false
    
    const nearbyItems = Object.values(bot.entities).filter(entity => 
        entity.name === 'item' && 
        entity.position &&
        bot.entity.position.distanceTo(entity.position) <= 8
    )
    
    return nearbyItems.length > 0
}

function clearLeavesAroundTree() {
    if (!currentTree || !currentTree.position || !canDoAction("leafClear")) return
    
    const leafTypes = [
        'oak_leaves', 'birch_leaves', 'spruce_leaves', 'jungle_leaves',
        'acacia_leaves', 'dark_oak_leaves', 'mangrove_leaves', 'cherry_leaves'
    ]
    
    // Find leaves within 3 blocks of the tree
    const leavesToClear = bot.findBlocks({
        matching: (block) => leafTypes.includes(block.name),
        maxDistance: 6,
        count: 5 // Clear up to 5 leaf blocks at a time
    }).filter(leafPos => {
        // Only clear leaves that are close to our current tree
        return currentTree.position.distanceTo(leafPos) <= 4
    })
    
    if (leavesToClear.length > 0) {
        const closestLeaf = leavesToClear[0]
        const leafBlock = bot.blockAt(closestLeaf)
        
        if (leafBlock && leafBlock.name && leafTypes.includes(leafBlock.name)) {
            console.log(`Clearing ${leafBlock.name} blocking tree access`)
            bot.dig(leafBlock).catch(() => {
                console.log('Failed to clear leaf block')
            })
        }
    }
}

// Get nearest enemy player entity
function get_nearest_enemy_player(){
    const players = Object.values(bot.players)
        .map(player => player.entity)
        .filter(entity => 
            entity && 
            entity.type === 'player' &&
            entity.name !== bot.username && // Filter out bot itself
            entity.username !== bot.username && // Also check username property
            !isAlly(entity.name || entity.username) && // Check both name properties for allies
            entity.position
        )
    
    if (players.length === 0) return null
    
    // Find the closest enemy player
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

function isCloseToTree(tree) {
    if (!tree || !tree.position) return false
    const distance = bot.entity.position.distanceTo(tree.position)
    return distance <= 4.5
}

function isValidTree(block) {
    if (!block || !block.position) return false
    try {
        const actualBlock = bot.blockAt(block.position)
        // Only validate actual log blocks, not leaves
        return actualBlock && actualBlock.name && TREE_TYPES.includes(actualBlock.name)
    } catch (error) {
        console.log('Error validating tree:', error.message)
        return false
    }
}